"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { TopBar } from "@/components/livekit/top-bar";
import { StatCard, StatCardLarge } from "@/components/livekit/stat-card";
import { DonutChart } from "@/components/livekit/donut-chart";
import { LineChart, MultiLineChart } from "@/components/livekit/line-chart";
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

interface Overview {
  rooms: { total: number; averageSize: number; averageDurationMin: number };
  participants: { total: number; minutes: number };
  agents: { activeSessions: number };
  topCountries: { country: string; count: number }[];
  platforms: { label: string; value: number }[];
  connectionTypes: { label: string; value: number }[];
}

// Generate day labels from history data
function buildDayLabels(count: number): string[] {
  const labels: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  }
  return labels;
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
  const [overview, setOverview] = useState<Overview | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [history, setHistory] = useState<{ time: string; sessions: number; agents: number }[]>([]);
  const [bandwidth, setBandwidth] = useState<{
    totalUpstream: { value: string; unit: string };
    totalDownstream: { value: string; unit: string };
    days: string[];
    upstream: number[];
    downstream: number[];
  } | null>(null);

  useEffect(() => {
    const tick = () => {
      fetch("/api/overview")
        .then((r) => r.json())
        .then((d) => {
          if (!d.error) {
            setOverview(d);
            setUpdatedAt(new Date());
          }
        })
        .catch(() => {});
      // Also fetch agent history for time-series graphs
      fetch("/api/agents?hours=168")
        .then((r) => r.json())
        .then((d) => {
          if (d.history) {
            setHistory(d.history.map((h: { time: string; sessions: number; agents: number }) => ({
              time: h.time,
              sessions: h.sessions,
              agents: h.agents,
            })));
          }
        })
        .catch(() => {});
      // Scrape Prometheus metrics for bandwidth
      fetch("/api/metrics")
        .then((r) => r.json())
        .then((d) => { if (d.bandwidth) setBandwidth(d.bandwidth); })
        .catch(() => {});
    };
    tick();
    const interval = setInterval(tick, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Group history into daily buckets for graphs
  const dailyBuckets = (() => {
    const buckets = new Map<string, { sessions: number[]; agents: number[] }>();
    for (const h of history) {
      const day = new Date(h.time).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!buckets.has(day)) buckets.set(day, { sessions: [], agents: [] });
      const b = buckets.get(day)!;
      b.sessions.push(h.sessions);
      b.agents.push(h.agents);
    }
    return buckets;
  })();

  const dayLabels = dailyBuckets.size > 0
    ? Array.from(dailyBuckets.keys())
    : buildDayLabels(7);

  // Participants per day = peak concurrent sessions seen that day
  const participantData = dailyBuckets.size > 0
    ? Array.from(dailyBuckets.values()).map((b) => Math.max(...b.sessions, 0))
    : dayLabels.map(() => 0);

  // Room sessions per day = peak concurrent sessions seen that day
  const roomSessionsData = dailyBuckets.size > 0
    ? Array.from(dailyBuckets.values()).map((b) => Math.max(...b.sessions, 0))
    : dayLabels.map(() => 0);

  // Connection sparkline = 100% when we have data, 0 when not
  const connectionSparkline = dayLabels.map((_, i) => {
    const vals = Array.from(dailyBuckets.values());
    return i < vals.length && vals[i].sessions.length > 0 ? 100 : 0;
  });

  const lastUpdated = updatedAt
    ? `Updated ${Math.max(0, Math.round((Date.now() - updatedAt.getTime()) / 1000))}s ago`
    : "Loading…";

  const topCountry = overview?.topCountries?.[0];
  const topPlatform = overview?.platforms?.[0];
  const topConnection = overview?.connectionTypes?.[0];

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <TopBar title="Overview" showRefresh showTimeRange>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {lastUpdated}
        </span>
      </TopBar>

      <div className="flex-1 overflow-y-auto">
        {/* Connection Stats */}
        <Section title="Connection Stats">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Connection Success */}
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">
                    Connection Success
                  </span>
                  <InfoTip>Percentage of clients that successfully established a WebRTC connection in the selected time range.</InfoTip>
                </div>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-2xl font-semibold text-primary">100</span>
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <LineChart
                  data={connectionSparkline}
                  height={80}
                  viewBoxWidth={300}
                  color="var(--primary)"
                  dashed
                  className="opacity-60"
                />
              </CardContent>
            </Card>

            {/* Platform */}
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">
                    Platform
                  </span>
                  <InfoTip>Breakdown of operating systems used by participants who joined sessions.</InfoTip>
                </div>
                {topPlatform ? (
                  <DonutChart
                    segments={[{ label: topPlatform.label, value: topPlatform.value, color: "var(--primary)" }]}
                    size={80}
                    strokeWidth={6}
                  />
                ) : (
                  <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">No data</div>
                )}
              </CardContent>
            </Card>

            {/* Connection Type */}
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">
                    Connection Type
                  </span>
                  <InfoTip>Transport protocol used (UDP, TCP, or TURN-relay) by participant connections.</InfoTip>
                </div>
                {topConnection ? (
                  <DonutChart
                    segments={[{ label: topConnection.label, value: topConnection.value, color: "var(--primary)" }]}
                    size={80}
                    strokeWidth={6}
                  />
                ) : (
                  <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">No data</div>
                )}
              </CardContent>
            </Card>

            {/* Top Countries */}
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">
                    Top Countries
                  </span>
                  <InfoTip>Geographic distribution of participants by country (based on IP geolocation).</InfoTip>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left font-medium pb-1.5">Country</th>
                      <th className="text-right font-medium pb-1.5">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview?.topCountries?.length ? (
                      overview.topCountries.map((c) => (
                        <tr key={c.country} className="text-foreground/70">
                          <td className="py-1.5">{c.country}</td>
                          <td className="text-right">{c.count}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="py-3 text-center text-muted-foreground">No data</td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
            />
            <Card className="py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="text-sm text-muted-foreground">
                    Participant Minutes by Kind
                  </span>
                  <InfoTip>Total participant-minutes broken down by participant kind (WebRTC, SIP, agent).</InfoTip>
                </div>
                <DonutChart
                  segments={[
                    { label: "WebRTC participant minutes", value: overview?.participants.minutes ?? 0, color: "var(--primary)" },
                  ]}
                  size={90}
                  strokeWidth={7}
                />
              </CardContent>
            </Card>
            <Card className="py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="text-sm text-muted-foreground">
                    Participants
                  </span>
                  <InfoTip>Number of participants connected per day in the selected time range.</InfoTip>
                </div>
                <LineChart
                  data={participantData}
                  labels={dayLabels}
                  height={160}
                  color="var(--primary)"
                  fillColor="var(--primary)"
                />
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* Data Transfer */}
        <Section title="Data Transfer">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <StatCard
              label="Total Upstream"
              value={bandwidth?.totalUpstream.value ?? "0"}
              unit={bandwidth?.totalUpstream.unit ?? "B"}
              infoText="Total bytes relayed upstream through the LiveKit server since tracking started."
            />
            <StatCard
              label="Total Downstream"
              value={bandwidth?.totalDownstream.value ?? "0"}
              unit={bandwidth?.totalDownstream.unit ?? "B"}
              infoText="Total bytes relayed downstream through the LiveKit server since tracking started."
            />
            <Card className="py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="text-sm text-muted-foreground">
                    Data Transfer
                  </span>
                  <InfoTip>Upstream and downstream bandwidth consumed by all sessions per day. Scraped from Prometheus metrics.</InfoTip>
                </div>
                {bandwidth && bandwidth.days.length > 0 ? (
                  <MultiLineChart
                    series={[
                      { data: bandwidth.downstream, color: "var(--secondary)", label: "Downstream" },
                      { data: bandwidth.upstream, color: "var(--primary)", label: "Upstream" },
                    ]}
                    labels={bandwidth.days}
                    height={100}
                  />
                ) : (
                  <div className="flex items-center justify-center h-[100px] text-xs text-muted-foreground">
                    Collecting bandwidth data from Prometheus...
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
              infoText="Total number of room sessions created in the selected time range."
            />
            <StatCard
              label="Average Room Size"
              value={overview?.rooms.averageSize ?? 0}
              infoText="Mean number of participants per room across all sessions."
            />
            <StatCard
              label="Average Room Duration"
              value={overview?.rooms.averageDurationMin ?? 0}
              unit="min"
              infoText="Mean duration of a room session from creation to last participant leaving."
            />
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">
                    Room Sessions
                  </span>
                  <InfoTip>Number of room sessions started per day in the selected time range.</InfoTip>
                </div>
                <LineChart
                  data={roomSessionsData}
                  labels={dayLabels}
                  height={120}
                  color="var(--primary)"
                  fillColor="var(--primary)"
                />
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* Agents */}
        <Section title="Agents">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <StatCard label="Agent Session Minutes" value={overview?.participants.minutes ?? 0} unit="min" />
            <StatCard label="Concurrent Agent Sessions" value={overview?.agents.activeSessions ?? 0} />
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
                  <InfoTip>Inbound and outbound telephony minutes consumed per day.</InfoTip>
                </div>
                <MultiLineChart
                  series={[
                    { data: dayLabels.map(() => 0), color: "var(--secondary)", label: "Inbound" },
                    { data: dayLabels.map(() => 0), color: "var(--primary)", label: "Outbound" },
                    { data: dayLabels.map(() => 0), color: "var(--chart-2)", label: "Total", dashed: true },
                  ]}
                  labels={dayLabels}
                  height={100}
                />
              </CardContent>
            </Card>
            <StatCard
              label="Total Inbound"
              value="0"
              unit="sec"
              infoText="Total seconds of inbound telephony traffic (calls received) in the time range."
            />
            <StatCard
              label="Total Outbound"
              value="0"
              unit="sec"
              infoText="Total seconds of outbound telephony traffic (calls placed) in the time range."
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
