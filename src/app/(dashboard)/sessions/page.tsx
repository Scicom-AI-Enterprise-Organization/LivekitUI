"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { DataTable } from "@/components/livekit/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Search,
  SlidersHorizontal,
  LayoutGrid,
  LayoutList,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface RoomData {
  sid: string;
  name: string;
  numParticipants: number;
  numPublishers: number;
  maxParticipants: number;
  creationTime: number;
  metadata: string;
  activeRecording: boolean;
}

function StatusBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <Badge className="bg-green-500/20 text-green-500 border-transparent hover:bg-green-500/20 gap-1.5">
        <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
        active
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      empty
    </Badge>
  );
}

function formatTime(unix: number): string {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(creationTime: number): string {
  if (!creationTime) return "—";
  const now = Math.floor(Date.now() / 1000);
  const diff = now - creationTime;
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m}m`;
}

const columns = [
  { key: "roomName", label: "Room Name", sortable: true },
  { key: "sid", label: "SID" },
  { key: "startedAt", label: "Created At", sortable: true },
  { key: "duration", label: "Duration" },
  { key: "participants", label: "Participants", sortable: true },
  { key: "status", label: "Status" },
];

export default function SessionsPage() {
  const [layout, setLayout] = useState<"table" | "grid">("table");
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch");
      setRooms(data.rooms || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const filtered = rooms.filter((r) =>
    search ? r.name.toLowerCase().includes(search.toLowerCase()) || r.sid.toLowerCase().includes(search.toLowerCase()) : true
  );

  const tableData = filtered.map((room) => ({
    roomName: (
      <span className="font-medium text-foreground">{room.name}</span>
    ),
    sid: (
      <span className="text-xs text-muted-foreground font-mono">
        {room.sid.slice(0, 16)}...
      </span>
    ),
    startedAt: formatTime(room.creationTime),
    duration: formatDuration(room.creationTime),
    participants: (
      <span>
        {room.numParticipants}
        {room.numPublishers > 0 && (
          <span className="text-muted-foreground text-xs ml-1">
            ({room.numPublishers} publishing)
          </span>
        )}
      </span>
    ),
    status: <StatusBadge active={room.numParticipants > 0} />,
  }));

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Sessions"
        showRefresh
        showTimeRange
        actions={
          <Button variant="outline" size="sm" onClick={fetchRooms} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-auto bg-background p-6">
        {/* Stats */}
        <div className="mb-4 grid grid-cols-3 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Rooms</p>
            <p className="text-2xl font-semibold text-foreground">{rooms.length}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Active Rooms</p>
            <p className="text-2xl font-semibold text-foreground">
              {rooms.filter((r) => r.numParticipants > 0).length}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Participants</p>
            <p className="text-2xl font-semibold text-foreground">
              {rooms.reduce((acc, r) => acc + r.numParticipants, 0)}
            </p>
          </div>
        </div>

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
              placeholder="Search rooms..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Data table */}
        <DataTable
          columns={columns}
          data={tableData}
          emptyMessage={loading ? "Loading rooms..." : "No active rooms. Start a session to see it here."}
        />
      </div>
    </div>
  );
}
