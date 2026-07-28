import fs from "fs";
import path from "path";
import { ensureDb, type DbConsoleSession } from "./db";
import { parseConsoleMetric } from "./console-metrics";
import { saveRecording } from "./console-recordings";
import {
  SESSION_EVENT_LIMIT,
  SESSION_METRIC_LIMIT,
  SESSION_TRANSCRIPT_LIMIT,
  dbTimeToIso,
  jsonTail,
  keepsExistingSession,
} from "./console-sessions";
import { captureDir } from "./session-observer";

/**
 * Adopts the files a session observer leaves behind.
 *
 * The observer (`observer/session-observer.mjs`) holds no dashboard credentials,
 * so it writes a `<capture>.json` — plus a `<capture>.wav` when it recorded audio
 * — into `data/session-captures` and exits. This is the other half: the JSON
 * becomes a `console_sessions` row and the WAV goes through `saveRecording`, so
 * it lands in whichever storage backend is configured rather than being stranded
 * on the dashboard's disk.
 *
 * Adoption runs when a room finishes and again whenever the history is listed, so
 * a capture written while the dashboard was restarting is picked up on the next
 * page load rather than lost.
 *
 * Two things are load-bearing here:
 *
 * - **Claiming.** A capture is renamed before it is read, so two concurrent
 *   passes — the webhook and a page load — cannot both adopt it.
 * - **Raw metrics.** The observer stores agent metric payloads exactly as they
 *   arrived and `parseConsoleMetric` runs here, so captured sessions cannot drift
 *   from the parser the console and the replay view share.
 */

/** A capture claimed but never finished (the process died mid-adoption). */
const CLAIM_STALE_MS = 5 * 60_000;

/** How long a capture whose audio will not upload keeps being retried. */
const RETRY_AGE_MS = 24 * 60 * 60_000;

interface CaptureFile {
  version?: number;
  source?: string;
  captureId?: string;
  agentName?: string;
  room?: string;
  roomSid?: string | null;
  talkMode?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  participants?: number;
  agentIdentity?: string | null;
  serverUrl?: string;
  events?: unknown[];
  metricsRaw?: { at: number; raw: unknown }[];
  transcript?: unknown[];
  audio?: {
    file: string;
    mimeType: string;
    durationMs: number;
    startedAtMs: number;
  } | null;
}

export interface AdoptionResult {
  adopted: number;
  failed: number;
}

/** One pass at a time in this process; the rename guards the rest. */
let inFlight: Promise<AdoptionResult> | null = null;

export function adoptCaptures(): Promise<AdoptionResult> {
  inFlight ??= runAdoption().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runAdoption(): Promise<AdoptionResult> {
  const dir = captureDir();
  const result: AdoptionResult = { adopted: 0, failed: 0 };

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return result;
  }

  reclaimAbandoned(dir, entries);

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;

    const source = path.join(dir, entry);
    const claim = `${source}.claimed`;
    try {
      // Atomic: whoever renames it owns it. A second pass sees ENOENT.
      fs.renameSync(source, claim);
    } catch {
      continue;
    }

    try {
      await adoptOne(dir, claim);
      result.adopted += 1;
    } catch (err) {
      result.failed += 1;
      console.error(`[capture] could not adopt ${entry}:`, err);
      // Put it back so the next pass retries, unless it is beyond saving.
      try {
        if (ageOf(claim) > RETRY_AGE_MS) fs.unlinkSync(claim);
        else fs.renameSync(claim, source);
      } catch {}
    }
  }

  return result;
}

