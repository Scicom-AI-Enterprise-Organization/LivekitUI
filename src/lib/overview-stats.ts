/**
 * Overview analytics — turning LiveKit's live-only view into a time range.
 *
 * `listRooms()` returns what exists *right now*, so an Overview built on it
 * reads zero the moment the last call hangs up. LiveKit OSS stores no history
 * of its own, so the dashboard keeps one: the webhook receiver folds every
 * room/participant event into `room_sessions` and `participant_sessions`
 * (`recordAnalyticsEvent` below), and the page aggregates those.
 *
 * What is genuinely unavailable self-hosted is marked `available: false` rather
 * than reported as zero — see `UNAVAILABLE_SELF_HOSTED`. Client OS, transport
 * protocol and geo-IP are LiveKit Cloud analytics fields; the OSS server never
 * emits them, on any endpoint, so a zero there would be a lie rather than a
 * measurement.
 */
import type { Database, DbParticipantSession, DbRoomSession } from "./db";

/** Metrics with no source on a self-hosted server, and why. */
export const UNAVAILABLE_SELF_HOSTED = {
  platform:
    "Client OS and SDK are only reported by LiveKit Cloud analytics. The OSS server does not record them, so this stays empty unless a participant sets a platform attribute itself — the dashboard does that for sessions it starts.",
  country:
    "Geo-IP lookup is a LiveKit Cloud feature. The OSS server exposes a country label on its metrics but always leaves it empty.",
  connectionType:
    "UDP / TCP / TURN-relay breakdown is a LiveKit Cloud analytics field. The OSS server reports peer-connection state but not the transport that was negotiated.",
} as const;

// ── Time helpers ──────────────────────────────────────────────────────────

/**
 * Both dialects store these columns as `YYYY-MM-DD HH:MM:SS` in UTC. `new
 * Date()` on that string parses it as *local* time, which silently shifts every
 * bucket by the server's offset, so pin it to UTC explicitly.
 */
export function parseDbTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Epoch ms → the `YYYY-MM-DD HH:MM:SS` UTC form both dialects compare against. */
export function toDbTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/** LiveKit sends epoch seconds as strings, and epoch millis in `*Ms` fields. */
function epochMs(seconds: unknown, millis?: unknown): number {
  const ms = Number(millis);
  if (Number.isFinite(ms) && ms > 0) return ms;
  const s = Number(seconds);
  return Number.isFinite(s) && s > 0 ? s * 1000 : 0;
}

// ── Webhook → rollup ──────────────────────────────────────────────────────

interface WebhookRoom {
  sid?: string;
  name?: string;
  creationTime?: string | number;
  creationTimeMs?: string | number;
  numParticipants?: number;
}

interface WebhookParticipant {
  sid?: string;
  identity?: string;
  kind?: string;
  joinedAt?: string | number;
  joinedAtMs?: string | number;
  attributes?: Record<string, string>;
}

interface WebhookBody {
  event?: string;
  room?: WebhookRoom;
  participant?: WebhookParticipant;
  createdAt?: string | number;
}

/**
 * Inbound calls arrive through a dispatch rule, which stamps `sip.ruleID` on
 * the participant; outbound legs we placed ourselves have no rule. Newer SIP
 * builds set `sip.callDirection` outright — prefer it when present.
 */
function sipDirection(attrs: Record<string, string>): string {
  const explicit = attrs["sip.callDirection"];
  if (explicit) return explicit.toLowerCase();
  return attrs["sip.ruleID"] ? "inbound" : "outbound";
}

/**
 * The dashboard stamps `client.platform` on tokens it issues (see
 * `/api/livekit/token`), which is the only way a self-hosted server learns what
 * a participant is running.
 */
function participantPlatform(attrs: Record<string, string>): string | null {
  return attrs["client.platform"] || attrs["client.os"] || null;
}

