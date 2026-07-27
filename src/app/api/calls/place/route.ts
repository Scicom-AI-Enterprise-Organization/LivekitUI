import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { getSession } from "@/lib/auth";
import {
  getAgentDispatchClient,
  getRoomServiceClient,
  getSipClient,
} from "@/lib/livekit";
import { isAgentRunning } from "@/lib/agent-runner";
import { livekitError } from "@/lib/livekit-errors";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { SIPOutboundConfig, SIPTransport } from "@livekit/protocol";

/**
 * `sip:name@host[:port]` → its parts. The scheme is optional so a pasted
 * `me@192.168.1.10` works too; a bare host is rejected because SIP needs a
 * user to ring.
 */
function parseSipUri(value: string): { user: string; hostname: string } | null {
  const trimmed = value.trim().replace(/^sips?:/i, "");
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return null;

  const user = trimmed.slice(0, at).trim();
  const hostname = trimmed.slice(at + 1).trim();
  if (!user || !hostname || /\s/.test(user) || /\s/.test(hostname)) return null;

  return { user, hostname };
}

/**
 * POST /api/calls/place — dial out through an outbound SIP trunk.
 *
 * Body: { trunkId, callTo, agentName?, roomName?, fromNumber?, playDialtone? }
 *
 * `playDialtone` publishes a ringing tone **into the room**, not just to the
 * browser — so every participant hears it, an agent included, and its VAD will
 * treat it as sound to react to. Leave it off whenever an agent is on the call.
 *
 * Order matters: the room is created and the agent dispatched *before* the SIP
 * participant is added, so the agent is already there when the callee answers
 * instead of joining midway through the greeting.
 *
 * Returns a participant token so the browser can sit in the same room and
 * listen to (or talk on) the call.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const {
    trunkId,
    callTo,
    sipUri,
    agentName,
    roomName: requestedRoom,
    fromNumber,
    playDialtone = true,
  } = await request.json();

  // One destination field, two paths.
  //
  // A bare number goes through the outbound trunk, whose address is the carrier.
  // A full address — `sip:you@192.168.1.10` — is dialled *directly*: LiveKit
  // rejects a URI in sip_call_to ("should be a phone number or SIP user"), so
  // the host is lifted into an inline outbound config and the user part is
  // dialled. That is also what keeps a test call off the trunk that points back
  // at this server, where the inbound dispatch rule would answer with a second
  // agent instead of the person being called.
  const destinationInput = (typeof sipUri === "string" && sipUri.trim()) || callTo?.trim() || "";
  const directTarget = parseSipUri(destinationInput);

  if (!destinationInput) {
    return NextResponse.json(
      { error: "callTo is required — a phone number, or sip:name@host to ring a device directly" },
      { status: 400 }
    );
  }
  if (!directTarget && !trunkId) {
    return NextResponse.json(
      {
        error:
          "trunkId is required to dial a phone number — pick an outbound trunk, or call a sip:name@host address instead",
      },
      { status: 400 }
    );
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not configured" },
      { status: 500 }
    );
  }

  // Explicit-dispatch agents never join on their own, so a stopped agent would
  // silently produce a call with nobody on our end.
  if (agentName && !isAgentRunning(agentName)) {
    return NextResponse.json(
      {
        error: `Agent "${agentName}" is not running. Deploy it first, or place the call without an agent.`,
        notRunning: true,
      },
      { status: 409 }
    );
  }

  const destination = directTarget
    ? `sip:${directTarget.user}@${directTarget.hostname}`
    : destinationInput;
  const roomName = requestedRoom?.trim() || `outbound-${Date.now()}`;
  const identity = `operator-${Math.random().toString(36).slice(2, 8)}`;

  try {
    await getRoomServiceClient().createRoom({ name: roomName, emptyTimeout: 120 });

    if (agentName) {
      await getAgentDispatchClient().createDispatch(roomName, agentName.replace(/\s+/g, "-"));
    }

    // A direct dial carries its own outbound config, so no trunk is involved
    // and nothing routes the call back through this server's inbound rules.
    const participant = await getSipClient().createSipParticipant(
      directTarget ? "" : trunkId,
      directTarget ? directTarget.user : destination,
      roomName,
      {
        participantIdentity: `sip-${identity}`,
        participantName: destination,
        // An inline trunk carries no numbers of its own, and the SIP service
        // rejects the call without a From — so a direct dial always sends one.
        fromNumber: fromNumber?.trim() || (directTarget ? "console" : undefined),
        playDialtone: !!playDialtone,
        // Don't block the response on pickup — the UI follows progress live.
        ringingTimeout: 45,
        maxCallDuration: 600,
      },
      directTarget
        ? new SIPOutboundConfig({
            hostname: directTarget.hostname,
            transport: SIPTransport.SIP_TRANSPORT_AUTO,
          })
        : undefined
    );

    const at = new AccessToken(apiKey, apiSecret, { identity, name: session.email });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return NextResponse.json({
      room: roomName,
      callTo: destination,
      /** True when the address was dialled directly, bypassing every trunk. */
      direct: !!directTarget,
      agent: agentName || null,
      participantId: participant.participantId,
      sipCallId: participant.sipCallId,
      token: await at.toJwt(),
      // The browser joins this room to listen in, so it needs the public
      // address. `LIVEKIT_URL` is the in-cluster one and resolves to nothing
      // from a laptop.
      serverUrl: getRuntimeConfig().livekitUrl,
    });
  } catch (error) {
    return livekitError(error, "SIP", "place the call");
  }
}

/**
 * DELETE /api/calls/place — end a call this panel placed.
 *
 * Leaving the room from the browser only drops *our* participant: the SIP leg
 * and the agent stay connected and the call keeps running (and billing).
 * Deleting the room disconnects everyone.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { room } = await request.json();
  if (!room) {
    return NextResponse.json({ error: "room is required" }, { status: 400 });
  }

  try {
    await getRoomServiceClient().deleteRoom(room);
    return NextResponse.json({ success: true, room });
  } catch (error) {
    return livekitError(error, "SIP", "end the call");
  }
}
