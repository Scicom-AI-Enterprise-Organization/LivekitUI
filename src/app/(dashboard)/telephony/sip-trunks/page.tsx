"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { StatCard } from "@/components/livekit/stat-card";
import { DataTable } from "@/components/livekit/data-table";
import { Button } from "@/components/ui/button";
import { PhoneIncoming, PhoneOutgoing } from "lucide-react";

const trunkColumns = [
  { key: "trunkId", label: "Trunk ID", sortable: true },
  { key: "trunkName", label: "Trunk Name", sortable: true },
  { key: "numbers", label: "Numbers", sortable: true },
  { key: "createdAt", label: "Created At", sortable: true },
];

export default function SipTrunksPage() {
  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="SIP trunks"
        breadcrumb={["husein", "Telephony"]}
        actions={
          <Button size="sm">
            Create new trunk
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total Inbound Trunks" value={0} />
          <StatCard label="Total Outbound Trunks" value={0} />
          <StatCard label="SIP URI" value="sip:54rc2gqv6i.sip.livekit.cloud" info={false} />
        </div>

        {/* Inbound section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <PhoneIncoming className="size-4 text-foreground/70" />
            <h2 className="text-sm font-semibold text-foreground">Inbound Trunks</h2>
          </div>
          <DataTable columns={trunkColumns} data={[]} emptyMessage="No results." />
        </div>

        {/* Outbound section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <PhoneOutgoing className="size-4 text-foreground/70" />
            <h2 className="text-sm font-semibold text-foreground">Outbound Trunks</h2>
          </div>
          <DataTable columns={trunkColumns} data={[]} emptyMessage="No results." />
        </div>
      </div>
    </div>
  );
}
