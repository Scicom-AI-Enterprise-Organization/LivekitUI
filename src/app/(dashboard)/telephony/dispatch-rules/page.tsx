"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { DataTable } from "@/components/livekit/data-table";

const columns = [
  { key: "id", label: "ID", sortable: true },
  { key: "startedAt", label: "Started At", sortable: true },
  { key: "duration", label: "Duration", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "type", label: "Type", sortable: true },
];

export default function DispatchRulesPage() {
  return (
    <div className="flex flex-col h-full">
      <TopBar title="Dispatch rules" breadcrumb={["husein", "Telephony"]} />

      <div className="flex-1 overflow-auto p-6">
        <DataTable columns={columns} data={[]} />
      </div>
    </div>
  );
}
