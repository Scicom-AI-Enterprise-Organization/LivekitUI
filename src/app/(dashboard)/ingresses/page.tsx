"use client";

import { useState } from "react";
import { TopBar } from "@/components/livekit/top-bar";
import { DataTable } from "@/components/livekit/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Filter, Search, LayoutGrid, List } from "lucide-react";

const ingressColumns = [
  { key: "id", label: "ID", sortable: true },
  { key: "startedAt", label: "Started At", sortable: true },
  { key: "lastActiveAt", label: "Last Active At", sortable: true },
  { key: "duration", label: "Duration" },
  { key: "status", label: "Status" },
  { key: "sessions", label: "Sessions" },
];

export default function IngressesPage() {
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Ingresses" breadcrumb={["husein"]} showRefresh showTimeRange>
        <span className="text-xs text-muted-foreground">Last updated 4 min ago</span>
      </TopBar>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Section header with filter bar */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Ingresses</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Filter className="size-3" />
              <span>Filters</span>
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8">
              <Search className="size-3.5" />
            </Button>
            <div className="flex items-center rounded-md border bg-card overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "flex items-center justify-center p-1.5 transition-colors",
                  viewMode === "grid"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                <LayoutGrid className="size-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "flex items-center justify-center p-1.5 transition-colors",
                  viewMode === "list"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                <List className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Data table */}
        <DataTable
          columns={ingressColumns}
          data={[]}
          emptyMessage="No results."
        />
      </div>
    </div>
  );
}
