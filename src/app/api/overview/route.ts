import { NextRequest, NextResponse } from "next/server";
import { getRoomServiceClient } from "@/lib/livekit";
import { ParticipantInfo_Kind } from "@livekit/protocol";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import {
  backfillAnalytics,
  computeOverviewStats,
  UNAVAILABLE_SELF_HOSTED,
} from "@/lib/overview-stats";

/**
 * Overview metrics for a time range.
 *
 * History comes from the dashboard's own rollup (`room_sessions` /
 * `participant_sessions`, written by the webhook receiver) because LiveKit
 * itself keeps none — `listRooms()` is a snapshot of what is live this instant.
 * The live counts are still reported alongside, for the "right now" cards.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hours = Math.min(
      24 * 60,
      Math.max(1, parseInt(request.nextUrl.searchParams.get("hours") || "168", 10) || 168)
    );

    const db = await ensureDb();

    // An install that was already collecting webhooks before the rollup tables
    // existed has history in the (trimmed) event log and nowhere else. Replay
    // it once so the page is not empty on first load; the writes are upserts.
    if ((await db.getRoomSessions(24 * 60)).length === 0) {
      await backfillAnalytics(db);
    }

    const stats = await computeOverviewStats(db, hours);

    // ── What is live right now ──
    let liveRooms = 0;
    let liveParticipants = 0;
    let liveAgents = 0;
    let liveAvailable = true;
    try {
      const client = getRoomServiceClient();
      const rooms = await client.listRooms();
      liveRooms = rooms.length;
      for (const room of rooms) {
        liveParticipants += room.numParticipants || 0;
        try {
          const participants = await client.listParticipants(room.name);
          for (const p of participants) {
            if (p.kind === ParticipantInfo_Kind.AGENT) liveAgents++;
          }
        } catch {}
      }
    } catch {
      liveAvailable = false;
    }

    return NextResponse.json({
      hours,
      rooms: {
        total: stats.rooms.total,
        averageSize: stats.rooms.averageSize,
        averageDurationMin: stats.rooms.averageDurationMin,
        perDay: stats.rooms.perDay,
      },
      participants: {
        total: stats.participants.total,
        minutes: stats.participants.minutes,
        byKind: stats.participants.byKind,
        perDay: stats.participants.perDay,
      },
      agents: {
        sessions: stats.agents.sessions,
        minutes: stats.agents.minutes,
        concurrentPeak: stats.agents.concurrentPeak,
        activeSessions: liveAgents,
      },
      telephony: stats.telephony,
      platforms: stats.platforms,
      live: {
        available: liveAvailable,
        rooms: liveRooms,
        participants: liveParticipants,
        agents: liveAgents,
      },
      // Fields the OSS server never emits. The page renders the reason instead
      // of a zero, which would read as "measured none".
      unavailable: {
        platforms: stats.platforms.length === 0 ? UNAVAILABLE_SELF_HOSTED.platform : null,
        topCountries: UNAVAILABLE_SELF_HOSTED.country,
        connectionTypes: UNAVAILABLE_SELF_HOSTED.connectionType,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
