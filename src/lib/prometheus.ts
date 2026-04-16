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
  packetsOut: number;
  packetsDropped: number;
  signalBytesRx: number;
  signalBytesTx: number;
  participantJoinTotal: number;
  roomTotal: number;
  participantTotal: number;
  trackPublishedAudio: number;
  trackPublishedVideo: number;
}

export async function scrapeLiveKitMetrics(): Promise<LiveKitMetrics> {
  const res = await fetch(PROM_URL, { cache: "no-store" });
  const text = await res.text();
  const samples = parsePrometheus(text);

  let packetsOut = 0;
  let packetsDropped = 0;
  let signalBytesRx = 0;
  let signalBytesTx = 0;
  let participantJoinTotal = 0;
  let roomTotal = 0;
  let participantTotal = 0;
  let trackPublishedAudio = 0;
  let trackPublishedVideo = 0;

  for (const s of samples) {
    switch (s.name) {
      case "livekit_node_packet_total":
        if (s.labels.type === "out") packetsOut = s.value;
        if (s.labels.type === "dropped") packetsDropped = s.value;
        break;
      case "livekit_psrpc_bytes_total":
        // Upstream = bytes the server received from clients
        // Downstream = bytes the server sent to clients
        if (s.labels.method === "RelaySignal" && s.labels.role === "server" && s.labels.direction === "rx")
          signalBytesRx += s.value;
        if (s.labels.method === "RelaySignal" && s.labels.role === "server" && s.labels.direction === "tx")
          signalBytesTx += s.value;
        break;
      case "livekit_participant_join_total":
        participantJoinTotal += s.value;
        break;
      case "livekit_room_total":
        roomTotal = s.value;
        break;
      case "livekit_participant_total":
        participantTotal = s.value;
        break;
      case "livekit_track_published_total":
        if (s.labels.kind === "AUDIO") trackPublishedAudio = s.value;
        if (s.labels.kind === "VIDEO") trackPublishedVideo = s.value;
        break;
    }
  }

  return {
    packetsOut,
    packetsDropped,
    signalBytesRx,
    signalBytesTx,
    participantJoinTotal,
    roomTotal,
    participantTotal,
    trackPublishedAudio,
    trackPublishedVideo,
  };
}

// Bandwidth time-series: store cumulative values at each scrape.
// On the chart we show the cumulative-at-that-point grouped by day.
interface BandwidthSnapshot {
  time: number;
  cumulativeRx: number;
  cumulativeTx: number;
}

const bandwidthHistory: BandwidthSnapshot[] = [];

export function recordBandwidthSnapshot(metrics: LiveKitMetrics) {
  bandwidthHistory.push({
    time: Date.now(),
    cumulativeRx: metrics.signalBytesRx,
    cumulativeTx: metrics.signalBytesTx,
  });

  // Keep max 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  while (bandwidthHistory.length > 0 && bandwidthHistory[0].time < cutoff) {
    bandwidthHistory.shift();
  }
}

export function getBandwidthChart(): {
  days: string[];
  upstream: number[];
  downstream: number[];
  totalRx: number;
  totalTx: number;
} {
  if (bandwidthHistory.length === 0) {
    return { days: [], upstream: [], downstream: [], totalRx: 0, totalTx: 0 };
  }

  // Group snapshots by day, compute bytes transferred that day as (last - first) within the day
  const buckets = new Map<string, { firstRx: number; lastRx: number; firstTx: number; lastTx: number }>();

  for (const s of bandwidthHistory) {
    const day = new Date(s.time).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (!buckets.has(day)) {
      buckets.set(day, { firstRx: s.cumulativeRx, lastRx: s.cumulativeRx, firstTx: s.cumulativeTx, lastTx: s.cumulativeTx });
    } else {
      const b = buckets.get(day)!;
      b.lastRx = s.cumulativeRx;
      b.lastTx = s.cumulativeTx;
    }
  }

  const days: string[] = [];
  const upstream: number[] = [];
  const downstream: number[] = [];

  for (const [day, b] of buckets) {
    days.push(day);
    downstream.push(Math.max(0, b.lastRx - b.firstRx));
    upstream.push(Math.max(0, b.lastTx - b.firstTx));
  }

  // Total = difference between very first and very last snapshot
  const first = bandwidthHistory[0];
  const last = bandwidthHistory[bandwidthHistory.length - 1];
  const totalRx = Math.max(0, last.cumulativeRx - first.cumulativeRx);
  const totalTx = Math.max(0, last.cumulativeTx - first.cumulativeTx);

  return { days, upstream, downstream, totalRx, totalTx };
}
