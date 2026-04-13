"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { StatCard } from "@/components/livekit/stat-card";
import { DataTable } from "@/components/livekit/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info, Filter, Search } from "lucide-react";

export default function TelephonyCallsPage() {
  return (
    <div className="flex flex-col h-full">
      <TopBar title="Telephony" breadcrumb={["husein"]} showRefresh showTimeRange />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Top 3 stat cards */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total Calls" value="-" />
          <StatCard label="Total Call Duration" value="0" unit="sec" />
          <StatCard label="Average Call Duration" value="0" unit="sec" />
        </div>

        {/* Active calls + Issues */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="py-4">
            <CardContent className="px-5 py-0">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm text-muted-foreground">Active Calls</span>
                <Info className="size-3 text-muted-foreground" />
              </div>
              <span className="text-2xl font-semibold text-primary">0</span>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="px-5 py-0">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm text-muted-foreground">Calls with Issues</span>
                <Info className="size-3 text-muted-foreground" />
              </div>
              <span className="text-2xl font-semibold text-primary">0</span>
            </CardContent>
          </Card>
        </div>

        {/* Calls table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Calls</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Filter className="size-3" />
                Filters
              </Button>
              <Button variant="outline" size="icon-sm">
                <Search className="size-3.5" />
              </Button>
            </div>
          </div>

          <DataTable
            columns={[
              { key: "id", label: "ID" },
              { key: "from", label: "From" },
              { key: "to", label: "To" },
              { key: "direction", label: "Direction" },
              { key: "startedBy", label: "Started By" },
              { key: "endedBy", label: "Ended By" },
              { key: "duration", label: "Duration" },
              { key: "session", label: "Session" },
              { key: "status", label: "Status" },
            ]}
            data={[]}
            emptyMessage="No results."
          />
        </div>
      </div>
    </div>
  );
}
