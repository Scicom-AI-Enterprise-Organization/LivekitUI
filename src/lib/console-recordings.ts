import fs from "fs";
import path from "path";

/**
 * Console session audio, stored on disk next to agent logs.
 *
 * The browser records the session (agent output, and the mix of agent + your
 * microphone) and uploads it here when the session ends, so a call can still be
 * listened to after the page is closed.
 */

export type RecordingKind = "mixed" | "agent";

export interface RecordingMeta {
  /** File name on disk, also the id used by the API. */
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

function getRecordingsRoot(): string {
  const dir = path.join(process.cwd(), "data", "console-recordings");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAgentRecordingsDir(agent: string): string {
  const dir = path.join(getRecordingsRoot(), slug(agent));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

export function saveRecording(
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
): RecordingMeta {
  const dir = getAgentRecordingsDir(agent);
  const file = `${slug(input.room)}-${input.kind}.${extensionFor(input.mimeType)}`;

  fs.writeFileSync(path.join(dir, file), input.data);

  const startedAtMs =
    input.startedAtMs && Number.isFinite(input.startedAtMs)
      ? input.startedAtMs
      : Date.now() - input.durationMs;

  const meta: RecordingMeta = {
    file,
    agent,
    room: input.room,
    kind: input.kind,
    mimeType: input.mimeType,
    bytes: input.data.byteLength,
    durationMs: input.durationMs,
    startedAt: new Date(startedAtMs).toISOString(),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, `${file}.json`), JSON.stringify(meta, null, 2));

  return meta;
}

/** Fills in `startedAt` for sidecars written before it was recorded. */
function withStartedAt(meta: RecordingMeta): RecordingMeta {
  if (meta.startedAt) return meta;
  const created = new Date(meta.createdAt).getTime();
  return {
    ...meta,
    startedAt: new Date(created - (meta.durationMs || 0)).toISOString(),
  };
}

export function listRecordings(agent: string): RecordingMeta[] {
  const dir = getAgentRecordingsDir(agent);
  const metas: RecordingMeta[] = [];

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8")) as RecordingMeta;
      // Skip sidecars whose audio was removed by hand.
      if (fs.existsSync(path.join(dir, meta.file))) metas.push(withStartedAt(meta));
    } catch {}
  }

  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readRecording(
  agent: string,
  file: string
): { data: Buffer; meta: RecordingMeta | null } | null {
  assertSafeSegment(file, "file name");
  const dir = getAgentRecordingsDir(agent);
  const audioPath = path.join(dir, file);
  if (!fs.existsSync(audioPath)) return null;

  let meta: RecordingMeta | null = null;
  try {
    meta = withStartedAt(
      JSON.parse(fs.readFileSync(`${audioPath}.json`, "utf8")) as RecordingMeta
    );
  } catch {}

  return { data: fs.readFileSync(audioPath), meta };
}

export function deleteRecording(agent: string, file: string): boolean {
  assertSafeSegment(file, "file name");
  const dir = getAgentRecordingsDir(agent);
  const audioPath = path.join(dir, file);
  if (!fs.existsSync(audioPath)) return false;

  fs.rmSync(audioPath, { force: true });
  fs.rmSync(`${audioPath}.json`, { force: true });
  return true;
}

/** Removes every recording for an agent — used when the agent is deleted. */
export function deleteAgentRecordings(agent: string): void {
  const dir = path.join(getRecordingsRoot(), slug(agent));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
