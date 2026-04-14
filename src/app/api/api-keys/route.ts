import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL || "ws://localhost:7880";
  const httpUrl = process.env.LIVEKIT_URL || "http://localhost:7880";
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";

  // Only admins/owners can see the secret
  const canSeeSecret = session.role === "owner" || session.role === "admin";

  return NextResponse.json({
    wsUrl,
    httpUrl,
    apiKey,
    apiSecret: canSeeSecret ? apiSecret : "",
    canSeeSecret,
  });
}
