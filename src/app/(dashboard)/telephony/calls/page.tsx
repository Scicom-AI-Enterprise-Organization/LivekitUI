"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { Card, CardContent } from "@/components/ui/card";

function ShimmerCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-sm text-muted-foreground">
            {label}
          </span>
        </div>
        <div className="h-8 w-24 rounded bg-muted animate-pulse" />
      </CardContent>
    </Card>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-sm text-muted-foreground">
            {label}
          </span>
        </div>
        <div className="h-20" />
      </CardContent>
    </Card>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5">
      <div className="h-4 w-32 rounded bg-muted animate-pulse" />
      <div className="h-4 w-24 rounded bg-muted animate-pulse" />
      <div className="h-4 w-20 rounded bg-muted animate-pulse" />
      <div className="h-4 w-28 rounded bg-muted animate-pulse" />
      <div className="h-4 w-16 rounded bg-muted animate-pulse" />
      <div className="h-4 w-20 rounded bg-muted animate-pulse" />
    </div>
  );
}

const callColumns = [
  { key: "id", label: "Call ID", sortable: true },
  { key: "from", label: "From", sortable: true },
  { key: "to", label: "To", sortable: true },
  { key: "startedAt", label: "Started At", sortable: true },
  { key: "duration", label: "Duration", sortable: true },
  { key: "status", label: "Status", sortable: true },
];

export default function TelephonyCallsPage() {
  return (
    <div className="flex flex-col h-full">
      <TopBar title="Telephony" breadcrumb={["husein"]} showRefresh showTimeRange />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Top 3 stat cards with shimmer */}
        <div className="grid grid-cols-3 gap-4">
          <ShimmerCard label="Total Calls" />
          <ShimmerCard label="Total Call Duration" />
          <ShimmerCard label="Average Call Duration" />
        </div>

        {/* 2 empty stat cards */}
        <div className="grid grid-cols-2 gap-4">
          <EmptyCard label="Active Calls" />
          <EmptyCard label="Calls with Issues" />
        </div>

        {/* Calls table section */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Calls</h2>
          <Card className="overflow-hidden">
            {/* Table header */}
            <div className="flex items-center border-b">
              {callColumns.map((col) => (
                <div
                  key={col.key}
                  className="px-4 py-2.5 text-sm text-muted-foreground"
                >
                  {col.label}
                </div>
              ))}
            </div>
            {/* Skeleton rows */}
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </Card>
        </div>
      </div>
    </div>
  );
}
