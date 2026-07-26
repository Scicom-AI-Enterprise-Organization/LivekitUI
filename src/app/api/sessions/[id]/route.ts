import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { serializeSession } from "@/lib/console-sessions";
import { deleteRoomRecordings, listRecordingsForRoom } from "@/lib/console-recordings";

/** One stored session, with the audio recorded for its room. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const numericId = parseInt(id, 10);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const db = await ensureDb();
  const row = await db.getConsoleSession(numericId);
  if (!row) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({
    session: serializeSession(row),
    recordings: await listRecordingsForRoom(row.room),
  });
}

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
  const numericId = parseInt(id, 10);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const db = await ensureDb();
  const removed = await db.deleteConsoleSession(numericId);
  if (!removed) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // The transcript and the audio are one artefact — deleting half of it would
  // leave recordings nothing links to.
  const recordings = await deleteRoomRecordings(removed.room);
  return NextResponse.json({ success: true, room: removed.room, recordings });
}