function ageOf(file: string): number {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** Returns claims from a pass that died to the pool, so they are not orphaned. */
function reclaimAbandoned(dir: string, entries: string[]): void {
  for (const entry of entries) {
    if (!entry.endsWith(".json.claimed")) continue;
    const claim = path.join(dir, entry);
    if (ageOf(claim) < CLAIM_STALE_MS) continue;
    try {
      fs.renameSync(claim, claim.replace(/\.claimed$/, ""));
    } catch {}
  }
}

/**
 * Is the stored row the *same call* as this capture, rather than an earlier one
 * that happened to use the same room name?
 *
 * A LiveKit room SID identifies the room instance, so two calls in one room name
 * have different SIDs — that is the authoritative answer whenever both sides have
 * one. Older rows may not, so the fallback asks whether the stored session was
 * still running when this capture started.
 */
function isSameCall(existing: DbConsoleSession, capture: CaptureFile): boolean {
  const storedSid = (existing.room_sid || "").trim();
  const captureSid = (capture.roomSid || "").trim();
  if (storedSid && captureSid) return storedSid === captureSid;

  const startedAt = new Date(capture.startedAt ?? Date.now()).getTime();
  // `dbTimeToIso` because the two backends store this differently: a `Date` from
  // Postgres, `"YYYY-MM-DD HH:MM:SS"` UTC from SQLite, which `new Date()` would
  // read as local time and shift by the timezone offset.
  const storedEndIso = existing.ended_at ? dbTimeToIso(existing.ended_at) : "";
  const storedEnd = storedEndIso ? new Date(storedEndIso).getTime() : null;
  // No end time means the stored session never finished, so treat it as current.
  if (!storedEnd) return true;
  // A second of slack: the observer's clock and the row's are not the same clock.
  return startedAt <= storedEnd + 1000;
}

async function adoptOne(dir: string, claim: string): Promise<void> {
  let capture: CaptureFile;
  try {
    capture = JSON.parse(fs.readFileSync(claim, "utf8")) as CaptureFile;
  } catch {
    // Not JSON and never will be. Keep it out of the way but on disk, because a
    // corrupt capture is evidence of a bug worth looking at.
    fs.renameSync(claim, claim.replace(/\.json\.claimed$/, ".invalid"));
    return;
  }

  const room = typeof capture.room === "string" ? capture.room.trim() : "";
  if (!room) {
    fs.unlinkSync(claim);
    return;
  }

  const agentName = capture.agentName?.trim() || "unknown";
  const startedAt = new Date(capture.startedAt ?? Date.now()).toISOString();
  const endedAt = new Date(capture.endedAt ?? Date.now()).toISOString();
  const source = capture.source === "observer" ? "observer" : "capture";

  const db = await ensureDb();

  // A console tab that recorded the same *call* knows more than the observer does
  // — it had the local mic and the agent's own view of the session. That only
  // applies to the same call: `console_sessions` is keyed by room name, and a room
  // name gets reused (the agent-assist sandbox deliberately uses one room per
  // sandbox, and SIP dispatch rules can route every caller into one room). Without
  // the `isSameCall` check, the second call in a room was thrown away — its
  // transcript and metrics discarded while its audio overwrote the first call's,
  // leaving a history entry whose recording and transcript came from different
  // conversations.
  const existing = await db.findConsoleSessionByRoom(room);
  if (existing && isSameCall(existing, capture) && keepsExistingSession(existing.source, source)) {
    await attachAudio(dir, capture, agentName, room);
    fs.unlinkSync(claim);
    return;
  }

  const metrics = (capture.metricsRaw ?? [])
    .map((entry, index) => parseConsoleMetric(entry?.raw, Number(entry?.at) || Date.now(), index))
    .filter((metric) => metric !== null);

  // Audio first: a failure here throws, and the capture is retried rather than
  // leaving a history row that claims audio it never stored.
  await attachAudio(dir, capture, agentName, room);

  await db.upsertConsoleSession({
    agentName,
    room,
    roomSid: capture.roomSid || null,
    talkMode: capture.talkMode === "sip" ? "sip" : "browser",
    startedAt,
    endedAt,
    durationMs: Math.max(0, Math.round(capture.durationMs ?? 0)),
    participants: Math.max(0, Math.round(capture.participants ?? 0)),
    agentIdentity: capture.agentIdentity || null,
    serverUrl: capture.serverUrl || "",
    source,
    config: "{}",
    events: jsonTail(capture.events, SESSION_EVENT_LIMIT),
    metrics: jsonTail(metrics, SESSION_METRIC_LIMIT),
    transcript: jsonTail(capture.transcript, SESSION_TRANSCRIPT_LIMIT),
  });

  fs.unlinkSync(claim);
  console.log(
    `[capture] adopted ${room} — ${capture.transcript?.length ?? 0} transcript lines, ` +
      `${capture.events?.length ?? 0} events`
  );
}

/**
 * Moves the WAV into storage. Idempotent by file name: re-adopting a capture
 * overwrites the same object rather than piling up recordings for one room.
 */
async function attachAudio(
  dir: string,
  capture: CaptureFile,
  agentName: string,
  room: string
): Promise<void> {
  const audio = capture.audio;
  if (!audio?.file) return;

  const wavPath = path.join(dir, path.basename(audio.file));
  if (!fs.existsSync(wavPath)) return;

  await saveRecording(agentName, {
    room,
    kind: "mixed",
    mimeType: audio.mimeType || "audio/wav",
    durationMs: Math.max(0, Math.round(audio.durationMs ?? 0)),
    startedAtMs: audio.startedAtMs,
    data: fs.readFileSync(wavPath),
  });

  fs.unlinkSync(wavPath);
}
