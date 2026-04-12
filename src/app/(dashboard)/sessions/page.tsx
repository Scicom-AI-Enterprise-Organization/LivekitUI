"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { DataTable } from "@/components/livekit/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, SlidersHorizontal, LayoutGrid, LayoutList } from "lucide-react";
import { useState } from "react";

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className="bg-green-500/20 text-green-500 border-transparent hover:bg-green-500/20">
      {status}
    </Badge>
  );
}

const columns = [
  { key: "roomName", label: "Room Name", sortable: true },
  { key: "startedAt", label: "Started At", sortable: true },
  { key: "duration", label: "Duration" },
  { key: "participants", label: "Participants" },
  { key: "status", label: "Status" },
];

const sessionData = [
  {
    roomName: "test-room-abc123",
    startedAt: "Apr 8, 2026 14:32",
    duration: "2m 15s",
    participants: "2",
    status: <StatusBadge status="completed" />,
  },
  {
    roomName: "voice-agent-session",
    startedAt: "Apr 8, 2026 14:30",
    duration: "5m 42s",
    participants: "2",
    status: <StatusBadge status="completed" />,
  },
  {
    roomName: "demo-room-xyz",
    startedAt: "Apr 8, 2026 12:15",
    duration: "1m 03s",
    participants: "3",
    status: <StatusBadge status="completed" />,
  },
  {
    roomName: "agent-test-001",
    startedAt: "Apr 7, 2026 16:45",
    duration: "8m 22s",
    participants: "2",
    status: <StatusBadge status="completed" />,
  },
  {
    roomName: "pipeline-debug",
    startedAt: "Apr 5, 2026 09:10",
    duration: "0m 45s",
    participants: "1",
    status: <StatusBadge status="completed" />,
  },
];

export default function SessionsPage() {
  const [layout, setLayout] = useState<"table" | "grid">("table");

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Sessions"
        breadcrumb={["husein"]}
        showRefresh
        showTimeRange
      />

      <div className="flex-1 overflow-auto bg-background p-6">
        {/* Filter bar */}
        <div className="mb-4 flex items-center gap-2">
          <Button variant="outline" size="sm">
            <SlidersHorizontal className="size-3.5" />
            <span>Filters</span>
          </Button>

          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search sessions..."
              className="pl-8 h-8 text-sm"
            />
          </div>

          <div className="ml-auto flex items-center rounded-md border bg-card">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayout("table")}
              className={layout === "table" ? "text-foreground bg-muted" : "text-muted-foreground"}
            >
              <LayoutList className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayout("grid")}
              className={layout === "grid" ? "text-foreground bg-muted" : "text-muted-foreground"}
            >
              <LayoutGrid className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Data table */}
        <DataTable columns={columns} data={sessionData} emptyMessage="No sessions found." />
      </div>
    </div>
  );
}
