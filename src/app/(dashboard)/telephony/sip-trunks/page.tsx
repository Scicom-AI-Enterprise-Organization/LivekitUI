"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { StatCard } from "@/components/livekit/stat-card";
import { DataTable } from "@/components/livekit/data-table";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PhoneIncoming, PhoneOutgoing, RefreshCw } from "lucide-react";
import { useApiList } from "@/hooks/use-api-list";
import { ListError, ListLoading, ServiceNotice } from "@/components/livekit/list-state";

interface Trunk {
  trunkId: string;
  direction: "inbound" | "outbound";
  name: string;
  numbers: string[];
  address?: string;
  allowedAddresses?: string[];
  authUsername: string | null;
}

const inboundColumns = [
  { key: "trunkId", label: "Trunk ID" },
  { key: "trunkName", label: "Trunk Name" },
  { key: "numbers", label: "Numbers" },
  { key: "allowed", label: "Allowed Addresses" },
  { key: "auth", label: "Auth" },
];

const outboundColumns = [
  { key: "trunkId", label: "Trunk ID" },
  { key: "trunkName", label: "Trunk Name" },
  { key: "numbers", label: "Numbers" },
  { key: "address", label: "Address" },
  { key: "auth", label: "Auth" },
];

export default function SipTrunksPage() {
  const { items, loading, error, notice, reload } = useApiList<Trunk>("/api/sip-trunks", "trunks");

  const inbound = items.filter((t) => t.direction === "inbound");
  const outbound = items.filter((t) => t.direction === "outbound");

  const row = (t: Trunk) => ({
    trunkId: <span className="font-mono text-xs">{t.trunkId}</span>,
    trunkName: t.name || "—",
    numbers: t.numbers?.length ? t.numbers.join(", ") : "—",
    allowed: t.allowedAddresses?.length ? t.allowedAddresses.join(", ") : "any",
    address: t.address || "—",
    auth: t.authUsername ? t.authUsername : "none",
  });

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="SIP trunks"
        breadcrumb={[{ label: "Telephony", href: "/telephony/calls" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={reload}>
              <RefreshCw className="size-3" />
              Refresh
            </Button>
            <Button size="sm" asChild>
              <Link href="/telephony/sip-trunks/new">Create new trunk</Link>
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {error && <ListError message={error} />}
        {notice && <ServiceNotice message={notice.message} reason={notice.reason} />}

        {loading ? (
          <ListLoading />
        ) : notice ? null : (
          <>
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Total Inbound Trunks" value={inbound.length} />
              <StatCard label="Total Outbound Trunks" value={outbound.length} />
              <StatCard label="Total Numbers" value={items.reduce((n, t) => n + (t.numbers?.length || 0), 0)} info={false} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <PhoneIncoming className="size-4 text-foreground/70" />
                <h2 className="text-sm font-semibold text-foreground">Inbound Trunks</h2>
              </div>
              <DataTable columns={inboundColumns} data={inbound.map(row)} emptyMessage="No inbound trunks." />
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <PhoneOutgoing className="size-4 text-foreground/70" />
                <h2 className="text-sm font-semibold text-foreground">Outbound Trunks</h2>
              </div>
              <DataTable columns={outboundColumns} data={outbound.map(row)} emptyMessage="No outbound trunks." />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
