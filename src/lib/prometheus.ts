/**
 * Scrapes the LiveKit server's Prometheus endpoint (`prometheus.port` in
 * `livekit.yaml`, 6789 by default) for the Overview page.
 *
 * The counters are cumulative and reset when the server restarts, so a chart
 * needs a series of readings rather than one number. Readings are persisted to
 * `bandwidth_samples` — an in-memory array would reset on every dev-server
 * recompile and could not be shared across workers in production.
 */
import type { Database, DbBandwidthSample } from "./db";
import { parseDbTime } from "./overview-stats";

const PROM_URL = process.env.LIVEKIT_PROMETHEUS_URL || "http://localhost:6789/metrics";

interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function parsePrometheus(text: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{?(.*?)\}?\s+([\d.eE+-]+|NaN|Inf|\+Inf|-Inf)$/);
    if (!m) continue;
    const name = m[1];
    const labelsStr = m[2];
    const value = parseFloat(m[3]);
    if (!Number.isFinite(value)) continue;
    const labels: Record<string, string> = {};
    if (labelsStr) {
      for (const pair of labelsStr.match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g) || []) {
        const eq = pair.indexOf("=");
        labels[pair.slice(0, eq)] = pair.slice(eq + 2, -1);
      }
    }
    samples.push({ name, labels, value });
  }
  return samples;
}

export interface LiveKitMetrics {
  /** Media bytes received from clients. `livekit_packet_bytes{direction=incoming}`. */
  bytesIn: number;
  /** Media bytes sent to clients. `livekit_packet_bytes{direction=outgoing}`. */
  bytesOut: number;
  packetsIn: number;
  packetsOut: number;
  packetsDropped: number;
  /** Sessions that got as far as a signal connection — the connection-success denominator. */
  joinSignalConnected: number;
  /** Sessions that completed the RTC handshake — the numerator. */
  joinRtcSuccess: number;
  roomTotal: number;
  participantTotal: number;
  roomDurationSecSum: number;
  roomDurationCount: number;
  sessionDurationMsSum: number;
  sessionDurationCount: number;
  trackPublishedAudio: number;
  trackPublishedVideo: number;
}

const EMPTY_METRICS: LiveKitMetrics = {
  bytesIn: 0,
  bytesOut: 0,
  packetsIn: 0,
  packetsOut: 0,
  packetsDropped: 0,
  joinSignalConnected: 0,
  joinRtcSuccess: 0,
  roomTotal: 0,
  participantTotal: 0,
  roomDurationSecSum: 0,
  roomDurationCount: 0,
  sessionDurationMsSum: 0,
  sessionDurationCount: 0,
  trackPublishedAudio: 0,
  trackPublishedVideo: 0,
};

