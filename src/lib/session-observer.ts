import childProcess from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { AccessToken } from "livekit-server-sdk";
import { getAgentDispatchClient } from "./livekit";
import { CONSOLE_METRICS_TOPIC } from "./console-metrics";
import { CONSOLE_PARTICIPANT_ATTRIBUTE } from "./console-sessions";
import { loadCaptureSettings } from "./capture-settings";

/**
 * Supervises the session observers — one child process per live room.
 *
 * The console can only record sessions it is a participant in. A phone call
 * arriving over SIP, or a sandbox app talking to an agent, used to leave nothing
 * behind at all. So the `room_started` webhook starts an observer here: a hidden
 * participant that writes the room's transcript, events and audio to
 * `data/session-captures`, where `session-capture.ts` adopts it into history.
 *
 * Capture is **off until it is switched on** in Settings → Project — see
 * `capture-settings.ts`. Nothing here runs for a deployment that has not asked
 * for it.
 *
 * The pattern is `agent-runner.ts`': detached children with PID files on disk,
 * because this module keeps no state across dev-server reloads. A restart of the
 * dashboard leaves the observers running — which is the point, since they are
 * recording calls that are still up.
 *
 * The child gets a room token and nothing else. It cannot reach the dashboard
 * API, and it does not need to: dropping files is the whole contract.
 */

/** Identity prefix the console uses; the observer defers to a tab that has it. */
export const CONSOLE_IDENTITY_PREFIX = "console-";

/** Prefix for the observer's own participants, so they are recognisable in logs. */
const OBSERVER_IDENTITY_PREFIX = "session-observer-";

export interface ObserverRecord {
  room: string;
  pid: number;
  captureId: string;
  startedAt: number;
  logFile: string;
}

function dataDir(...parts: string[]): string {
  const dir = path.join(process.cwd(), "data", ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Where finished captures wait to be adopted. Shared with session-capture.ts. */
export function captureDir(): string {
  return dataDir("session-captures");
}

function observersDir(): string {
  return dataDir("observers");
}

function logsDir(): string {
  return dataDir("observer-logs");
}

/** A room name is user-supplied and lands in a filename, so flatten it. */
function slug(room: string): string {
  return room.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "room";
}

function recordPath(room: string): string {
  return path.join(observersDir(), `${slug(room)}.json`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRecord(room: string): ObserverRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath(room), "utf8")) as ObserverRecord;
    return typeof parsed?.pid === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function forgetRecord(room: string): void {
  try {
    fs.unlinkSync(recordPath(room));
  } catch {}
}

/** The observer for this room, if one is still running. */
export function findObserver(room: string): ObserverRecord | null {
  const record = readRecord(room);
  if (!record) return null;
  if (alive(record.pid)) return record;
  // The child exits on its own when the room empties; the file is just stale.
  forgetRecord(room);
  return null;
}

export function listObservers(): ObserverRecord[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(observersDir());
  } catch {
    return [];
  }

  const running: ObserverRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const record = JSON.parse(
        fs.readFileSync(path.join(observersDir(), file), "utf8")
      ) as ObserverRecord;
      if (record?.pid && alive(record.pid)) running.push(record);
      else fs.unlinkSync(path.join(observersDir(), file));
    } catch {}
  }
  return running;
}

/** Asks an observer to wrap up. It still writes its capture on the way out. */
export function stopObserver(room: string): boolean {
  const record = findObserver(room);
  if (!record) return false;
  try {
    process.kill(record.pid, "SIGTERM");
  } catch {}
  forgetRecord(room);
  return true;
}

/**
 * The agent the room was dispatched to.
 *
 * Worth the round trip: an agent's participant identity is job-scoped
 * (`agent-<id>`), so the dispatch is the only place the *name* the dashboard
 * knows it by actually appears. Inbound SIP has no other source at all.
 */
async function resolveAgentName(room: string): Promise<string> {
  try {
    const dispatches = await getAgentDispatchClient().listDispatch(room);
    const named = dispatches.find((d) => d.agentName);
    return named?.agentName ?? "";
  } catch {
    // No dispatch API (Redis down, service missing) — the observer falls back to
    // the room name and then to the agent participant.
    return "";
  }
}

