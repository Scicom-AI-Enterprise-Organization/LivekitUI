"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { DataTable } from "@/components/livekit/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useApiList } from "@/hooks/use-api-list";
import { ListError, ListLoading, ServiceNotice } from "@/components/livekit/list-state";

interface Egress {
  egressId: string;
  roomName: string;
  status: string;
  type: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  destinations: { kind: string; location: string }[];
}

const columns = [
  { key: "id", label: "ID" },
  { key: "startedAt", label: "Started At" },
  { key: "duration", label: "Duration" },
  { key: "status", label: "Status" },
  { key: "type", label: "Type" },
  { key: "source", label: "Source" },
  { key: "destination", label: "Destination" },
];

function statusVariant(status: string) {
  if (status === "active" || status === "starting") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/30";
  if (status === "failed" || status === "aborted") return "bg-red-500/10 text-red-500 border-red-500/30";
  return "text-muted-foreground";
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m ${seconds % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function EgressesPage() {
  const { items, loading, error, notice, reload } = useApiList<Egress>("/api/egresses", "egresses");

  const rows = items.map((e) => ({
    id: <span className="font-mono text-xs">{e.egressId}</span>,
    startedAt: e.startedAt ? new Date(e.startedAt).toLocaleString() : "—",
    duration: formatDuration(e.durationSeconds),
    status: <Badge variant="outline" className={statusVariant(e.status)}>{e.status}</Badge>,
    type: e.type?.replace(/Request$|^([a-z])/g, (m, p1) => (p1 ? p1.toUpperCase() : "")) || "—",
    source: e.roomName || "—",
    destination: e.destinations.length
      ? <span className="font-mono text-xs">{e.destinations.map((d) => d.location).join(", ")}</span>
      : "—",
  }));

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Egresses" showTimeRange>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={reload}>
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </TopBar>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Egresses</h2>
          {!loading && !notice && (
            <span className="text-xs text-muted-foreground">{items.length} total</span>
          )}
        </div>

        {error && <ListError message={error} />}
        {notice && <ServiceNotice message={notice.message} reason={notice.reason} />}

        {loading ? (
          <ListLoading />
        ) : notice ? null : (
          <DataTable columns={columns} data={rows} emptyMessage="No egresses." />
        )}
      </div>
    </div>
  );
}