/** Fold one LiveKit webhook into the analytics rollup. Unknown events are ignored. */
export async function recordAnalyticsEvent(db: Database, body: WebhookBody): Promise<void> {
  const event = body.event;
  const room = body.room || {};
  const roomSid = room.sid || "";
  if (!roomSid) return;

  const eventMs = epochMs(body.createdAt) || Date.now();

  switch (event) {
    case "room_started": {
      const startedMs = epochMs(room.creationTime, room.creationTimeMs) || eventMs;
      await db.recordRoomStarted(roomSid, room.name || "", toDbTime(startedMs));
      break;
    }
    case "room_finished": {
      const startedMs = epochMs(room.creationTime, room.creationTimeMs);
      const durationSec = startedMs > 0 ? Math.max(0, (eventMs - startedMs) / 1000) : 0;
      await db.recordRoomFinished(roomSid, toDbTime(eventMs), durationSec);
      break;
    }
    case "participant_joined": {
      const p = body.participant;
      if (!p?.identity) return;
      const attrs = p.attributes || {};
      const kind = (p.kind || "STANDARD").toUpperCase();
      await db.recordParticipantJoined({
        roomSid,
        roomName: room.name || "",
        identity: p.identity,
        kind,
        direction: kind === "SIP" ? sipDirection(attrs) : null,
        platform: participantPlatform(attrs),
        joinedAt: toDbTime(epochMs(p.joinedAt, p.joinedAtMs) || eventMs),
      });
      break;
    }
    case "participant_left": {
      const p = body.participant;
      if (!p?.identity) return;
      const joinedMs = epochMs(p.joinedAt, p.joinedAtMs);
      const durationSec = joinedMs > 0 ? Math.max(0, (eventMs - joinedMs) / 1000) : 0;
      await db.recordParticipantLeft(roomSid, p.identity, toDbTime(eventMs), durationSec);
      break;
    }
  }
}

/**
 * Replay the retained webhook log into the rollup.
 *
 * Only useful once, on an install that was collecting webhooks before these
 * tables existed — without it the Overview reads empty until new calls happen.
 * Every write is an upsert, so replaying is harmless.
 */
export async function backfillAnalytics(db: Database): Promise<number> {
  const events = await db.getWebhookEvents(500);
  // Oldest first, so a room's `started` is applied before its `finished`.
  const ordered = [...events].reverse();
  let applied = 0;
  for (const row of ordered) {
    try {
      await recordAnalyticsEvent(db, JSON.parse(row.payload));
      applied++;
    } catch {
      // A malformed or truncated payload should not stop the replay.
    }
  }
  return applied;
}

// ── Aggregation ───────────────────────────────────────────────────────────

export interface DayPoint {
  day: string;
  value: number;
}

export interface OverviewStats {
  rooms: {
    total: number;
    averageSize: number;
    averageDurationMin: number;
    perDay: DayPoint[];
  };
  participants: {
    total: number;
    minutes: number;
    byKind: { label: string; value: number }[];
    perDay: DayPoint[];
  };
  agents: {
    sessions: number;
    minutes: number;
    concurrentPeak: number;
  };
  telephony: {
    inboundSec: number;
    outboundSec: number;
    perDay: { day: string; inbound: number; outbound: number; total: number }[];
  };
  platforms: { label: string; value: number }[];
}

/** Day key in the viewer-agnostic form the charts label with. */
function dayKey(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Every day in the range, so a gap reads as zero rather than vanishing. */
function dayRange(hours: number): string[] {
  const days = Math.min(60, Math.max(1, Math.ceil(hours / 24)));
  const out: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    out.push(dayKey(now - i * 86_400_000));
  }
  return out;
}

function emptySeries(days: string[]): Map<string, number> {
  return new Map(days.map((d) => [d, 0]));
}

/**
 * A participant still in a room has no `left_at`; count its stay up to now so a
 * live call contributes minutes instead of reading zero until it ends.
 *
 * `roomEnd` closes the case where the `participant_left` webhook never landed —
 * dropped, or trimmed out of the log before backfill. Without it such a stay
 * accrues forever and one stale row can dwarf every real call.
 */
function staySeconds(p: DbParticipantSession, now: number, roomEnd?: number): number {
  if (p.duration_sec > 0) return p.duration_sec;
  const joined = parseDbTime(p.joined_at);
  if (!joined) return 0;
  const openUntil = roomEnd && roomEnd > 0 ? roomEnd : now;
  const end = p.left_at ? parseDbTime(p.left_at) : openUntil;
  return Math.max(0, (end - joined) / 1000);
}

function roomSeconds(r: DbRoomSession, now: number): number {
  if (r.duration_sec > 0) return r.duration_sec;
  const started = parseDbTime(r.started_at);
  if (!started) return 0;
  const end = r.ended_at ? parseDbTime(r.ended_at) : now;
  return Math.max(0, (end - started) / 1000);
}

/** Peak simultaneous agent participants, by sweeping join/leave edges. */
function peakConcurrent(
  sessions: DbParticipantSession[],
  now: number,
  roomEnds: Map<string, number>
): number {
  const edges: { at: number; delta: number }[] = [];
  for (const p of sessions) {
    const start = parseDbTime(p.joined_at);
    if (!start) continue;
    const end = p.left_at
      ? parseDbTime(p.left_at)
      : roomEnds.get(p.room_sid) || now;
    edges.push({ at: start, delta: 1 });
    edges.push({ at: Math.max(end, start), delta: -1 });
  }
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const e of edges) {
    current += e.delta;
    if (current > peak) peak = current;
  }
  return peak;
}

