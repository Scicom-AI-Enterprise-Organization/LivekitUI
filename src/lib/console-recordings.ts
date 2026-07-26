import fs from "fs";
import path from "path";
import { ensureDb, type DbSessionRecording } from "./db";
import { dbTimeToIso } from "./console-sessions";
import { deleteObject, getObject, putObject } from "./storage";

/**
 * Console session audio.
 *
 * The browser records a session (the agent alone, your side alone, and the mix)
 * and uploads it here when the session ends, so a call can be listened to after
 * the page is closed — and replayed from Sessions → History alongside its
 * events and transcript.
 *
 * The bytes go to whatever Settings → Storage points at (the dashboard's disk,
 * or an S3-compatible bucket). The index lives in the database, which is what
 * makes recordings queryable across agents and survivable across redeploys.
 */

/** `user` is your microphone or the caller, `agent` its TTS, `mixed` both. */
export type RecordingKind = "mixed" | "agent" | "user";

export interface RecordingMeta {
  /** Identifies the recording within an agent, and names the stored object. */
  file: string;
  agent: string;
  room: string;
  kind: RecordingKind;
  mimeType: string;
  bytes: number;
  durationMs: number;
  /**
   * When recording started (wall clock). The Console lines this up with event
   * timestamps so the timeline playhead tracks the audio, so it is reported by
   * the recorder rather than inferred from the upload time.
   */
  startedAt: string;
  createdAt: string;
  /** Which backend holds the bytes: "local" or "s3". */
  storage: string;
}

/** Rejects anything that could escape the recordings directory. */
function assertSafeSegment(value: string, what: string): void {
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error(`Invalid ${what}`);
  }
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function toIso(value: unknown): string {
  return dbTimeToIso(value, new Date().toISOString());
}

function toMeta(row: DbSessionRecording): RecordingMeta {
  return {
    file: row.file,
    agent: row.agent_name,
    room: row.room,
    kind: row.kind as RecordingKind,
    mimeType: row.mime_type,
    bytes: row.bytes,
    durationMs: row.duration_ms,
    startedAt: toIso(row.started_at),
    createdAt: toIso(row.created_at),
    storage: row.storage,
  };
}

// ---------------------------------------------------------------------------
// Legacy import
// ---------------------------------------------------------------------------

/**
 * Recordings written before the index existed are described by a JSON sidecar
 * next to the audio. They are adopted into the database on first read so the
 * upgrade does not look like data loss. The audio itself does not move — those
 * rows keep `storage = "local"`.
 */
let legacyImported = false;

