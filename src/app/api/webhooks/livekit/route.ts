import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { recordAnalyticsEvent } from "@/lib/overview-stats";
import { adoptCaptures } from "@/lib/session-capture";
import { ensureObserver } from "@/lib/session-observer";

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

    // The raw event log is trimmed to the last 500 rows, so the Overview page
    // reads a rollup instead. Fold this event in before the row ages out.
    await recordAnalyticsEvent(db, body);

    // ── Session capture ──
    // This is the only moment the dashboard hears that a room exists without a
    // browser being involved — an inbound phone call, a sandbox app, any client
    // holding a token. An observer joins it here so the session still reaches the
    // history; see src/lib/session-observer.ts.
    //
    // Capture failures never fail the webhook: LiveKit retries a non-200, and a
    // retry storm is worse than a missing recording.
    if (event === "room_started" && room) {
      const startedMs =
        Number(body.room?.creationTimeMs) ||
        Number(body.room?.creationTime) * 1000 ||
        Date.now();
      await ensureObserver(room, {
        roomSid: body.room?.sid ?? null,
        startedAt: Number.isFinite(startedMs) ? startedMs : Date.now(),
      }).catch((err) => console.error("[capture] could not start an observer:", err));
    }

    // An observer writes its capture as the room closes, so this is the earliest
    // the history can pick it up. `GET /api/sessions` adopts too, which covers a
    // capture written while the dashboard was restarting.
    if (event === "room_finished") {
      await adoptCaptures().catch((err) => console.error("[capture] adoption failed:", err));
    }

    console.log(`[Webhook] ${event}${room ? ` room=${room}` : ""}${participant ? ` participant=${participant}` : ""}`);

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}
