import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Extract event info
    const event = body.event || "unknown";
    const room = body.room?.name || body.room?.sid || null;
    const participant = body.participant?.identity || body.participant?.sid || null;

    // Store in DB
    const db = await ensureDb();
    await db.addWebhookEvent(event, room, participant, JSON.stringify(body));

    console.log(`[Webhook] ${event}${room ? ` room=${room}` : ""}${participant ? ` participant=${participant}` : ""}`);

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}
