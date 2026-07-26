import { NextRequest, NextResponse } from "next/server";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { getSipClient } from "@/lib/livekit";
import { getSession } from "@/lib/auth";
import { livekitError } from "@/lib/livekit-errors";
import { serializeDispatchRule } from "@/lib/api-serialize";

/** GET /api/dispatch-rules — SIP dispatch rules. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rules = (await getSipClient().listSipDispatchRule()).map(serializeDispatchRule);
    return NextResponse.json({ rules, total: rules.length });
  } catch (error) {
    return livekitError(error, "SIP", "list dispatch rules");
  }
}

/**
 * POST /api/dispatch-rules — route inbound SIP calls into rooms.
 *
 * Body: { type: "direct" | "individual", name?, roomName?, roomPrefix?,
 *         trunkIds?, pin?, hidePhoneNumber?, metadata? }
 *
 * Scope a rule to specific numbers by pointing `trunkIds` at the trunks that
 * own them — the server API has no per-rule number filter on create.
 *
 * "direct" puts every caller in one room; "individual" creates a room per
 * caller, named with the prefix.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: {
    type?: string;
    name?: string;
    roomName?: string;
    roomPrefix?: string;
    trunkIds?: string[];
    pin?: string;
    hidePhoneNumber?: boolean;
    metadata?: string;
    agentName?: string;
    agentMetadata?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { type, name, roomName, roomPrefix, trunkIds, pin, hidePhoneNumber, metadata, agentName, agentMetadata } = body;

  if (type !== "direct" && type !== "individual") {
    return NextResponse.json(
      { error: 'type must be "direct" or "individual"' },
      { status: 400 }
    );
  }
  if (type === "direct" && !roomName) {
    return NextResponse.json({ error: "roomName is required for type=direct" }, { status: 400 });
  }
  if (type === "individual" && !roomPrefix) {
    return NextResponse.json({ error: "roomPrefix is required for type=individual" }, { status: 400 });
  }

  try {
    // The SDK takes a plain descriptor here and builds the protobuf itself.
    const rule =
      type === "direct"
        ? { type: "direct" as const, roomName: roomName!, pin: pin || undefined }
        : { type: "individual" as const, roomPrefix: roomPrefix!, pin: pin || undefined };

    // Agents registered with an agent_name only join when dispatched by name.
    // Without this the caller lands in a room with nobody in it.
    const roomConfig = agentName
      ? new RoomConfiguration({
          agents: [new RoomAgentDispatch({ agentName, metadata: agentMetadata || "" })],
        })
      : undefined;

    const info = await getSipClient().createSipDispatchRule(rule, {
      name,
      trunkIds,
      hidePhoneNumber,
      metadata,
      roomConfig,
    });
    return NextResponse.json(serializeDispatchRule(info));
  } catch (error) {
    return livekitError(error, "SIP", "create dispatch rule");
  }
}
