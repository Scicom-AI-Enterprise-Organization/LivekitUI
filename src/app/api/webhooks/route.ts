import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "100", 10);
  const db = await ensureDb();
  const events = await db.getWebhookEvents(limit);

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      event: e.event,
      room: e.room,
      participant: e.participant,
      payload: e.payload,
      createdAt: e.created_at,
    })),
  });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const db = await ensureDb();
  await db.clearWebhookEvents();

  return NextResponse.json({ success: true });
}
