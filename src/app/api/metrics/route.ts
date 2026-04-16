import { NextResponse } from "next/server";
import {
  scrapeLiveKitMetrics,
  recordBandwidthSnapshot,
  getBandwidthChart,
} from "@/lib/prometheus";

function formatBytes(bytes: number): { value: string; unit: string } {
  if (bytes >= 1e9) return { value: (bytes / 1e9).toFixed(2), unit: "GB" };
  if (bytes >= 1e6) return { value: (bytes / 1e6).toFixed(2), unit: "MB" };
  if (bytes >= 1e3) return { value: (bytes / 1e3).toFixed(2), unit: "KB" };
  return { value: String(Math.round(bytes)), unit: "B" };
}

export async function GET() {
  try {
    const metrics = await scrapeLiveKitMetrics();
    recordBandwidthSnapshot(metrics);

    const chart = getBandwidthChart();

    return NextResponse.json({
      live: metrics,
      bandwidth: {
        totalUpstream: formatBytes(chart.totalTx),
        totalDownstream: formatBytes(chart.totalRx),
        days: chart.days,
        upstream: chart.upstream,
        downstream: chart.downstream,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
