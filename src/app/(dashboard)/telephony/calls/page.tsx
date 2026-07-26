"use client";

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/livekit/top-bar";
import { StatCard } from "@/components/livekit/stat-card";
import { DataTable } from "@/components/livekit/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Info, RefreshCw, PhoneOff } from "lucide-react";
import { useApiList } from "@/hooks/use-api-list";
import { PlaceCallPanel } from "@/components/livekit/place-call-panel";
import { ListError, ListLoading, ServiceNotice } from "@/components/livekit/list-state";

interface Call {
  callId: string;
  roomName: string;
  participantIdentity: string;
  from: string | null;
  to: string | null;
  direction: string | null;
  status: string;
  startedAt: string | null;
  durationSeconds: number | null;
}

const columns = [
  { key: "callId", label: "Call ID" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "room", label: "Room" },
  { key: "startedAt", label: "Started At" },
  { key: "duration", label: "Duration" },
  { key: "status", label: "Status" },
  { key: "actions", label: "" },
];

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${seconds % 60}s`;
}

export default function TelephonyCallsPage() {
  return (
    <Suspense fallback={null}>
      <TelephonyCallsContent />
    </Suspense>
  );
}

function TelephonyCallsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?call=new opens the outbound test-call dialog.
  const placing = searchParams.get("call") === "new";

  const setPlacing = useCallback(
    (open: boolean) => {
      const params = new URLSearchParams(window.location.search);
      if (open) params.set("call", "new");
      else params.delete("call");
      const qs = params.toString();
      router.replace(qs ? `/telephony/calls?${qs}` : "/telephony/calls", { scroll: false });
    },
    [router]
  );

  const { items, loading, error, notice, reload } = useApiList<Call>("/api/calls", "calls");

  const totalDuration = items.reduce((n, c) => n + (c.durationSeconds || 0), 0);
  const avgDuration = items.length ? Math.round(totalDuration / items.length) : 0;
  const withIssues = items.filter((c) => /fail|error|busy|no.?answer/i.test(c.status)).length;

  // Ending a call means closing its room: dropping one participant leaves the
  // rest of the call up.
  const endCall = async (room: string) => {
    await fetch("/api/calls/place", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room }),
    }).catch(() => {});
    reload();
  };

  const rows = items.map((c) => ({
    callId: <span className="font-mono text-xs">{c.callId}</span>,
    from: c.from || "—",
    to: c.to || "—",
    room: c.roomName,
    startedAt: c.startedAt ? new Date(c.startedAt).toLocaleString() : "—",
    duration: formatDuration(c.durationSeconds),
    status: (
      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
        {c.status}
      </Badge>
    ),
    actions: (
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-destructive"
        title="End this call"
        onClick={() => endCall(c.roomName)}
      >
        <PhoneOff className="size-3.5" />
      </Button>
    ),
  }));

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Telephony" showTimeRange>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={reload}>
          <RefreshCw className="size-3" />
          Refresh
        </Button>
        <PlaceCallPanel open={placing} onOpenChange={setPlacing} onCallPlaced={reload} />
      </TopBar>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {error && <ListError message={error} />}
        {notice && <ServiceNotice message={notice.message} reason={notice.reason} />}

        {loading ? (
          <ListLoading />
        ) : notice ? null : (
          <>
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Active Calls" value={items.length} />
              <StatCard label="Total Call Duration" value={String(totalDuration)} unit="sec" />
              <StatCard label="Average Call Duration" value={String(avgDuration)} unit="sec" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Card className="py-4">
                <CardContent className="px-5 py-0">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-sm text-muted-foreground">Active Calls</span>
                    <Info className="size-3 text-muted-foreground" />
                  </div>
                  <span className="text-2xl font-semibold text-primary">{items.length}</span>
                </CardContent>
              </Card>
              <Card className="py-4">
                <CardContent className="px-5 py-0">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-sm text-muted-foreground">Calls with Issues</span>
                    <Info className="size-3 text-muted-foreground" />
                  </div>
                  <span className="text-2xl font-semibold text-primary">{withIssues}</span>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Calls</h2>
              <DataTable
                columns={columns}
                data={rows}
                emptyMessage="No active calls. A call appears here while a SIP participant is in a room."
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
