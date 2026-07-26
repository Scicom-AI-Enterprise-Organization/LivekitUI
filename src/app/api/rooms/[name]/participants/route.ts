import { NextRequest, NextResponse } from "next/server";
import { getRoomServiceClient } from "@/lib/livekit";
import { getSession } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name } = await params;
    const client = getRoomServiceClient();
    const participants = await client.listParticipants(name);

    const result = participants.map((p) => ({
      sid: p.sid,
      identity: p.identity,
      name: p.name,
      state: p.state,
      joinedAt: Number(p.joinedAt),
      permission: p.permission,
      isPublisher: p.isPublisher,
      metadata: p.metadata,
    }));

    return NextResponse.json({ participants: result });
  } catch (error) {
    console.error("Failed to list participants:", error);
    return NextResponse.json(
      { error: "Failed to list participants", details: String(error) },
      { status: 500 }
    );
  }
}