export async function scrapeLiveKitMetrics(): Promise<LiveKitMetrics> {
  const res = await fetch(PROM_URL, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Prometheus endpoint returned ${res.status}`);
  const samples = parsePrometheus(await res.text());

  const m: LiveKitMetrics = { ...EMPTY_METRICS };

  for (const s of samples) {
    switch (s.name) {
      // Media bytes relayed by the SFU. The psrpc counters this used to read
      // measure signalling between nodes, which on a single-node server is
      // near-constant and unrelated to what participants actually transferred.
      case "livekit_packet_bytes":
        if (s.labels.direction === "incoming") m.bytesIn += s.value;
        if (s.labels.direction === "outgoing") m.bytesOut += s.value;
        break;
      case "livekit_packet_total":
        if (s.labels.direction === "incoming") m.packetsIn += s.value;
        if (s.labels.direction === "outgoing") m.packetsOut += s.value;
        break;
      case "livekit_node_packet_total":
        if (s.labels.type === "dropped") m.packetsDropped += s.value;
        break;
      case "livekit_participant_join_total":
        if (s.labels.state === "signal_connected") m.joinSignalConnected += s.value;
        if (s.labels.state === "rtc_success") m.joinRtcSuccess += s.value;
        break;
      case "livekit_room_total":
        m.roomTotal += s.value;
        break;
      case "livekit_participant_total":
        m.participantTotal += s.value;
        break;
      case "livekit_room_duration_seconds_sum":
        m.roomDurationSecSum += s.value;
        break;
      case "livekit_room_duration_seconds_count":
        m.roomDurationCount += s.value;
        break;
      case "livekit_session_duration_ms_sum":
        m.sessionDurationMsSum += s.value;
        break;
      case "livekit_session_duration_ms_count":
        m.sessionDurationCount += s.value;
        break;
      case "livekit_track_published_total":
        if (s.labels.kind === "AUDIO") m.trackPublishedAudio += s.value;
        if (s.labels.kind === "VIDEO") m.trackPublishedVideo += s.value;
        break;
    }
  }

  return m;
}

/**
 * Share of sessions that got past signalling to a working RTC connection.
 * Returns null when nothing has connected yet, so the card can say "no data"
 * instead of claiming a fabricated 100%.
 */
export function connectionSuccessRate(m: LiveKitMetrics): number | null {
  if (m.joinSignalConnected <= 0) return null;
  const pct = (m.joinRtcSuccess / m.joinSignalConnected) * 100;
  return Number(Math.min(100, pct).toFixed(1));
}

/** Accumulator keys for the counters that must outlive a server restart. */
export const COUNTER_BYTES_IN = "livekit.bytes_in";
export const COUNTER_BYTES_OUT = "livekit.bytes_out";

export async function recordBandwidthSnapshot(db: Database, metrics: LiveKitMetrics): Promise<void> {
  // Two records of the same reading: a sample, for the per-day chart, and a
  // running total, which is the only figure that survives the server's counters
  // going back to zero on restart.
  await db.addBandwidthSample(metrics.bytesIn, metrics.bytesOut);
  await db.bumpMetricCounter(COUNTER_BYTES_IN, metrics.bytesIn);
  await db.bumpMetricCounter(COUNTER_BYTES_OUT, metrics.bytesOut);
}

/**
 * Bytes transferred over the life of this deployment, accumulated across every
 * restart of both the LiveKit server and the dashboard.
 *
 * Traffic that flowed while the dashboard was down is not in here — nothing
 * records it — so this is a floor, not an audit.
 */
export async function getLifetimeTransfer(
  db: Database
): Promise<{ upstream: number; downstream: number }> {
  const counters = await db.getMetricCounters([COUNTER_BYTES_IN, COUNTER_BYTES_OUT]);
  const byName = new Map(counters.map((c) => [c.name, c.total]));
  return {
    upstream: byName.get(COUNTER_BYTES_IN) || 0,
    downstream: byName.get(COUNTER_BYTES_OUT) || 0,
  };
}

export interface BandwidthChart {
  days: string[];
  /** Bytes sent by clients to the server, per day. */
  upstream: number[];
  /** Bytes sent by the server to clients, per day. */
  downstream: number[];
  totalUpstream: number;
  totalDownstream: number;
}

/**
 * Bytes transferred per day, as the rise of the cumulative counters within each
 * day. A server restart sends the counters back to zero, which reads as a large
 * negative step; everything the counter reports after such a step is traffic
 * since the restart, so the reading itself is added rather than discarded.
 */
export async function getBandwidthChart(db: Database, hours: number): Promise<BandwidthChart> {
  const samples = await db.getBandwidthSamples(hours);
  const days: string[] = [];
  const upstream: number[] = [];
  const downstream: number[] = [];
  const buckets = new Map<string, { up: number; down: number }>();

  const dayOf = (s: DbBandwidthSample) =>
    new Date(parseDbTime(s.created_at)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  let totalUpstream = 0;
  let totalDownstream = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    // On a reset the counter restarted from zero and climbed to its current
    // reading, so that reading is the traffic since the restart.
    const up = cur.rx_bytes >= prev.rx_bytes ? cur.rx_bytes - prev.rx_bytes : cur.rx_bytes;
    const down = cur.tx_bytes >= prev.tx_bytes ? cur.tx_bytes - prev.tx_bytes : cur.tx_bytes;
    const key = dayOf(cur);
    if (!buckets.has(key)) buckets.set(key, { up: 0, down: 0 });
    const b = buckets.get(key)!;
    b.up += up;
    b.down += down;
    totalUpstream += up;
    totalDownstream += down;
  }

  for (const [day, b] of buckets) {
    days.push(day);
    upstream.push(b.up);
    downstream.push(b.down);
  }

  return { days, upstream, downstream, totalUpstream, totalDownstream };
}
