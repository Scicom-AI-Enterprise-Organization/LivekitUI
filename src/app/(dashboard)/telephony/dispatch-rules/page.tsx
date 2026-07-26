"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { DataTable } from "@/components/livekit/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useApiList } from "@/hooks/use-api-list";
import { ListError, ListLoading, ServiceNotice } from "@/components/livekit/list-state";

interface DispatchRule {
  ruleId: string;
  name: string;
  type: string | null;
  roomName: string | null;
  roomPrefix: string | null;
  trunkIds: string[];
  inboundNumbers: string[];
  hidePhoneNumber: boolean;
}

const columns = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "target", label: "Room / Prefix" },
  { key: "trunks", label: "Trunks" },
  { key: "numbers", label: "Numbers" },
];

export default function DispatchRulesPage() {
  const { items, loading, error, notice, reload } = useApiList<DispatchRule>("/api/dispatch-rules", "rules");

  const rows = items.map((r) => ({
    id: <span className="font-mono text-xs">{r.ruleId}</span>,
    name: r.name || "—",
    type: (
      <Badge variant="outline" className="text-muted-foreground">
        {r.type === "dispatchRuleDirect" ? "direct" : r.type === "dispatchRuleIndividual" ? "individual" : "—"}
      </Badge>
    ),
    target: r.roomName || (r.roomPrefix ? `${r.roomPrefix}*` : "—"),
    trunks: r.trunkIds?.length ? r.trunkIds.join(", ") : "all",
    numbers: r.inboundNumbers?.length ? r.inboundNumbers.join(", ") : "any",
  }));

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Dispatch rules"
        breadcrumb={[{ label: "Telephony", href: "/telephony/calls" }]}
        actions={
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={reload}>
            <RefreshCw className="size-3" />
            Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {error && <ListError message={error} />}
        {notice && <ServiceNotice message={notice.message} reason={notice.reason} />}

        {loading ? (
          <ListLoading />
        ) : notice ? null : (
          <DataTable columns={columns} data={rows} emptyMessage="No dispatch rules." />
        )}
      </div>
    </div>
  );
}
