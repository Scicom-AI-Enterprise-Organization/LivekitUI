"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { DataTable } from "@/components/livekit/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useApiList } from "@/hooks/use-api-list";
import { ListError, ListLoading, ServiceNotice } from "@/components/livekit/list-state";

interface Ingress {
  ingressId: string;
  name: string;
  streamKey: string;
  url: string;
  inputType: number;
  roomName: string;
  participantIdentity: string;
  status: string;
  startedAt: string | null;
}

const columns = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
  { key: "type", label: "Input" },
  { key: "room", label: "Room" },
  { key: "participant", label: "Participant" },
  { key: "startedAt", label: "Started At" },
];

// IngressInput enum: 0 RTMP, 1 WHIP, 2 URL
const INPUT_LABELS: Record<number, string> = { 0: "RTMP", 1: "WHIP", 2: "URL" };

function statusVariant(status: string) {
  if (status === "publishing") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/30";
  if (status === "error") return "bg-red-500/10 text-red-500 border-red-500/30";
  return "text-muted-foreground";
}

export default function IngressesPage() {
  const { items, loading, error, notice, reload } = useApiList<Ingress>("/api/ingresses", "ingresses");

  const rows = items.map((i) => ({
    id: <span className="font-mono text-xs">{i.ingressId}</span>,
    name: i.name || "—",
    status: <Badge variant="outline" className={statusVariant(i.status)}>{i.status}</Badge>,
    type: INPUT_LABELS[i.inputType] ?? String(i.inputType),
    room: i.roomName || "—",
    participant: i.participantIdentity || "—",
    startedAt: i.startedAt ? new Date(i.startedAt).toLocaleString() : "—",
  }));

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Ingresses" showTimeRange>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={reload}>
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </TopBar>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Ingresses</h2>
          {!loading && !notice && (
            <span className="text-xs text-muted-foreground">{items.length} total</span>
          )}
        </div>

        {error && <ListError message={error} />}
        {notice && <ServiceNotice message={notice.message} reason={notice.reason} />}

        {loading ? (
          <ListLoading />
        ) : notice ? null : (
          <DataTable columns={columns} data={rows} emptyMessage="No ingresses." />
        )}
      </div>
    </div>
  );
}
