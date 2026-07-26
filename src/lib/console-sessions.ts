import type { DbConsoleSession, DbConsoleSessionSummary } from "./db";

/**
 * Console session history — the shape the API speaks.
 *
 * A live console session holds its events, metrics and transcript in the
 * browser and loses them on reload. When a session ends the console posts them
 * here, so `/sessions/history` can replay the whole thing later: the same
 * panels, driven by saved data and recorded audio instead of a live room.
 */

/**
 * Stamped on the tokens the console joins with, so the server-side observer can
 * tell that a tab is already recording the room and stand down rather than
 * writing a second copy of the same audio.
 */
export const CONSOLE_PARTICIPANT_ATTRIBUTE = "dashboard.console";

/** Caps on one stored session, mirroring the console's own in-memory limits. */
export const SESSION_EVENT_LIMIT = 5000;
export const SESSION_METRIC_LIMIT = 5000;
export const SESSION_TRANSCRIPT_LIMIT = 2000;

export interface SessionSummary {
  id: number;
  agentName: string;
  room: string;
  roomSid: string | null;
  talkMode: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  participants: number;
  eventCount: number;
  metricCount: number;
  transcriptCount: number;
  agentIdentity: string | null;
  serverUrl: string;
  /** Which writer produced the row — see `SESSION_SOURCE_RANK`. */
  source: string;
  createdAt: string;
}

export interface SessionDetail extends SessionSummary {
  config: Record<string, unknown>;
  events: unknown[];
  metrics: unknown[];
  transcript: unknown[];
}

/**
 * Normalises the several time formats the two database backends hand back:
 * `Date` from Postgres, `"YYYY-MM-DD HH:MM:SS"` (UTC) from SQLite, ISO strings
 * from anything we wrote ourselves.
 */
export function dbTimeToIso(value: unknown, fallback = ""): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) {
    const normalized = /^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(" ", "T")}Z` : value;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

function parseArray(json: string, limit: number): unknown[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    return [];
  }
}

export function serializeSessionSummary(row: DbConsoleSessionSummary): SessionSummary {
  return {
    id: row.id,
    agentName: row.agent_name,
    room: row.room,
    roomSid: row.room_sid,
    talkMode: row.talk_mode,
    startedAt: dbTimeToIso(row.started_at),
    endedAt: row.ended_at ? dbTimeToIso(row.ended_at) : null,
    durationMs: row.duration_ms,
    participants: row.participants,
    eventCount: row.event_count,
    metricCount: row.metric_count,
    transcriptCount: row.transcript_count,
    agentIdentity: row.agent_identity,
    serverUrl: row.server_url,
    source: row.source || "console",
    createdAt: dbTimeToIso(row.created_at),
  };
}

export function serializeSession(row: DbConsoleSession): SessionDetail {
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.config);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
  } catch {}

  return {
    ...serializeSessionSummary(row),
    config,
    events: parseArray(row.events, SESSION_EVENT_LIMIT),
    metrics: parseArray(row.metrics, SESSION_METRIC_LIMIT),
    transcript: parseArray(row.transcript, SESSION_TRANSCRIPT_LIMIT),
  };
}

/**
 * Who is allowed to overwrite whose row.
 *
 * Two writers can describe the same room. A console tab is the better witness:
 * it holds the local microphone, the agent's own metrics stream and the config
 * the session ran with, and it records its own audio. The server-side observer
 * sees a subscriber's view and no config at all. So a capture never replaces a
 * console row — it only fills in the sessions nobody had a tab open for.
 *
 * A writer may always replace its own kind, which is what makes re-adopting a
 * capture and re-saving a console session harmless.
 */
export const SESSION_SOURCE_RANK: Record<string, number> = {
  console: 2,
  observer: 1,
  capture: 1,
};

export function sessionSourceRank(source: string | null | undefined): number {
  return SESSION_SOURCE_RANK[source || "console"] ?? 0;
}

/** True when `existing` outranks `incoming` and must be left alone. */
export function keepsExistingSession(
  existing: string | null | undefined,
  incoming: string
): boolean {
  return sessionSourceRank(existing) > sessionSourceRank(incoming);
}

/** Accepts epoch ms or an ISO string; returns an ISO string or null. */
export function toIsoInstant(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

/** Keeps the newest `limit` entries of an untrusted array, as JSON. */
export function jsonTail(value: unknown, limit: number): string {
  if (!Array.isArray(value)) return "[]";
  return JSON.stringify(value.length > limit ? value.slice(-limit) : value);
}
