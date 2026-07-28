"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { TopBar } from "@/components/livekit/top-bar";
import { StatCard, StatCardLarge } from "@/components/livekit/stat-card";
import { DonutChart } from "@/components/livekit/donut-chart";
import { LineChart, MultiLineChart } from "@/components/livekit/line-chart";
import { DEFAULT_TIME_RANGE, type TimeRangeValue } from "@/components/livekit/time-range-picker";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// Reusable info-icon-with-tooltip
function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
          <Info className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

interface DayPoint {
  day: string;
  value: number;
}

interface Overview {
  hours: number;
  rooms: { total: number; averageSize: number; averageDurationMin: number; perDay: DayPoint[] };
  participants: {
    total: number;
    minutes: number;
    byKind: { label: string; value: number }[];
    perDay: DayPoint[];
  };
  agents: { sessions: number; minutes: number; concurrentPeak: number; activeSessions: number };
  telephony: {
    inboundSec: number;
    outboundSec: number;
    perDay: { day: string; inbound: number; outbound: number; total: number }[];
  };
  platforms: { label: string; value: number }[];
  live: { available: boolean; rooms: number; participants: number; agents: number };
  unavailable: {
    platforms: string | null;
    connectionTypes: string;
  };
}

interface Metrics {
  metricsAvailable: boolean;
  connectionSuccess: number | null;
  bandwidth: {
    totalUpstream: { value: string; unit: string };
    totalDownstream: { value: string; unit: string };
    rangeUpstream: { value: string; unit: string };
    rangeDownstream: { value: string; unit: string };
    sinceServerBootUpstream: { value: string; unit: string };
    sinceServerBootDownstream: { value: string; unit: string };
    days: string[];
    upstream: number[];
    downstream: number[];
  };
}

/** Distinct colors for a donut with more than one slice. */
const KIND_COLORS = ["var(--primary)", "var(--secondary)", "var(--chart-2)", "var(--chart-3)"];

/** Seconds rendered as the unit that keeps the number readable. */
function formatDuration(seconds: number): { value: string; unit: string } {
  if (seconds >= 3600) return { value: (seconds / 3600).toFixed(1), unit: "hr" };
  if (seconds >= 60) return { value: String(Math.round(seconds / 60)), unit: "min" };
  return { value: String(Math.round(seconds)), unit: "sec" };
}

// --- Collapsible section component ---
function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b border-border">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="flex items-center gap-2 w-full px-6 py-3 text-left rounded-none justify-start h-auto hover:bg-muted/50 transition-colors group"
        >
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-6 pb-6">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A metric the self-hosted server genuinely cannot report, with the reason.
 * Distinct from "no data" — a zero here would read as a measurement.
 */
function Unavailable({
  label,
  reason,
  infoText,
}: {
  label: string;
  reason: string;
  infoText?: string;
}) {
  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-sm text-muted-foreground">{label}</span>
          <InfoTip>{infoText || reason}</InfoTip>
        </div>
        <div className="flex h-20 items-center justify-center px-2 text-center text-xs text-muted-foreground">
          Not reported by a self-hosted server
        </div>
      </CardContent>
    </Card>
  );
}

