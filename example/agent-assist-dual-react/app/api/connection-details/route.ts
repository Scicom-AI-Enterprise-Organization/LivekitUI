import { NextResponse } from 'next/server';
import { AccessToken, AgentDispatchClient, type VideoGrant } from 'livekit-server-sdk';
import { RoomConfiguration } from '@livekit/protocol';
import { AGENT_NAME_ATTRIBUTE, CUSTOMER_NAME_ATTRIBUTE } from '@/lib/types';
import { defaultRoomName, sandboxConfig, serverApiUrl } from '@/lib/server-config';

/**
 * Read per request from `sandbox.json`, never held in a module-scope `const`.
 * See `lib/server-config.ts` for why this does not read `process.env`.
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

/**
 * A token for one seat at the desk.
 *
 * There is only one kind of participant here, unlike the per-participant assist
 * template: whoever holds this token *may* publish both legs, and is a monitor
 * until they do. Nothing is reserved and no seat can be taken — a supervisor
 * watching along is an ordinary join, and the room's own state (which tracks are
 * on air) is what says whether a call is actually being captured.
 */
export async function POST(req: Request) {
  const { apiKey, apiSecret, publicUrl, agentName: AGENT_NAME } = env();
  if (!apiKey || !apiSecret || !publicUrl) {
    return NextResponse.json(
      { error: 'LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set' },
      { status: 500 }
    );
  }

  let body: { room?: string; name?: string; customer?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const name = (body.name || '').trim().slice(0, 40);
  if (!name) {
    return NextResponse.json({ error: 'A name is required' }, { status: 400 });
  }
  const customer = (body.customer || '').trim().slice(0, 40);

  const roomName = (body.room || '').trim() || defaultRoomName();
  const identity = `desk-${crypto.randomUUID().slice(0, 8)}`;
  const token = await createToken({ identity, name, customer, roomName });
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
    // looking like the capture is broken.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function createToken({
  identity,
  name,
  customer,
  roomName,
}: {
  identity: string;
  name: string;
  customer: string;
  roomName: string;
}): Promise<string> {
  const { apiKey, apiSecret, agentName: AGENT_NAME } = env();

  // Both labels travel on the participant, because only this browser knows them:
  // the support agent's own name, and who is on the other end of a line the room
  // never sees. The worker reads them when it starts each leg, which is why they
  // are set at join and not editable mid-call — a leg already running would keep
  // the label it was started with, and a control that silently does nothing is
  // worse than no control.
  const attributes: Record<string, string> = { [AGENT_NAME_ATTRIBUTE]: name };
  if (customer) attributes[CUSTOMER_NAME_ATTRIBUTE] = customer;

  const at = new AccessToken(apiKey, apiSecret, { identity, name, ttl: '4h', attributes });

  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);

  if (AGENT_NAME) {
    // Dispatch is applied when the room is created, so carrying this on every
    // token is safe — whoever arrives first brings the worker in, and later joins
    // do not add duplicates.
    //
    // Built directly, never round-tripped through toJson()/fromJson(): a fresh
    // RoomConfiguration emits no `tags`, so the re-parse that used to strip them
    // removed nothing and instead threw whenever the two calls resolved to
    // different `@livekit/protocol` copies — which a sandbox routinely installs.
    at.roomConfig = new RoomConfiguration({ agents: [{ agentName: AGENT_NAME }] });
  }

  return at.toJwt();
}
