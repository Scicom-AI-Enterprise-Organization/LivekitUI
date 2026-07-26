import { NextRequest, NextResponse } from "next/server";
import { getEgressClient } from "@/lib/livekit";
import { getSession } from "@/lib/auth";
import { livekitError } from "@/lib/livekit-errors";
import { serializeEgress } from "@/lib/api-serialize";

/** POST /api/egresses/{egressId}/stop — stop a running egress. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "egress id is required" }, { status: 400 });
  }

  try {
    const info = await getEgressClient().stopEgress(id);
    return NextResponse.json(serializeEgress(info));
  } catch (error) {
    return livekitError(error, "egress", "stop egress");
  }
}
