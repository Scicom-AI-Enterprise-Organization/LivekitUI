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

/**
 * POST /api/calls/place — dial out through an outbound SIP trunk.
 *
 * Body: { trunkId, callTo, agentName?, roomName?, fromNumber?, playDialtone? }
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
    agentName,
    roomName: requestedRoom,
    fromNumber,
    playDialtone = true,
  } = await request.json();

  if (!trunkId) {
    return NextResponse.json({ error: "trunkId is required — pick an outbound trunk" }, { status: 400 });
  }
  if (!callTo?.trim()) {
    return NextResponse.json(
      { error: "callTo is required — a phone number or a SIP URI" },
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

  const destination = callTo.trim();
  const roomName = requestedRoom?.trim() || `outbound-${Date.now()}`;
  const identity = `operator-${Math.random().toString(36).slice(2, 8)}`;

  try {
    await getRoomServiceClient().createRoom({ name: roomName, emptyTimeout: 120 });

    if (agentName) {
      await getAgentDispatchClient().createDispatch(roomName, agentName.replace(/\s+/g, "-"));
    }

    const participant = await getSipClient().createSipParticipant(
      trunkId,
      destination,
      roomName,
      {
        participantIdentity: `sip-${identity}`,
        participantName: destination,
        fromNumber: fromNumber?.trim() || undefined,
        playDialtone: !!playDialtone,
        // Don't block the response on pickup — the UI follows progress live.
        ringingTimeout: 45,
        maxCallDuration: 600,
      }
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
      agent: agentName || null,
      participantId: participant.participantId,
      sipCallId: participant.sipCallId,
      token: await at.toJwt(),
      serverUrl: process.env.LIVEKIT_URL || "ws://localhost:7880",
    });
  } catch (error) {
    return livekitError(error, "SIP", "place the call");
  }
}
