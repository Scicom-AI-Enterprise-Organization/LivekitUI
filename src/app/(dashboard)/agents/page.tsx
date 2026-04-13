"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { StatCard } from "@/components/livekit/stat-card";
import { MultiLineChart } from "@/components/livekit/line-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  ChevronDown,
  Search,
  SlidersHorizontal,
  MoreHorizontal,
  Rocket,
} from "lucide-react";

const chartLabels = ["Apr 6", "Apr 7", "Apr 8", "Apr 9", "Apr 10", "Apr 11", "Apr 12"];

const chartSeries = [
  {
    data: [0, 0, 1, 0, 0, 0, 0],
    color: "var(--primary)",
    label: "Total number of active sessions",
  },
  {
    data: [0, 0, 1, 0, 0, 0, 0],
    color: "var(--secondary)",
    label: "Agents dispatch'd service",
    dashed: true,
  },
];

export default function AgentsPage() {
  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Agents"
        breadcrumb={["husein"]}
        showRefresh
        showTimeRange
        actions={
          <Button variant="default" size="sm" asChild>
            <Link href="/agents/builder">
              <Rocket className="size-3" />
              <span>Deploy new agent</span>
            </Link>
          </Button>
        }
      />

      {/* Stats Row */}
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Agents Deployed" value={1} />
          <StatCard label="Concurrent Agent Sessions" value={0} />
          <StatCard label="Agent Session Minutes This Billing Period" value="0 (000)" unit="min" />
        </div>

        {/* Overview Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Overview</h2>
            <Button variant="outline" size="sm">
              <span>Past 7 days</span>
              <ChevronDown className="size-3" />
            </Button>
          </div>

          <Card className="py-0">
            <CardContent className="p-5">
              <h3 className="text-sm text-muted-foreground mb-4">
                Agent Sessions Served
              </h3>
              <MultiLineChart
                series={chartSeries}
                labels={chartLabels}
                height={180}
              />
            </CardContent>
          </Card>
        </div>

        {/* Your Agents Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Your agents</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon-xs">
                <Search className="size-3.5" />
              </Button>
              <Button variant="outline" size="icon-xs">
                <SlidersHorizontal className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Agent Card */}
          <Card className="py-0">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      CA_JTNVABxhUliveE
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    ak_5iND5qNxce
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Concurrent sessions */}
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      Concurrent sessions
                    </span>
                    <span className="text-sm font-semibold text-foreground">0</span>
                  </div>

                  {/* Dispatch config */}
                  <Badge variant="outline" className="text-secondary">
                    pipeline
                  </Badge>

                  {/* Status badge */}
                  <Badge variant="default" className="bg-emerald-500/10 text-emerald-400 gap-1.5">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    Deployed
                  </Badge>

                  {/* More button */}
                  <Button variant="ghost" size="icon-xs">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