async function importLegacyRecordings(): Promise<void> {
  if (legacyImported) return;
  legacyImported = true;

  const root = path.join(process.cwd(), "data", "console-recordings");
  if (!fs.existsSync(root)) return;

  const db = await ensureDb();

  for (const dir of fs.readdirSync(root)) {
    const agentDir = path.join(root, dir);
    if (!fs.statSync(agentDir).isDirectory()) continue;

    for (const entry of fs.readdirSync(agentDir)) {
      if (!entry.endsWith(".json")) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(agentDir, entry), "utf8")) as
          Partial<RecordingMeta> & { file?: string; agent?: string };
        if (!meta.file || !meta.agent) continue;
        if (!fs.existsSync(path.join(agentDir, meta.file))) continue;
        if (await db.findSessionRecording(meta.agent, meta.file)) continue;

        const createdAt = meta.createdAt || new Date().toISOString();
        await db.addSessionRecording({
          agentName: meta.agent,
          room: meta.room || meta.file.replace(/-(mixed|agent|user)\.[a-z0-9]+$/, ""),
          kind: meta.kind || "mixed",
          file: meta.file,
          storage: "local",
          objectKey: `${dir}/${meta.file}`,
          mimeType: meta.mimeType || "audio/webm",
          bytes: meta.bytes || 0,
          durationMs: meta.durationMs || 0,
          startedAt:
            meta.startedAt ||
            new Date(new Date(createdAt).getTime() - (meta.durationMs || 0)).toISOString(),
        });
      } catch {
        // A malformed sidecar should not stop the rest from being adopted.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

export async function saveRecording(
  agent: string,
  input: {
    room: string;
    kind: RecordingKind;
    mimeType: string;
    durationMs: number;
    /** Epoch ms when recording started; falls back to now − duration. */
    startedAtMs?: number;
    data: Buffer;
  }
): Promise<RecordingMeta> {
  const file = `${slug(input.room)}-${input.kind}.${extensionFor(input.mimeType)}`;
  const key = `${slug(agent)}/${file}`;

  const stored = await putObject(key, input.data, input.mimeType || "audio/webm");

  const startedAtMs =
    input.startedAtMs && Number.isFinite(input.startedAtMs)
      ? input.startedAtMs
      : Date.now() - input.durationMs;

  const db = await ensureDb();
  const row = await db.addSessionRecording({
    agentName: agent,
    room: input.room,
    kind: input.kind,
    file,
    storage: stored.storage,
    objectKey: stored.objectKey,
    mimeType: input.mimeType || "audio/webm",
    bytes: input.data.byteLength,
    durationMs: input.durationMs,
    startedAt: new Date(startedAtMs).toISOString(),
  });

  return toMeta(row);
}

export async function listRecordings(agent: string): Promise<RecordingMeta[]> {
  await importLegacyRecordings();
  const db = await ensureDb();
  return (await db.getSessionRecordings(agent)).map(toMeta);
}

/** Every recording of one session, which is how the replay view finds audio. */
export async function listRecordingsForRoom(room: string): Promise<RecordingMeta[]> {
  await importLegacyRecordings();
  const db = await ensureDb();
  return (await db.getSessionRecordingsForRoom(room)).map(toMeta);
}

export async function readRecording(
  agent: string,
  file: string
): Promise<{ data: Buffer; meta: RecordingMeta } | null> {
  assertSafeSegment(file, "file name");
  await importLegacyRecordings();

  const db = await ensureDb();
  const row = await db.findSessionRecording(agent, file);
  if (!row) return null;

  const data = await getObject(row.storage, row.object_key);
  if (!data) return null;

  return { data, meta: toMeta(row) };
}

export async function deleteRecording(agent: string, file: string): Promise<boolean> {
  assertSafeSegment(file, "file name");
  const db = await ensureDb();
  const row = await db.deleteSessionRecording(agent, file);
  if (!row) return false;

  await removeObjects([row]);
  return true;
}

/**
 * Removes every recording for an agent. Used when the agent is deleted and when
 * the Console clears a session. Returns how many audio files went away.
 */
export async function deleteAgentRecordings(agent: string): Promise<number> {
  await importLegacyRecordings();
  const db = await ensureDb();
  const rows = await db.deleteSessionRecordingsForAgent(agent);
  await removeObjects(rows);
  return rows.length;
}

/** Removes the audio of one session, when its history entry is deleted. */
export async function deleteRoomRecordings(room: string): Promise<number> {
  const db = await ensureDb();
  const rows = await db.deleteSessionRecordingsForRoom(room);
  await removeObjects(rows);
  return rows.length;
}

/**
 * Deletes the stored objects behind rows that are already gone from the index.
 * A storage backend that refuses is logged, not thrown: the index is the source
 * of truth for the UI, and a stuck bucket must not block deleting a session.
 */
async function removeObjects(rows: DbSessionRecording[]): Promise<void> {
  for (const row of rows) {
    try {
      await deleteObject(row.storage, row.object_key);
      // Legacy sidecars are left behind by object deletion; clear them too.
      if (row.storage === "local") {
        fs.rmSync(
          path.join(process.cwd(), "data", "console-recordings", `${row.object_key}.json`),
          { force: true }
        );
      }
    } catch (err) {
      console.error(
        `[recordings] could not delete ${row.storage}:${row.object_key}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}
