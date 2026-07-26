import { NextRequest, NextResponse } from "next/server";
import { getSipClient } from "@/lib/livekit";
import { getSession } from "@/lib/auth";
import { livekitError } from "@/lib/livekit-errors";

/** DELETE /api/sip-trunks/{trunkId} — works for inbound and outbound alike. */
export async function DELETE(
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
    return NextResponse.json({ error: "trunk id is required" }, { status: 400 });
  }

  try {
    await getSipClient().deleteSipTrunk(id);
    return NextResponse.json({ success: true, trunkId: id });
  } catch (error) {
    return livekitError(error, "SIP", "delete SIP trunk");
  }
}
