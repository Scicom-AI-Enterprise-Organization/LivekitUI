import { NextRequest, NextResponse } from "next/server";
import { getIngressClient } from "@/lib/livekit";
import { getSession } from "@/lib/auth";
import { livekitError } from "@/lib/livekit-errors";
import { serializeIngress } from "@/lib/api-serialize";

/** DELETE /api/ingresses/{ingressId} — remove an ingress. */
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
    return NextResponse.json({ error: "ingress id is required" }, { status: 400 });
  }

  try {
    const info = await getIngressClient().deleteIngress(id);
    return NextResponse.json({ success: true, ingress: serializeIngress(info) });
  } catch (error) {
    return livekitError(error, "ingress", "delete ingress");
  }
}
