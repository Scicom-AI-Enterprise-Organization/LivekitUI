"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Loader2, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/console-metrics";
import { TIMELINE_ACTIVE_WINDOW_MS } from "./timeline-plot";
import type { TranscriptLine } from "./session-types";

/** Small building blocks shared by the console and the replay view. */

/**
 * Dock height, and the range the drag handle allows. The default leaves the
 * full-size timeline and a usable log side by side; drag for more of either.
 */
export const DEFAULT_DOCK_HEIGHT = 420;
export const MIN_DOCK_HEIGHT = 120;
/** Leave this much for the header, stage and rail whatever the dock does. */
const STAGE_RESERVE = 240;

export function DockResizeHandle({
  height,
  onResize,
}: {
  height: number;
  onResize: (height: number) => void;
}) {
  const clamp = (value: number) => {
    const ceiling =
      typeof window === "undefined"
        ? 640
        : Math.max(MIN_DOCK_HEIGHT, window.innerHeight - STAGE_RESERVE);
    return Math.min(Math.max(MIN_DOCK_HEIGHT, Math.round(value)), ceiling);
  };

  // Dragging up grows the dock. Listeners are attached per drag rather than in
  // an effect, so nothing is bound while the user isn't resizing.
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const move = (e: PointerEvent) => onResize(clamp(startHeight + (startY - e.clientY)));
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = "";
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panel"
      aria-valuenow={height}
      tabIndex={0}
      onPointerDown={startDrag}
      onDoubleClick={() => onResize(DEFAULT_DOCK_HEIGHT)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          onResize(clamp(height + 24));
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          onResize(clamp(height - 24));
        }
      }}
      title="Drag to resize · double-click to reset"
      className="group flex h-2 cursor-row-resize items-center justify-center outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
    >
      <span className="h-0.5 w-8 rounded-full bg-border transition-colors group-hover:bg-primary/60" />
    </div>
  );
}

export function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function RailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="font-mono uppercase tracking-wide text-muted-foreground shrink-0">
        {label}
      </span>
      <span
        className={cn("min-w-0 break-all text-right text-foreground/80", mono && "font-mono")}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function DockEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg text-foreground">{value}</div>
    </div>
  );
}

/**
 * The conversation.
 *
 * Given a playhead it also follows the recording: the line being spoken is
 * highlighted, and clicking a line seeks the audio to it. That is what makes
 * the transcript readable against the event log rather than beside it.
 */
export function TranscriptPanel({
  lines,
  className,
  emptyMessage = "Waiting for speech…",
  /** Off while reviewing, so the pane holds the position you are reading. */
  autoScroll = true,
  playheadAt,
  canSeekTo,
  onSeek,
  onSend,
  sending,
  composerPlaceholder = "Message the agent…",
}: {
  lines: TranscriptLine[];
  className?: string;
  emptyMessage?: string;
  autoScroll?: boolean;
  /** Wall-clock instant of the recording playhead, to follow along. */
  playheadAt?: number | null;
  canSeekTo?: (at: number) => boolean;
  onSeek?: (at: number) => void;
  /** Given, the pane grows a composer — typing is another way to take a turn. */
  onSend?: (text: string) => void | Promise<void>;
  sending?: boolean;
  composerPlaceholder?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoScroll) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length, autoScroll]);

  // A line is "current" from when it starts until the next one does, which is
  // what makes the transcript readable against a playing recording.
  const activeIndex = useMemo(() => {
    if (playheadAt == null) return -1;
    let index = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].at <= playheadAt + TIMELINE_ACTIVE_WINDOW_MS) index = i;
    }
    return index;
  }, [lines, playheadAt]);

  return (
    <div className={cn("flex min-h-0 flex-col", className ?? "w-1/2")}>
      <div className="border-b px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        Transcript
        {lines.length > 0 && (
          <span className="ml-1.5 text-muted-foreground/60">{lines.length}</span>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {lines.length === 0 && <p className="text-sm text-muted-foreground">{emptyMessage}</p>}
        {lines.map((line, i) => {
          const seekable = onSeek ? (canSeekTo?.(line.at) ?? true) : false;
          return (
            <div
              key={line.id}
              role={seekable ? "button" : undefined}
              tabIndex={seekable ? 0 : undefined}
              onClick={seekable ? () => onSeek?.(line.at) : undefined}
              onKeyDown={
                seekable
                  ? (ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        onSeek?.(line.at);
                      }
                    }
                  : undefined
              }
              className={cn(
                "flex gap-2 rounded px-1.5 py-0.5 text-sm",
                i === activeIndex
                  ? "bg-primary/10 ring-1 ring-primary/30"
                  : seekable && "hover:bg-muted/40",
                seekable && "cursor-pointer"
              )}
              title={
                seekable
                  ? `${formatClock(line.at)} — play the recording from here`
                  : formatClock(line.at)
              }
            >
              <span className="shrink-0 font-mono text-[10px] leading-5 tabular-nums text-muted-foreground/70">
                {formatSpeechClock(line.at)}
              </span>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1 font-mono text-xs leading-5",
                  line.isAgent ? "text-primary" : "text-muted-foreground"
                )}
              >
                {/* Typed turns never passed through STT — worth distinguishing
                    when a transcript is being read as evidence of what was heard. */}
                {line.via === "text" && (
                  <Keyboard className="size-3 opacity-70" aria-label="typed" />
                )}
                {line.isAgent ? "agent" : line.identity}
              </span>
              <span className="min-w-0 text-foreground/90">{line.text}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {onSend && <TranscriptComposer onSend={onSend} sending={sending} placeholder={composerPlaceholder} />}
    </div>
  );
}

/**
 * Types a turn instead of speaking it. The text goes to the agent on the
 * `lk.chat` topic, which its session treats as user input: it interrupts
 * whatever it was saying and answers out loud.
 */
function TranscriptComposer({
  onSend,
  sending,
  placeholder,
}: {
  onSend: (text: string) => void | Promise<void>;
  sending?: boolean;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    // Cleared first: a send that fails is reported in the event log, and
    // retyping is cheaper than a box that will not empty.
    setDraft("");
    await onSend(text);
  };

  return (
    <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t p-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm"
        autoComplete="off"
      />
      <Button type="submit" size="icon-sm" disabled={!draft.trim() || sending} title="Send">
        {sending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <SendHorizontal className="size-3.5" />
        )}
      </Button>
    </form>
  );
}

/** HH:MM:SS — the event log carries the milliseconds when they are needed. */
export function formatSpeechClock(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour12: false });
}
