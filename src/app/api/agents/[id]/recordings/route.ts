import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  deleteAgentRecordings,
  deleteRecording,
  listRecordings,
  saveRecording,
  type RecordingKind,
} from "@/lib/console-recordings";

/** 100 MB — a console session is minutes of Opus, so this is generous. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  return NextResponse.json({ recordings: await listRecordings(decodeURIComponent(id)) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const agent = decodeURIComponent(id);

  const form = await request.formData();
  const audio = form.get("audio");
  const room = form.get("room");
  const kind = form.get("kind");
  const durationMs = Number(form.get("durationMs") ?? 0);
  const startedAtMs = Number(form.get("startedAt") ?? 0);

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "audio file is required" }, { status: 400 });
  }
  if (typeof room !== "string" || !room) {
    return NextResponse.json({ error: "room is required" }, { status: 400 });
  }
  if (kind !== "mixed" && kind !== "agent" && kind !== "user") {
    return NextResponse.json(
      { error: "kind must be 'mixed', 'agent' or 'user'" },
      { status: 400 }
    );
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: "recording is empty" }, { status: 400 });
  }
  if (audio.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "recording is too large" }, { status: 413 });
  }

  const data = Buffer.from(await audio.arrayBuffer());

  try {
    const meta = await saveRecording(agent, {
      room,
      kind: kind as RecordingKind,
      mimeType: audio.type || "audio/webm",
      durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0,
      startedAtMs: Number.isFinite(startedAtMs) && startedAtMs > 0 ? startedAtMs : undefined,
      data,
    });
    return NextResponse.json({ recording: meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
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
  const { file, all } = await request.json();
  const agent = decodeURIComponent(id);

  // `all` backs "Clear events", which resets the console for this agent.
  if (all === true) {
    const deleted = await deleteAgentRecordings(agent);
    return NextResponse.json({ success: true, deleted });
  }

  if (typeof file !== "string" || !file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  try {
    const removed = await deleteRecording(agent, file);
    if (!removed) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, deleted: 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
