"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AudioLines,
  Loader2,
  Mic,
  Phone,
  Radio,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { TopBar } from "@/components/livekit/top-bar";
import { DataTable } from "@/components/livekit/data-table";
import { Pagination } from "@/components/livekit/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDuration } from "@/lib/console-metrics";

/**
 * Sessions that have already happened.
 *
 * The live Sessions page lists rooms that exist right now; this lists console
 * sessions that were saved when they ended, each replayable with its events,
 * transcript, metrics and audio.
 */

interface SessionRow {
  id: number;
  agentName: string;
  room: string;
  talkMode: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  participants: number;
  eventCount: number;
  metricCount: number;
  transcriptCount: number;
  /** "console" — a browser tab hosted it — or "observer" — captured server-side. */
  source: string;
}

const DEFAULT_PAGE_SIZE = 50;
const ALL_AGENTS = "__all__";

export default function SessionHistoryPageRoute() {
  // useSearchParams (the agent and search filters) needs a boundary.
  return (
    <Suspense fallback={null}>
      <SessionHistoryPage />
    </Suspense>
  );
}

function SessionHistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const agentFilter = searchParams.get("agent") || "";
  const query = searchParams.get("q") || "";

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SessionRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  // Selected session ids. Held as ids rather than rows so a reload that
  // refreshes the row objects does not drop the selection.
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // Anchor for shift-click range selection, as an index into the current page.
  const [lastToggled, setLastToggled] = useState<number | null>(null);

  // The search box types locally and commits to the URL, so every keystroke is
  // not a request — and a committed search is linkable.
  const [searchDraft, setSearchDraft] = useState(query);

  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      setOffset(0);
      router.replace(next.toString() ? `?${next.toString()}` : "?", { scroll: false });
    },
    [router, searchParams]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (agentFilter) params.set("agent", agentFilter);
      if (query) params.set("q", query);

      const res = await fetch(`/api/sessions?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load sessions");

      setSessions(data.sessions || []);
      setAgents(data.agents || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentFilter, query, offset, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setRole(d?.user?.role ?? null))
      .catch(() => {});
  }, []);

  const canManage = role === "owner" || role === "admin";

  // A filter or page change swaps the rows underneath, so a carried-over
  // selection would delete sessions that are no longer on screen.
  useEffect(() => {
    setSelected(new Set());
    setLastToggled(null);
  }, [agentFilter, query, offset]);

  const toggleOne = useCallback(
    (index: number, checked: boolean, extendRange: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const from = extendRange && lastToggled !== null ? lastToggled : index;
        const [lo, hi] = from <= index ? [from, index] : [index, from];
        for (let i = lo; i <= hi; i++) {
          const row = sessions[i];
          if (!row) continue;
          if (checked) next.add(row.id);
          else next.delete(row.id);
        }
        return next;
      });
      setLastToggled(index);
    },
    [sessions, lastToggled]
  );

  const allSelected = sessions.length > 0 && sessions.every((s) => selected.has(s.id));
  const someSelected = selected.size > 0 && !allSelected;

  // Only rows on this page can be deleted — the ids of anything selected
  // before a page change are dropped by the reset effect above, but guard the
  // arithmetic anyway so the button count never overstates what will go.
  const selectedOnPage = sessions.filter((s) => selected.has(s.id));
  const selectedOffPage = selected.size - selectedOnPage.length;

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(sessions.map((s) => s.id)) : new Set());
      setLastToggled(null);
    },
    [sessions]
  );

  const removeSelected = async () => {
    const ids = sessions.filter((s) => selected.has(s.id)).map((s) => s.id);
    if (ids.length === 0) return;

    setDeleting(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setBulkOpen(false);
        setError(
          data.error === "Insufficient permissions"
            ? "Only an admin or owner can delete a session."
            : data.error || `Could not delete the sessions (HTTP ${res.status}).`
        );
        return;
      }

      setBulkOpen(false);
      setSelected(new Set());
      setLastToggled(null);
      await load();

      // Success is silent — the rows leaving the table is the feedback. Only a
      // partial failure needs saying, and it is set after the reload because
      // load() clears the banner on its way in.
      if (data.failed?.length) {
        const detail = data.failed
          .slice(0, 3)
          .map((f: { id: number; error: string }) => `#${f.id}: ${f.error}`)
          .join(" · ");
        setError(
          `${data.deleted} deleted, ${data.failed.length} could not be removed — ${detail}`
        );
      }
    } catch {
      setBulkOpen(false);
      setError("Could not reach the dashboard API.");
    } finally {
      setDeleting(false);
    }
  };

  const remove = async (session: SessionRow) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPendingDelete(null);
        setError(
          data.error === "Insufficient permissions"
            ? "Only an admin or owner can delete a session."
            : data.error || `Could not delete the session (HTTP ${res.status}).`
        );
        return;
      }
      // Silent on success — the row disappearing says it.
      setPendingDelete(null);
      void load();
    } catch {
      setPendingDelete(null);
      setError("Could not reach the dashboard API.");
    } finally {
      setDeleting(false);
    }
  };

  const totals = useMemo(
    () => ({
      duration: sessions.reduce((sum, s) => sum + s.durationMs, 0),
      transcripts: sessions.filter((s) => s.transcriptCount > 0).length,
    }),
    [sessions]
  );

  const columns = [
    ...(canManage
      ? [
          {
            key: "select",
            label: (
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(value) => toggleAll(value === true)}
                disabled={sessions.length === 0}
                aria-label="Select all sessions on this page"
              />
            ),
            className: "w-10",
          },
        ]
      : []),
    { key: "started", label: "Started", sortable: true },
    { key: "agent", label: "Agent" },
    { key: "room", label: "Room" },
    { key: "duration", label: "Duration" },
    { key: "mode", label: "Talk via" },
    { key: "contents", label: "Captured" },
    // Delete is all that is left in there, so a member gets no column at all.
    ...(canManage ? [{ key: "actions", label: "", className: "text-right w-10" }] : []),
  ];

  const tableData = sessions.map((session, index) => ({
    __selected: selected.has(session.id),
    select: canManage ? (
      <Checkbox
        checked={selected.has(session.id)}
        // Driven from the click rather than onCheckedChange, because only the
        // event carries the shift modifier that extends a range. Radix skips
        // its own toggle once the event is default-prevented, so this stays the
        // single source of the next state.
        onClick={(event) => {
          event.preventDefault();
          toggleOne(index, !selected.has(session.id), event.shiftKey);
        }}
        aria-label={`Select session ${session.room}`}
      />
    ) : null,
    // The row itself opens the session; this is the same destination as a real
    // link, which is what keyboard and screen-reader users have to reach it by.
    started: (
      <Link
        href={`/sessions/history/${session.id}`}
        className="font-medium text-foreground hover:text-primary"
      >
        {new Date(session.startedAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Link>
    ),
    agent: (
      <Link
        href={`/agents/${encodeURIComponent(session.agentName)}`}
        className="font-medium text-foreground hover:text-primary"
      >
        {session.agentName}
      </Link>
    ),
    room: (
      <span className="font-mono text-xs text-muted-foreground" title={session.room}>
        {session.room.length > 26 ? `…${session.room.slice(-24)}` : session.room}
      </span>
    ),
    duration: (
      <span className="font-mono text-xs">
        {session.durationMs ? formatDuration(session.durationMs) : "—"}
      </span>
    ),
    mode: (
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="gap-1.5 text-[10px] uppercase text-muted-foreground">
          {session.talkMode === "sip" ? <Phone className="size-3" /> : <Mic className="size-3" />}
          {session.talkMode}
        </Badge>
        {/* Only worth calling out when nobody was watching — a console session is
            the norm, and a captured one explains its own thinner contents. */}
        {session.source !== "console" && (
          <Badge
            variant="outline"
            className="gap-1.5 text-[10px] uppercase text-muted-foreground"
            title="Recorded server-side; no browser tab hosted this session"
          >
            <Radio className="size-3" />
            captured
          </Badge>
        )}
      </div>
    ),
    contents: (
      <span className="font-mono text-[11px] text-muted-foreground">
        {session.transcriptCount} lines · {session.eventCount} events · {session.metricCount}{" "}
        metrics
      </span>
    ),
    actions: canManage ? (
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setPendingDelete(session)}
          title="Delete session"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    ) : null,
  }));

  return (
    <div className="flex h-full flex-col">
      <TopBar
        title="Session history"
        breadcrumb={[{ label: "Sessions", href: "/sessions" }]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-auto bg-background p-6">
        {/* Stats */}
        <div className="mb-4 grid grid-cols-3 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Saved sessions</p>
            <p className="text-2xl font-semibold text-foreground">{total}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Talk time on this page</p>
            <p className="text-2xl font-semibold text-foreground">
              {formatDuration(totals.duration)}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">With a transcript</p>
            <p className="text-2xl font-semibold text-foreground">{totals.transcripts}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select
            value={agentFilter || ALL_AGENTS}
            onValueChange={(value) => setFilter("agent", value === ALL_AGENTS ? "" : value)}
          >
            <SelectTrigger size="sm" className="min-w-[180px]">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_AGENTS}>All agents</SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent} value={agent}>
                  {agent}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <form
            className="relative max-w-xs flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              setFilter("q", searchDraft.trim());
            }}
          >
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search room or transcript…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </form>

          {(query || agentFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchDraft("");
                setOffset(0);
                router.replace("?", { scroll: false });
              }}
            >
              Clear filters
            </Button>
          )}

          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <AudioLines className="size-3.5" />
            Audio is stored where Settings → Storage points
          </span>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Bulk actions. Kept above the table so the count sits next to the
            select-all box that produced it. */}
        {canManage && selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
            <span className="text-sm font-medium text-foreground">
              {selected.size} selected
            </span>
            {selectedOffPage > 0 && (
              <span className="text-xs text-muted-foreground">
                ({selectedOffPage} on other pages will be kept)
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => toggleAll(false)}>
              Clear
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="ml-auto gap-1.5"
              onClick={() => setBulkOpen(true)}
            >
              <Trash2 className="size-3.5" />
              Delete {selectedOnPage.length}
            </Button>
          </div>
        )}

        <DataTable
          columns={columns}
          data={tableData}
          onRowClick={(_row, index) => {
            const session = sessions[index];
            if (session) router.push(`/sessions/history/${session.id}`);
          }}
          rowClassName={(row) => (row.__selected ? "bg-primary/5" : undefined)}
          emptyMessage={
            loading
              ? "Loading sessions…"
              : query || agentFilter
                ? "No sessions match these filters."
                : "No sessions saved yet. Run one from an agent's Console and it will appear here when it ends."
          }
        />

        <Pagination
          total={total}
          offset={offset}
          pageSize={pageSize}
          loading={loading}
          onOffsetChange={setOffset}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setOffset(0);
          }}
        />
      </div>

      <Dialog open={bulkOpen} onOpenChange={(open) => !open && setBulkOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selectedOnPage.length} session{selectedOnPage.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              The transcript, events, metrics and any recorded audio are deleted for each one.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border bg-muted/40 px-3 py-2">
            {selectedOnPage.map((session) => (
              <div key={session.id} className="font-mono text-xs text-muted-foreground">
                {session.agentName} · {session.room}
              </div>
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" disabled={deleting} onClick={() => void removeSelected()}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete {selectedOnPage.length} session{selectedOnPage.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              The transcript, events, metrics and any recorded audio are deleted. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          {pendingDelete && (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
              {pendingDelete.agentName} · {pendingDelete.room}
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => pendingDelete && void remove(pendingDelete)}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
