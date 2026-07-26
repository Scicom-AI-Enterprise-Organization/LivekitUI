import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import {
  SESSION_EVENT_LIMIT,
  SESSION_METRIC_LIMIT,
  SESSION_TRANSCRIPT_LIMIT,
  jsonTail,
  serializeSession,
  serializeSessionSummary,
  toIsoInstant,
} from "@/lib/console-sessions";
import { deleteRoomRecordings } from "@/lib/console-recordings";
import { adoptCaptures } from "@/lib/session-capture";

/**
 * Session history.
 *
 * GET lists finished sessions (newest first) for the history page; POST is what
 * the console calls when a session ends, handing over the events, metrics and
 * transcript it had in memory. Audio is uploaded separately to
 * `/api/agents/<name>/recordings` and joined back by room name.
 *
 * Sessions nobody had a tab open for — an inbound SIP call, a sandbox app — are
 * recorded server-side instead and arrive as capture files, so listing also
 * adopts whatever the observers have finished writing.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sessions the observers captured become rows here, not when they were
  // recorded — so the list is the natural place to pick them up. Best-effort:
  // a storage backend that is down must not empty the history page.
  await adoptCaptures().catch((err) => console.error("[capture] adoption failed:", err));

  const params = request.nextUrl.searchParams;
  const limit = Math.min(
    Math.max(parseInt(params.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const offset = Math.max(parseInt(params.get("offset") || "0", 10) || 0, 0);

  const db = await ensureDb();
  const { sessions, total } = await db.listConsoleSessions({
    agent: params.get("agent")?.trim() || undefined,
    search: params.get("q")?.trim() || undefined,
    limit,
    offset,
  });

  return NextResponse.json({
    sessions: sessions.map(serializeSessionSummary),
    total,
    limit,
    offset,
    // Drives the agent filter without a second round trip.
    agents: await db.getConsoleSessionAgents(),
  });
}

export async function POST(request: NextRequest) {
  // Deliberately open to members: they can run a console session, so their
  // sessions must be able to record themselves. Deleting still needs a writer.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });
  }

  const agentName = typeof body.agentName === "string" ? body.agentName.trim() : "";
  const room = typeof body.room === "string" ? body.room.trim() : "";
  if (!agentName) {
    return NextResponse.json({ error: "agentName is required" }, { status: 400 });
  }
  if (!room) {
    return NextResponse.json({ error: "room is required" }, { status: 400 });
  }

  const startedAt = toIsoInstant(body.startedAt);
  if (!startedAt) {
    return NextResponse.json({ error: "startedAt is required" }, { status: 400 });
  }
  const endedAt = toIsoInstant(body.endedAt);

  const durationMs = Number(body.durationMs);
  const participants = Number(body.participants);

  const db = await ensureDb();
  const saved = await db.upsertConsoleSession({
    // A console tab is the better witness — it had the microphone, the config and
    // the agent's metrics stream — so this write always wins over a capture.
    source: "console",
    agentName,
    room,
    roomSid: typeof body.roomSid === "string" && body.roomSid ? body.roomSid : null,
    talkMode: body.talkMode === "sip" ? "sip" : "browser",
    startedAt,
    endedAt,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0,
    participants: Number.isFinite(participants) ? Math.max(0, Math.round(participants)) : 0,
    agentIdentity:
      typeof body.agentIdentity === "string" && body.agentIdentity ? body.agentIdentity : null,
    serverUrl: typeof body.serverUrl === "string" ? body.serverUrl : "",
    config:
      body.config && typeof body.config === "object" ? JSON.stringify(body.config) : "{}",
    events: jsonTail(body.events, SESSION_EVENT_LIMIT),
    metrics: jsonTail(body.metrics, SESSION_METRIC_LIMIT),
    transcript: jsonTail(body.transcript, SESSION_TRANSCRIPT_LIMIT),
  });

  return NextResponse.json({ session: serializeSession(saved) });
}

/** How many sessions one bulk delete may remove — a page of the history list. */
const MAX_BULK_DELETE = 200;

/**
 * Delete several sessions at once, for the history page's multi-select.
 *
 * Each session is removed independently rather than in a transaction: the audio
 * lives in object storage, so a bucket that refuses one file must not roll back
 * the rows that did delete. The response reports both halves, and the caller
 * shows what failed.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const rawIds = body && typeof body === "object" ? body.ids : null;
  if (!Array.isArray(rawIds)) {
    return NextResponse.json({ error: "ids must be an array of session ids" }, { status: 400 });
  }

  // De-duplicate before deleting, so a repeated id cannot report itself missing
  // on the second pass.
  const ids = Array.from(
    new Set(
      rawIds
        .map((value) => (typeof value === "number" ? value : parseInt(String(value), 10)))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );

  if (ids.length === 0) {
    return NextResponse.json({ error: "No valid session ids were given" }, { status: 400 });
  }
  if (ids.length > MAX_BULK_DELETE) {
    return NextResponse.json(
      { error: `Cannot delete more than ${MAX_BULK_DELETE} sessions at once` },
      { status: 400 }
    );
  }

  const db = await ensureDb();
  const deleted: number[] = [];
  const missing: number[] = [];
  const failed: { id: number; error: string }[] = [];
  let recordings = 0;

  for (const id of ids) {
    try {
      const removed = await db.deleteConsoleSession(id);
      if (!removed) {
        missing.push(id);
        continue;
      }
      deleted.push(id);
      // The transcript and the audio are one artefact — deleting half of it
      // would leave recordings nothing links to.
      recordings += await deleteRoomRecordings(removed.room);
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    success: failed.length === 0,
    requested: ids.length,
    deleted: deleted.length,
    deletedIds: deleted,
    missing,
    failed,
    recordings,
  });
}