export async function computeOverviewStats(db: Database, hours: number): Promise<OverviewStats> {
  const [rooms, participants] = await Promise.all([
    db.getRoomSessions(hours),
    db.getParticipantSessions(hours),
  ]);
  const now = Date.now();
  const days = dayRange(hours);

  // ── Rooms ──
  // A closed room bounds every stay inside it, whether or not we saw the
  // matching participant_left.
  const roomEnds = new Map<string, number>();
  const roomsPerDay = emptySeries(days);
  let roomSecTotal = 0;
  for (const r of rooms) {
    roomSecTotal += roomSeconds(r, now);
    if (r.ended_at) roomEnds.set(r.room_sid, parseDbTime(r.ended_at));
    const key = dayKey(parseDbTime(r.started_at));
    if (roomsPerDay.has(key)) roomsPerDay.set(key, roomsPerDay.get(key)! + 1);
  }

  // ── Participants ──
  const participantsPerDay = emptySeries(days);
  const kindSeconds = new Map<string, number>();
  const platforms = new Map<string, number>();
  const telephonyPerDay = new Map(
    days.map((d) => [d, { inbound: 0, outbound: 0 }])
  );
  let inboundSec = 0;
  let outboundSec = 0;
  let webrtcSec = 0;
  let agentSec = 0;
  let agentSessions = 0;

  for (const p of participants) {
    const secs = staySeconds(p, now, roomEnds.get(p.room_sid));
    const key = dayKey(parseDbTime(p.joined_at));
    if (participantsPerDay.has(key)) {
      participantsPerDay.set(key, participantsPerDay.get(key)! + 1);
    }

    const kind = p.kind || "STANDARD";
    const label = kind === "STANDARD" ? "WebRTC" : kind === "SIP" ? "SIP" : kind === "AGENT" ? "Agent" : kind;
    kindSeconds.set(label, (kindSeconds.get(label) || 0) + secs);

    if (kind === "SIP") {
      if (p.direction === "outbound") {
        outboundSec += secs;
        const b = telephonyPerDay.get(key);
        if (b) b.outbound += secs;
      } else {
        inboundSec += secs;
        const b = telephonyPerDay.get(key);
        if (b) b.inbound += secs;
      }
    } else if (kind === "AGENT") {
      agentSec += secs;
      agentSessions++;
    } else {
      webrtcSec += secs;
      if (p.platform) platforms.set(p.platform, (platforms.get(p.platform) || 0) + 1);
    }
  }

  const totalRooms = rooms.length;
  const roomParticipants = new Map<string, number>();
  for (const p of participants) {
    roomParticipants.set(p.room_sid, (roomParticipants.get(p.room_sid) || 0) + 1);
  }
  const sizedRooms = rooms.filter((r) => roomParticipants.has(r.room_sid));
  const averageSize = sizedRooms.length
    ? sizedRooms.reduce((n, r) => n + (roomParticipants.get(r.room_sid) || 0), 0) / sizedRooms.length
    : 0;

  return {
    rooms: {
      total: totalRooms,
      averageSize: Number(averageSize.toFixed(2)),
      averageDurationMin: totalRooms ? Number((roomSecTotal / totalRooms / 60).toFixed(1)) : 0,
      perDay: days.map((day) => ({ day, value: roomsPerDay.get(day) || 0 })),
    },
    participants: {
      total: participants.length,
      minutes: Math.round(webrtcSec / 60),
      byKind: Array.from(kindSeconds.entries())
        .map(([label, secs]) => ({ label, value: Math.round(secs / 60) }))
        .filter((k) => k.value > 0)
        .sort((a, b) => b.value - a.value),
      perDay: days.map((day) => ({ day, value: participantsPerDay.get(day) || 0 })),
    },
    agents: {
      sessions: agentSessions,
      minutes: Math.round(agentSec / 60),
      concurrentPeak: peakConcurrent(
        participants.filter((p) => p.kind === "AGENT"),
        now,
        roomEnds
      ),
    },
    telephony: {
      inboundSec: Math.round(inboundSec),
      outboundSec: Math.round(outboundSec),
      perDay: days.map((day) => {
        const b = telephonyPerDay.get(day) || { inbound: 0, outbound: 0 };
        const inbound = Math.round(b.inbound / 60);
        const outbound = Math.round(b.outbound / 60);
        return { day, inbound, outbound, total: inbound + outbound };
      }),
    },
    platforms: Array.from(platforms.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
  };
}
