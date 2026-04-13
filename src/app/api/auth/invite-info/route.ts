import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const db = await ensureDb();
  const invite = await db.findInvite(token);
  if (!invite) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 404 });
  }

  return NextResponse.json({ email: invite.email, role: invite.role });
}
