import { NextResponse } from 'next/server';
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
  type VideoGrant,
} from 'livekit-server-sdk';
import { RoomConfiguration } from '@livekit/protocol';
import { isRole, NAME_ATTRIBUTE, ROLE_ATTRIBUTE, type Role } from '@/lib/types';
import { defaultRoomName, sandboxConfig, serverApiUrl } from '@/lib/server-config';

/**
 * Read per request from `sandbox.json`, never held in a module-scope `const`.
 *
 * See `lib/server-config.ts` for why this does not read `process.env`: a folded
 * env reference gave a call that dispatched no worker and transcribed nothing,
 * with the correct value sitting in the process the whole time.
 */
function env() {
  const cfg = sandboxConfig();
  return {
    apiKey: cfg.apiKey,
    apiSecret: cfg.apiSecret,
    /** Browser-facing address. Under Docker, not the host the SDK uses. */
    publicUrl: cfg.livekitUrl,
    agentName: cfg.agentName,
  };
}

export const revalidate = 0;

export async function POST(req: Request) {
  const { apiKey, apiSecret, publicUrl, agentName: AGENT_NAME } = env();
  if (!apiKey || !apiSecret || !publicUrl) {
    return NextResponse.json(
      { error: 'LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set' },
      { status: 500 }
    );
  }

  let body: { room?: string; role?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const role = body.role;
  if (!isRole(role)) {
    return NextResponse.json({ error: 'role must be "agent" or "customer"' }, { status: 400 });
  }

  const name = (body.name || '').trim().slice(0, 40);
  if (!name) {
    return NextResponse.json({ error: 'A name is required' }, { status: 400 });
  }

  const roomName = (body.room || '').trim() || defaultRoomName();

  // Reject a second person taking the same seat here rather than letting them
  // in: two "customers" would each get their own transcription session and the
  // coach would read the call as one person talking to themselves.
  const taken = await seatTaken(roomName, role);
  if (taken) {
    return NextResponse.json(
      { error: `${role === 'agent' ? 'The support agent seat' : 'The customer seat'} is already taken by ${taken}.` },
      { status: 409 }
    );
  }

  const identity = `${role}-${crypto.randomUUID().slice(0, 8)}`;
  const token = await createToken({ identity, name, role, roomName });
  const dispatch = await ensureWorkerDispatched(roomName);

  return NextResponse.json(
    { serverUrl: publicUrl, roomName, identity, token, agentName: AGENT_NAME, dispatch },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * Make sure the assist worker is dispatched into this room.
 *
 * The token's `roomConfig` only takes effect when the room is *created*, which
 * loses the race that matters: deploy a sandbox, open the link a few seconds
 * later, and the Python worker is still loading its models — the dispatch finds
 * no registered worker, the room now exists, and no later join ever asks again.
 * The call then runs with nothing transcribing it and no way to tell why.
 *
 * So dispatch explicitly on every join, skipping it when one is already there.
 * `POST /api/dispatch-worker` is the same code for the retry button.
 */
export async function ensureWorkerDispatched(
  roomName: string
): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const { apiKey, apiSecret, agentName: AGENT_NAME } = env();
  if (!AGENT_NAME) return { ok: false, error: 'This sandbox has no assist worker configured.' };

  const url = serverApiUrl();
  if (!url || !apiKey || !apiSecret) return { ok: false, error: 'Server credentials missing.' };

  try {
    const dispatchClient = new AgentDispatchClient(url, apiKey, apiSecret);
    try {
      const existing = await dispatchClient.listDispatch(roomName);
      if (existing.some((d) => d.agentName === AGENT_NAME)) return { ok: true, already: true };
    } catch {
      // No room yet, so no dispatch list. createDispatch below creates the room.
    }
    await dispatchClient.createDispatch(roomName, AGENT_NAME);
    return { ok: true };
  } catch (e) {
    // Nearly always "no worker registered for agent_name" — the worker is not
    // running yet. Report it so the UI can offer a retry instead of sitting there
    // looking like the microphone is broken.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function seatTaken(roomName: string, role: Role): Promise<string | null> {
  const url = serverApiUrl();
  const { apiKey, apiSecret } = env();
  if (!url || !apiKey || !apiSecret) return null;
  try {
    const client = new RoomServiceClient(url, apiKey, apiSecret);
    const participants = await client.listParticipants(roomName);
    for (const p of participants) {
      if (p.attributes?.[ROLE_ATTRIBUTE] === role) {
        return p.attributes?.[NAME_ATTRIBUTE] || p.name || p.identity;
      }
    }
  } catch {
    // A room that does not exist yet throws. So does an unreachable server —
    // in both cases letting the join through is better than blocking the call.
  }
  return null;
}

function createToken({
  identity,
  name,
  role,
  roomName,
}: {
  identity: string;
  name: string;
  role: Role;
  roomName: string;
}): Promise<string> {
  const { apiKey, apiSecret, agentName: AGENT_NAME } = env();
  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: '2h',
    // How the worker tells the two humans apart. Attributes travel with the
    // participant, so they survive a reconnect and are visible to every client.
    attributes: { [ROLE_ATTRIBUTE]: role, [NAME_ATTRIBUTE]: name },
  });

  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);

  if (AGENT_NAME) {
    // Dispatch is applied when the room is created, so carrying this on both
    // participants' tokens is safe — whoever arrives first brings the worker in,
    // and the second join does not add a duplicate.
    const rc = new RoomConfiguration({ agents: [{ agentName: AGENT_NAME }] });
    // `tags` makes LiveKit servers older than 1.11 fail to decode the config.
    const json = rc.toJson();
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      delete json.tags;
    }
    at.roomConfig = RoomConfiguration.fromJson(json);
  }

  return at.toJwt();
}
