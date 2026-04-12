"use client";

import { ChevronDown, ChevronRight, Info } from "lucide-react";
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
import { cn } from "@/lib/utils";

// --- Sample data ---
const dayLabels = ["Apr 5", "Apr 6", "Apr 7", "Apr 8", "Apr 9", "Apr 10", "Apr 11"];

const connectionSparkline = [100, 100, 100, 100, 100, 100, 100];

const participantData = [0, 2, 0, 5, 8, 12, 4];

const upstreamData = [0, 0.8, 0.2, 1.5, 3.2, 3.8, 1.2];
const downstreamData = [0, 0.05, 0.02, 0.15, 0.35, 0.38, 0.16];

const roomSessionsData = [0, 1, 0, 3, 4, 5, 3];

const telephonyInbound = [0, 0, 0, 0, 0, 0, 0];
const telephonyOutbound = [0, 0, 0, 0, 0, 0, 0];
const telephonyTotal = [0, 0, 0, 0, 0, 0, 0];

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
function NoData({ label }: { label: string }) {
  return (
    <Card className="py-0">
      <CardContent className="p-5">
        <div className="flex items-center gap-1.5 mb-4">
          <span className="text-sm text-muted-foreground">
            {label}
          </span>
          <Info className="size-3 text-muted-foreground" />
        </div>
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
          No data for the selected time range
        </div>
      </CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <TopBar title="Overview" showRefresh showTimeRange>
        <span className="text-sm text-muted-foreground">
          Last updated 3 min ago
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
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-2xl font-semibold text-primary">100</span>
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <LineChart
                  data={connectionSparkline}
                  height={50}
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
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <DonutChart
                  segments={[{ label: "MacOS", value: 100, color: "var(--primary)" }]}
                  size={80}
                  strokeWidth={6}
                />
              </CardContent>
            </Card>

            {/* Connection Type */}
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">
                    Connection Type
                  </span>
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <DonutChart
                  segments={[{ label: "UDP", value: 100, color: "var(--primary)" }]}
                  size={80}
                  strokeWidth={6}
                />
              </CardContent>
            </Card>

            {/* Top Countries */}
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">
                    Top Countries
                  </span>
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left font-medium pb-1.5">Country</th>
                      <th className="text-right font-medium pb-1.5">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-foreground/70">
                      <td className="py-1.5">Malaysia</td>
                      <td className="text-right">16</td>
                    </tr>
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
              value="31"
              unit="min"
            />
            <Card className="py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="text-sm text-muted-foreground">
                    Participant Minutes by Kind
                  </span>
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <DonutChart
                  segments={[
                    { label: "WebRTC participant minutes", value: 31, color: "var(--primary)" },
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
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <LineChart
                  data={participantData}
                  labels={dayLabels}
                  height={100}
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
            <StatCard label="Total Upstream" value="10.69" unit="MB" />
            <StatCard label="Total Downstream" value="1.11" unit="MB" />
            <Card className="py-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="text-sm text-muted-foreground">
                    Data Transfer
                  </span>
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <MultiLineChart
                  series={[
                    { data: downstreamData, color: "var(--secondary)", label: "Downstream", dashed: false },
                    { data: upstreamData, color: "var(--primary)", label: "Upstream", dashed: false },
                  ]}
                  labels={dayLabels}
                  height={100}
                />
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* Rooms */}
        <Section title="Rooms">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Room Sessions" value={16} />
            <StatCard label="Average Room Size" value={2} />
            <StatCard label="Average Room Duration" value="1" unit="min" />
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm text-muted-foreground">
                    Room Sessions
                  </span>
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <LineChart
                  data={roomSessionsData}
                  labels={dayLabels}
                  height={80}
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
            <NoData label="Agent Session Minutes" />
            <NoData label="Concurrent Agent Sessions" />
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
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <MultiLineChart
                  series={[
                    { data: telephonyInbound, color: "var(--secondary)", label: "Inbound" },
                    { data: telephonyOutbound, color: "var(--primary)", label: "Outbound" },
                    { data: telephonyTotal, color: "var(--chart-2)", label: "Total", dashed: true },
                  ]}
                  labels={dayLabels}
                  height={100}
                />
              </CardContent>
            </Card>
            <StatCard label="Total Inbound" value="0" unit="sec" />
            <StatCard label="Total Outbound" value="0" unit="sec" />
          </div>
        </Section>

        {/* Egress (collapsed) */}
        <Section title="Egress" defaultOpen={false}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <NoData label="Egress Minutes" />
            <NoData label="Egress Sessions" />
          </div>
        </Section>

        {/* Ingress (collapsed) */}
        <Section title="Ingress" defaultOpen={false}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <NoData label="Ingress Minutes" />
            <NoData label="Ingress Sessions" />
          </div>
        </Section>
      </div>
    </div>
  );
}
