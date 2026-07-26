import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { getSession } from "@/lib/auth";
import { getAgentDispatchClient, getRoomServiceClient } from "@/lib/livekit";
import { isAgentRunning } from "@/lib/agent-runner";
import { CONSOLE_PARTICIPANT_ATTRIBUTE } from "@/lib/console-sessions";

/**
 * A self-hosted LiveKit server records nothing about a client's platform — that
 * is a Cloud analytics field. The dashboard does know, because the browser
 * asking for the token sent a User-Agent, so stamp it on the participant as an
 * attribute. The webhook receiver folds it into the Overview's Platform
 * breakdown; without this that panel has no source at all.
 */
function platformAttributes(req: NextRequest): Record<string, string> {
  const ua = req.headers.get("user-agent") || "";
  if (!ua) return {};

  const os =
    /Windows NT/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown";

  // Order matters: Edge and Chrome both claim "Chrome", Chrome claims "Safari".
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Unknown";

  return { "client.platform": os, "client.browser": browser, "client.sdk": "js" };
}

/**
 * Starts a live preview session against a deployed agent.
 *
 * Creates a room, dispatches the agent into it by name, and returns a
 * participant token for the browser. The agent under test is the one actually
 * running — same generated code, same providers, same secrets — so the preview
 * reflects production rather than a separate stand-in process.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    agentName,
    mode,
    room: observeRoom,
    participantName,
    participantMetadata,
    roomMetadata,
  }: {
    agentName?: string;
    mode?: "preview" | "console" | "observe";
    room?: string;
    participantName?: string;
    participantMetadata?: string;
    roomMetadata?: string;
  } = await req.json();

  const apiKeyEarly = process.env.LIVEKIT_API_KEY;
  const apiSecretEarly = process.env.LIVEKIT_API_SECRET;

  /**
   * Observe mode: join a room that already exists — an inbound SIP call, for
   * instance — without creating it or dispatching anything. The token cannot
   * publish, because the caller is on the phone and a second live microphone
   * would only echo into the call.
   */
  if (mode === "observe") {
    if (!observeRoom) {
      return NextResponse.json({ error: "room is required to observe" }, { status: 400 });
    }
    if (!apiKeyEarly || !apiSecretEarly) {
      return NextResponse.json(
        { error: "LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not configured" },
        { status: 500 }
      );
    }

    const identity = `console-${Math.random().toString(36).slice(2, 8)}`;
    const at = new AccessToken(apiKeyEarly, apiSecretEarly, {
      identity,
      name: participantName?.trim() || identity,
      // The console records the session itself, so the server-side observer must
      // stand down rather than store a second copy of the same call.
      attributes: { ...platformAttributes(req), [CONSOLE_PARTICIPANT_ATTRIBUTE]: "1" },
    });
    at.addGrant({
      room: observeRoom,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    });

    return NextResponse.json({
      token: await at.toJwt(),
      room: observeRoom,
      identity,
      observer: true,
      serverUrl: process.env.LIVEKIT_URL || "ws://localhost:7880",
    });
  }

  if (!agentName) {
    return NextResponse.json({ error: "agentName is required" }, { status: 400 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not configured" },
      { status: 500 }
    );
  }

  // Agents are registered for explicit dispatch, so nothing will join the room
  // unless the process is up. Say so now instead of letting the browser sit on
  // "connecting" until it times out.
  if (!isAgentRunning(agentName)) {
    return NextResponse.json(
      {
        error: `Agent "${agentName}" is not running. Deploy it first, then start the call.`,
        notRunning: true,
      },
      { status: 409 }
    );
  }

  // The agent registers under its slug, which is how the builder writes
  // agent_name into the generated code.
  const dispatchName = agentName.replace(/\s+/g, "-");
  const prefix = mode === "console" ? "agent-console" : "agent-preview";
  const roomName = `${prefix}-${dispatchName}-${Date.now()}`;
  const identity = `user-${Math.random().toString(36).slice(2, 8)}`;
  const displayName = participantName?.trim() || identity;

  try {
    // Empty rooms are reaped shortly after the preview ends.
    await getRoomServiceClient().createRoom({
      name: roomName,
      emptyTimeout: 120,
      ...(roomMetadata ? { metadata: roomMetadata } : {}),
    });
    await getAgentDispatchClient().createDispatch(roomName, dispatchName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not dispatch "${dispatchName}" — ${message}` },
      { status: 502 }
    );
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: displayName,
    attributes: {
      ...platformAttributes(req),
      // Only the console records what it hosts; the builder's preview does not,
      // so a preview room is still worth capturing server-side.
      ...(mode === "console" ? { [CONSOLE_PARTICIPANT_ATTRIBUTE]: "1" } : {}),
    },
    ...(participantMetadata ? { metadata: participantMetadata } : {}),
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
  });

  const token = await at.toJwt();

  return NextResponse.json({
    token,
    room: roomName,
    agent: dispatchName,
    identity,
    participantName: displayName,
    serverUrl: process.env.LIVEKIT_URL || "ws://localhost:7880",
  });
}