// --- No data placeholder ---
function NoData({ label, infoText }: { label: string; infoText?: string }) {
  return (
    <Card className="py-0">
      <CardContent className="p-5">
        <div className="flex items-center gap-1.5 mb-4">
          <span className="text-sm text-muted-foreground">
            {label}
          </span>
          <InfoTip>{infoText || "Metric for the selected time range."}</InfoTip>
        </div>
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
          No data for the selected time range
        </div>
      </CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  const [range, setRange] = useState<TimeRangeValue>(DEFAULT_TIME_RANGE);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  // Seconds since the last successful poll. Held in state and ticked by an
  // interval rather than read from Date.now() during render, which would be an
  // impure read and would only ever repaint on the 10s fetch anyway.
  const [staleSec, setStaleSec] = useState<number | null>(null);

  const hours = range.hours;

  const load = useCallback(() => {
    fetch(`/api/overview?hours=${hours}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) {
          setOverview(d);
          setStaleSec(0);
        }
      })
      .catch(() => {});

    fetch(`/api/metrics?hours=${hours}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (ok && body.bandwidth) {
          setMetrics(body);
          setMetricsError(null);
        } else {
          setMetrics(null);
          setMetricsError(body.hint || body.error || "Metrics endpoint unavailable");
        }
      })
      .catch(() => setMetricsError("Metrics endpoint unreachable"));
  }, [hours]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const tick = setInterval(() => {
      setStaleSec((s) => (s === null ? s : s + 1));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const lastUpdated = staleSec === null ? "Loading…" : `Updated ${staleSec}s ago`;

  const dayLabels = overview?.participants.perDay.map((p) => p.day) ?? [];
  const participantData = overview?.participants.perDay.map((p) => p.value) ?? [];
  const roomSessionsData = overview?.rooms.perDay.map((p) => p.value) ?? [];

  const connectionSuccess = metrics?.connectionSuccess ?? null;
  const kinds = overview?.participants.byKind ?? [];
  const platforms = overview?.platforms ?? [];
  const inbound = formatDuration(overview?.telephony.inboundSec ?? 0);
  const outbound = formatDuration(overview?.telephony.outboundSec ?? 0);
  const telephonyDays = overview?.telephony.perDay ?? [];
  const hasTelephony = telephonyDays.some((d) => d.total > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <TopBar
        title="Overview"
        showRefresh
        showTimeRange
        timeRange={range}
        onTimeRangeChange={setRange}
      >
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {lastUpdated}
        </span>
      </TopBar>

      <div className="flex-1 overflow-y-auto">
        {/* Connection Stats */}
        <Section title="Connection Stats">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Connection Success */}
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">
                    Connection Success
                  </span>
                  <InfoTip>
                    Share of sessions that got past signalling to a working WebRTC connection
                    (<code>rtc_success</code> ÷ <code>signal_connected</code>), counted by the
                    LiveKit server since it started.
                  </InfoTip>
                </div>
                {connectionSuccess === null ? (
                  <div className="flex h-[104px] items-center justify-center text-xs text-muted-foreground">
                    {metricsError ? "Metrics unavailable" : "No connections yet"}
                  </div>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1 mb-3">
                      <span className="text-2xl font-semibold text-primary">
                        {connectionSuccess}
                      </span>
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                    <LineChart
                      data={participantData.map((v) => (v > 0 ? connectionSuccess : 0))}
                      height={80}
                      viewBoxWidth={300}
                      color="var(--primary)"
                      dashed
                      className="opacity-60"
                    />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Platform */}
            {platforms.length > 0 ? (
              <Card className="py-0">
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="text-sm text-muted-foreground">Platform</span>
                    <InfoTip>
                      Operating system of participants who joined through the dashboard, which
                      stamps it on the token it issues. Clients connecting with their own tokens
                      are not counted — a self-hosted server does not record platform itself.
                    </InfoTip>
                  </div>
                  <DonutChart
                    segments={platforms.map((p, i) => ({
                      label: p.label,
                      value: p.value,
                      color: KIND_COLORS[i % KIND_COLORS.length],
                    }))}
                    size={80}
                    strokeWidth={6}
                  />
                </CardContent>
              </Card>
            ) : (
              <Unavailable
                label="Platform"
                reason={overview?.unavailable.platforms ?? ""}
                infoText={overview?.unavailable.platforms ?? undefined}
              />
            )}

            {/* Participant kind — the breakdown this server can actually report */}
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">Participant Kind</span>
                  <InfoTip>
                    How participants reached the server — browser WebRTC, a SIP phone leg, or an
                    agent worker. Replaces the Cloud-only UDP/TCP/TURN breakdown, which a
                    self-hosted server does not report.
                  </InfoTip>
                </div>
                {kinds.length > 0 ? (
                  <DonutChart
                    segments={kinds.map((k, i) => ({
                      label: k.label,
                      value: k.value,
                      color: KIND_COLORS[i % KIND_COLORS.length],
                    }))}
                    size={80}
                    strokeWidth={6}
                  />
                ) : (
                  <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">
                    No sessions in this range
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* Participants */}
        <Section title="Participants">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <StatCardLarge
              label="WebRTC Participant Minutes"
              value={overview?.participants.minutes ?? 0}
              unit="min"
              infoText="Time browser participants spent connected, summed over the selected range. SIP and agent participants are counted separately."
            />
            <Card className="py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="text-sm text-muted-foreground">
                    Participant Minutes by Kind
                  </span>
                  <InfoTip>Total participant-minutes broken down by participant kind (WebRTC, SIP, agent).</InfoTip>
                </div>
                {kinds.length > 0 ? (
                  <DonutChart
                    segments={kinds.map((k, i) => ({
                      label: `${k.label} (${k.value} min)`,
                      value: k.value,
                      color: KIND_COLORS[i % KIND_COLORS.length],
                    }))}
                    size={90}
                    strokeWidth={7}
                  />
                ) : (
                  <div className="flex items-center justify-center h-[90px] text-xs text-muted-foreground">
                    No participants in this range
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="text-sm text-muted-foreground">
                    Participants
                  </span>
                  <InfoTip>Number of participants that joined per day in the selected time range.</InfoTip>
                </div>
                {participantData.length > 0 ? (
                  <LineChart
                    data={participantData}
                    labels={dayLabels}
                    height={160}
                    color="var(--primary)"
                    fillColor="var(--primary)"
                  />
                ) : (
                  <div className="flex items-center justify-center h-[160px] text-xs text-muted-foreground">
                    No data for the selected time range
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* Data Transfer */}
        <Section title="Data Transfer">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <StatCard
              label="Total Upstream"
              value={metrics?.bandwidth.totalUpstream.value ?? "0"}
              unit={metrics?.bandwidth.totalUpstream.unit ?? "B"}
              infoText={
                `Media bytes clients have sent to the server, accumulated by the dashboard across every restart. ` +
                `This server has counted ${metrics?.bandwidth.sinceServerBootUpstream.value ?? "0"} ` +
                `${metrics?.bandwidth.sinceServerBootUpstream.unit ?? "B"} since it last booted.`
              }
            />
            <StatCard
              label="Total Downstream"
              value={metrics?.bandwidth.totalDownstream.value ?? "0"}
              unit={metrics?.bandwidth.totalDownstream.unit ?? "B"}
              infoText={
                `Media bytes the server has sent to clients, accumulated by the dashboard across every restart. ` +
                `This server has counted ${metrics?.bandwidth.sinceServerBootDownstream.value ?? "0"} ` +
                `${metrics?.bandwidth.sinceServerBootDownstream.unit ?? "B"} since it last booted.`
              }
            />
            <Card className="py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="text-sm text-muted-foreground">
                    Data Transfer
                  </span>
                  <InfoTip>
                    Bandwidth per day, measured as the rise in the server&apos;s byte counters
                    between dashboard polls. Traffic that flowed while the dashboard was down is
                    not counted — nothing records it.
                  </InfoTip>
                </div>
                {metricsError ? (
                  <div className="flex h-[100px] items-center justify-center px-2 text-center text-xs text-muted-foreground">
                    {metricsError}
                  </div>
                ) : metrics && metrics.bandwidth.days.length > 0 ? (
                  <MultiLineChart
                    series={[
                      { data: metrics.bandwidth.downstream, color: "var(--secondary)", label: "Downstream" },
                      { data: metrics.bandwidth.upstream, color: "var(--primary)", label: "Upstream" },
                    ]}
                    labels={metrics.bandwidth.days}
                    height={100}
                  />
                ) : (
                  <div className="flex items-center justify-center h-[100px] text-xs text-muted-foreground">
                    Collecting bandwidth samples…
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* Rooms */}
        <Section title="Rooms">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total Room Sessions"
              value={overview?.rooms.total ?? 0}
              infoText="Room sessions started in the selected time range."
            />
            <StatCard
              label="Average Room Size"
              value={overview?.rooms.averageSize ?? 0}
              infoText="Mean number of participants per room, across rooms that had at least one."
            />
            <StatCard
              label="Average Room Duration"
              value={overview?.rooms.averageDurationMin ?? 0}
              unit="min"
              infoText="Mean time from room creation to the room closing. Rooms still open count up to now."
            />
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">
                    Room Sessions
                  </span>
                  <InfoTip>Number of room sessions started per day in the selected time range.</InfoTip>
                </div>
                {roomSessionsData.length > 0 ? (
                  <LineChart
                    data={roomSessionsData}
                    labels={dayLabels}
                    height={120}
                    color="var(--primary)"
                    fillColor="var(--primary)"
                  />
                ) : (
                  <div className="flex items-center justify-center h-[120px] text-xs text-muted-foreground">
                    No data for the selected time range
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* Agents */}
        <Section title="Agents">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Agent Session Minutes"
              value={overview?.agents.minutes ?? 0}
              unit="min"
              infoText="Time agent workers spent joined to rooms in the selected range."
            />
            <StatCard
              label="Agent Sessions"
              value={overview?.agents.sessions ?? 0}
              infoText="Number of times an agent joined a room in the selected range."
            />
            <StatCard
              label="Peak Concurrent Agents"
              value={overview?.agents.concurrentPeak ?? 0}
              infoText="Most agents connected at the same moment during the selected range."
            />
            <StatCard
              label="Agents Connected Now"
              value={overview?.agents.activeSessions ?? 0}
              infoText="Agent participants in rooms that are live right now."
            />
          </div>
        </Section>

        {/* Telephony */}
        <Section title="Telephony">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="py-0 lg:col-span-1">
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="text-sm text-muted-foreground">
                    Minutes
                  </span>
                  <InfoTip>
                    Telephony minutes per day. Inbound legs are the ones a dispatch rule
                    answered; outbound are calls placed from the dashboard.
                  </InfoTip>
                </div>
                {hasTelephony ? (
                  <MultiLineChart
                    series={[
                      { data: telephonyDays.map((d) => d.inbound), color: "var(--secondary)", label: "Inbound" },
                      { data: telephonyDays.map((d) => d.outbound), color: "var(--primary)", label: "Outbound" },
                      { data: telephonyDays.map((d) => d.total), color: "var(--chart-2)", label: "Total", dashed: true },
                    ]}
                    labels={telephonyDays.map((d) => d.day)}
                    height={100}
                  />
                ) : (
                  <div className="flex items-center justify-center h-[100px] text-xs text-muted-foreground">
                    No calls in the selected time range
                  </div>
                )}
              </CardContent>
            </Card>
            <StatCard
              label="Total Inbound"
              value={inbound.value}
              unit={inbound.unit}
              infoText="Time SIP callers spent connected on legs answered by a dispatch rule."
            />
            <StatCard
              label="Total Outbound"
              value={outbound.value}
              unit={outbound.unit}
              infoText="Time SIP legs placed from the dashboard spent connected."
            />
          </div>
        </Section>

        {/* Egress (collapsed) */}
        <Section title="Egress" defaultOpen={false}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <NoData label="Egress Minutes" infoText="Total minutes of egress (recording, streaming, composite) processed in the time range." />
            <NoData label="Egress Sessions" infoText="Number of egress jobs (recording or stream) started in the time range." />
          </div>
        </Section>

        {/* Ingress (collapsed) */}
        <Section title="Ingress" defaultOpen={false}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <NoData label="Ingress Minutes" infoText="Total minutes of ingress (RTMP/WHIP/URL-pull) streamed into rooms in the time range." />
            <NoData label="Ingress Sessions" infoText="Number of ingress sources started in the time range." />
          </div>
        </Section>
      </div>
    </div>
  );
}
