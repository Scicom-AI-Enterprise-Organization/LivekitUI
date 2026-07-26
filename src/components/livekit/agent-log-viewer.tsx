"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, ScrollText, X } from "lucide-react";
import {
  DEFAULT_TAIL,
  TAIL_OPTIONS,
  formatBytes,
  isTailSize,
  type TailSize,
} from "@/lib/log-tail";

const POLL_MS = 3000;

/**
 * Live tail of an agent's log.
 *
 * Shared by the builder and the agent detail page. `tail` and `onTailChange`
 * are lifted so the caller can keep them in the URL; leave them out and the
 * viewer manages the size itself.
 */
export function AgentLogViewer({
  name,
  onClose,
  tail: tailProp,
  onTailChange,
}: {
  name: string;
  onClose: () => void;
  tail?: TailSize;
  onTailChange?: (tail: TailSize) => void;
}) {
  const [localTail, setLocalTail] = useState<TailSize>(DEFAULT_TAIL);
  const tail = isTailSize(tailProp) ? tailProp : localTail;
  const setTail = (next: TailSize) => {
    setLocalTail(next);
    onTailChange?.(next);
  };

  const [logs, setLogs] = useState("");
  const [meta, setMeta] = useState<{ size: number; truncated: boolean; running: boolean } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll while the reader is already at the bottom, so scrolling
  // back to read something isn't yanked away by the next poll.
  const pinnedToBottom = useRef(true);

  const fetchLogs = useCallback(async () => {
    setFetching(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}/logs?tail=${tail}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not read logs (${res.status})`);
        return;
      }
      setLogs(data.logs || "");
      setMeta({ size: data.size ?? 0, truncated: !!data.truncated, running: !!data.running });
      setError(null);
    } catch {
      setError("Could not reach the dashboard API");
    } finally {
      setFetching(false);
    }
  }, [name, tail]);

  useEffect(() => {
    fetchLogs();
    if (!live) return;
    const interval = setInterval(fetchLogs, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchLogs, live]);

  // Keep the newest line in view after each update.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex h-[80vh] w-[80vw] max-w-4xl flex-col rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <ScrollText className="size-4 shrink-0 text-muted-foreground" />
            <h3 className="truncate text-sm font-semibold text-foreground">Logs: {name}</h3>
            {live && (
              <Badge variant="outline" className="shrink-0 gap-1 text-xs">
                <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                Live
              </Badge>
            )}
            {meta && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(meta.size)}
                {meta.truncated ? " · tailed" : ""}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Select value={tail} onValueChange={(v) => setTail(v as TailSize)}>
              <SelectTrigger size="sm" className="h-7 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAIL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setLive(!live)}
            >
              {live ? "Pause" : "Resume"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={fetchLogs}
              disabled={fetching}
            >
              <RefreshCw className={`size-3 ${fetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close logs">
              <X className="size-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto bg-[#0d1117] p-4">
          <pre className="text-xs font-mono leading-5 text-[#e6edf3] whitespace-pre-wrap break-all">
            {logs || (fetching ? "Loading…" : "No logs yet.")}
          </pre>
        </div>
      </div>
    </div>
  );
}
