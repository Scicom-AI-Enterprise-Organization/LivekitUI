"use client";

import { useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/console-metrics";
import {
  RECORDING_KIND_LABEL,
  formatBytes,
  recordingSrc,
  type SavedRecording,
} from "./session-types";

/** One saved recording: play it, download it, or delete it. */
export function RecordingRow({
  agentName,
  recording,
  onDeleted,
}: {
  agentName: string;
  recording: SavedRecording;
  /** Omitted where deleting makes no sense, which hides the button. */
  onDeleted?: (file: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const src = recordingSrc(agentName, recording.file);

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/recordings`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: recording.file }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to delete");
        return;
      }
      onDeleted?.(recording.file);
    } catch {
      setError("Failed to delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={recording.kind === "mixed" ? "outline" : "secondary"}
          className="text-[10px] uppercase"
        >
          {RECORDING_KIND_LABEL[recording.kind] ?? recording.kind}
        </Badge>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80"
          title={recording.room}
        >
          {recording.room}
        </span>
        {recording.storage === "s3" && (
          <Badge variant="outline" className="text-[10px] uppercase text-muted-foreground">
            s3
          </Badge>
        )}
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatDuration(recording.durationMs)} · {formatBytes(recording.bytes)} ·{" "}
          {new Date(recording.createdAt).toLocaleString()}
        </span>
        <Button variant="ghost" size="icon-xs" asChild title="Download">
          <a href={src} download={recording.file}>
            <Download className="size-3.5" />
          </a>
        </Button>
        {onDeleted && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={remove}
            disabled={busy}
            title="Delete"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </Button>
        )}
      </div>
      <audio src={src} controls preload="metadata" className="mt-2 h-8 w-full" />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** The saved-audio list, with whatever status line the caller wants above it. */
export function SavedAudioList({
  agentName,
  recordings,
  title = "Saved session audio",
  emptyMessage,
  status,
  onDeleted,
}: {
  agentName: string;
  recordings: SavedRecording[];
  title?: string;
  emptyMessage: string;
  status?: React.ReactNode;
  onDeleted?: (file: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <span className="h-px flex-1 bg-border" />
        {status}
      </div>

      {recordings.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {recordings.map((r) => (
            <RecordingRow
              key={r.file}
              agentName={agentName}
              recording={r}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}