async function observerToken(
  room: string,
  identity: string,
  maxMinutes: number
): Promise<string> {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity,
    name: "Session capture",
    // Long enough for the longest call the observer is allowed to record.
    ttl: `${maxMinutes + 10}m`,
  });

  at.addGrant({
    room,
    roomJoin: true,
    canSubscribe: true,
    // It listens and nothing more: no tracks, no data, no room mutations.
    canPublish: false,
    canPublishData: false,
    // Hidden keeps it out of everyone's participant list — an observer must not
    // change what the agent or the caller sees. `recorder` is the honest half of
    // that: clients can tell the room is being recorded.
    hidden: true,
    recorder: true,
  });

  return at.toJwt();
}

/** rtc-node speaks WebSocket; `LIVEKIT_URL` is often written as http. */
function websocketUrl(): string {
  const url = process.env.LIVEKIT_URL || "ws://localhost:7880";
  return url.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

/**
 * Starts an observer for a room, unless one is already on it.
 *
 * Safe to call more than once — the `room_started` webhook can be retried, and
 * two observers on one room would fight over the same capture files.
 */
export async function ensureObserver(
  room: string,
  opts: { roomSid?: string | null; startedAt?: number } = {}
): Promise<ObserverRecord | null> {
  if (!room) return null;
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) return null;

  const settings = await loadCaptureSettings();
  if (!settings.enabled) return null;

  const existing = findObserver(room);
  if (existing) return existing;

  const captureId = `${slug(room)}-${opts.startedAt ?? Date.now()}`;
  const identity = `${OBSERVER_IDENTITY_PREFIX}${crypto.randomBytes(3).toString("hex")}`;
  const script = path.join(process.cwd(), "observer", "session-observer.mjs");

  if (!fs.existsSync(script)) {
    console.error(`[capture] observer script missing at ${script}`);
    return null;
  }

  const token = await observerToken(room, identity, settings.maxMinutes);
  const agentName = await resolveAgentName(room);

  const logFile = path.join(logsDir(), `${slug(room)}.log`);
  const out = fs.openSync(logFile, "a");

  const child = childProcess.spawn(process.execPath, [script], {
    env: {
      ...process.env,
      OBSERVER_URL: websocketUrl(),
      OBSERVER_TOKEN: token,
      OBSERVER_ROOM: room,
      OBSERVER_ROOM_SID: opts.roomSid ?? "",
      OBSERVER_ROOM_STARTED_AT: String(opts.startedAt ?? Date.now()),
      OBSERVER_OUT_DIR: captureDir(),
      OBSERVER_CAPTURE_ID: captureId,
      // The child clears its own record on the way out. Liveness checks would
      // catch a stale file anyway, but only for a room somebody asks about —
      // otherwise every room ever observed leaves one behind.
      OBSERVER_RECORD_FILE: recordPath(room),
      OBSERVER_AGENT: agentName,
      OBSERVER_SERVER_URL: process.env.LIVEKIT_URL || websocketUrl(),
      OBSERVER_METRICS_TOPIC: CONSOLE_METRICS_TOPIC,
      OBSERVER_CONSOLE_PREFIX: CONSOLE_IDENTITY_PREFIX,
      OBSERVER_CONSOLE_ATTRIBUTE: CONSOLE_PARTICIPANT_ATTRIBUTE,
      OBSERVER_MAX_MINUTES: String(settings.maxMinutes),
      OBSERVER_AUDIO: settings.audio ? "on" : "off",
    },
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();

  if (!child.pid) {
    console.error(`[capture] could not spawn an observer for ${room}`);
    return null;
  }

  const record: ObserverRecord = {
    room,
    pid: child.pid,
    captureId,
    startedAt: opts.startedAt ?? Date.now(),
    logFile,
  };
  fs.writeFileSync(recordPath(room), JSON.stringify(record));
  console.log(`[capture] observing ${room} (pid ${child.pid}, agent ${agentName || "unknown"})`);
  return record;
}
