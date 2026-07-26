import { NextRequest, NextResponse } from "next/server";
import {
  scrapeLiveKitMetrics,
  recordBandwidthSnapshot,
  getBandwidthChart,
  getLifetimeTransfer,
  connectionSuccessRate,
} from "@/lib/prometheus";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

function formatBytes(bytes: number): { value: string; unit: string } {
  if (bytes >= 1e9) return { value: (bytes / 1e9).toFixed(2), unit: "GB" };
  if (bytes >= 1e6) return { value: (bytes / 1e6).toFixed(2), unit: "MB" };
  if (bytes >= 1e3) return { value: (bytes / 1e3).toFixed(2), unit: "KB" };
  return { value: String(Math.round(bytes)), unit: "B" };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hours = Math.min(
    24 * 60,
    Math.max(1, parseInt(request.nextUrl.searchParams.get("hours") || "168", 10) || 168)
  );

  const db = await ensureDb();

  let metrics;
  try {
    metrics = await scrapeLiveKitMetrics();
  } catch (err) {
    // The metrics port is optional — a server booted without a `prometheus:`
    // block simply refuses the connection. Say which it is rather than 500ing
    // the whole Overview page.
    return NextResponse.json(
      {
        error: `Could not reach the LiveKit metrics endpoint — ${String(err)}`,
        metricsAvailable: false,
        hint: "Add a `prometheus: { port: 6789 }` block to livekit.yaml and restart livekit-server, or set LIVEKIT_PROMETHEUS_URL.",
      },
      { status: 503 }
    );
  }

  // Every poll adds a reading and folds it into the running totals; the chart
  // is the rise between readings.
  try {
    await recordBandwidthSnapshot(db, metrics);
  } catch (err) {
    console.error("[metrics] could not persist bandwidth sample:", err);
  }

  const [chart, lifetime] = await Promise.all([
    getBandwidthChart(db, hours),
    getLifetimeTransfer(db),
  ]);

  return NextResponse.json({
    metricsAvailable: true,
    live: metrics,
    connectionSuccess: connectionSuccessRate(metrics),
    bandwidth: {
      // Accumulated by the dashboard, so a `livekit-server` restart does not
      // wipe it — the server's own counters only run from its last boot.
      totalUpstream: formatBytes(lifetime.upstream),
      totalDownstream: formatBytes(lifetime.downstream),
      totalUpstreamBytes: lifetime.upstream,
      totalDownstreamBytes: lifetime.downstream,
      rangeUpstream: formatBytes(chart.totalUpstream),
      rangeDownstream: formatBytes(chart.totalDownstream),
      // What this server has counted since it last booted, for comparison.
      sinceServerBootUpstream: formatBytes(metrics.bytesIn),
      sinceServerBootDownstream: formatBytes(metrics.bytesOut),
      days: chart.days,
      upstream: chart.upstream,
      downstream: chart.downstream,
    },
  });
}
