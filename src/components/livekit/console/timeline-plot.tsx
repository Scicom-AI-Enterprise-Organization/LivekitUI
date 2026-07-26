"use client";

import { useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * The pieces every console timeline shares: the time axis, the red playhead and
 * the click-or-drag-to-seek gesture. The event timeline and the metrics
 * timeline draw different lanes but are read against the same recording, so the
 * scrubbing behaviour and the playhead have to look and feel identical.
 */

/** How close the playhead must be for a marker to count as "now". */
export const TIMELINE_ACTIVE_WINDOW_MS = 350;

export interface TimelineTick {
  left: number;
  label: string;
}

/** Evenly spaced ticks, labelled by offset from the start of the window. */
export function buildTicks(span: number, count = 6): TimelineTick[] {
  const ticks: TimelineTick[] = [];
  for (let i = 0; i <= count; i++) {
    const t = (span / count) * i;
    ticks.push({
      left: (i / count) * 100,
      label: `${(t / 1000).toFixed(t < 10000 ? 1 : 0)}s`,
    });
  }
  return ticks;
}

export function TimelineAxis({ ticks }: { ticks: TimelineTick[] }) {
  return (
    <div className="relative h-4 border-b border-border/60">
      {ticks.map((tick, i) => (
        <div
          key={i}
          className="absolute top-0 h-full border-l border-border/40 pl-1 font-mono text-[9px] text-muted-foreground"
          style={{ left: `${tick.left}%` }}
        >
          {tick.label}
        </div>
      ))}
    </div>
  );
}

export function TimelinePlayhead({ pct, scrubbing }: { pct: number; scrubbing: boolean }) {
  return (
    // Pointer events stay off so the press lands on the plot underneath — grabbing
    // the line itself is just a scrub that starts on it.
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 z-10 bg-red-500",
        scrubbing ? "w-0.5" : "w-px"
      )}
      style={{ left: `${pct}%` }}
    >
      <div
        className={cn(
          "absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-red-500 transition-transform",
          scrubbing ? "size-3 ring-2 ring-red-500/30" : "size-2"
        )}
      />
    </div>
  );
}

/**
 * Press anywhere in the plot to seek there, and keep seeking while the pointer
 * moves — so a click and a scrub are the same gesture. Listeners live for the
 * duration of the drag only, and follow the pointer outside the plot so the
 * playhead doesn't stick when you overshoot.
 *
 * Call this before any early return: the window it maps clientX through is read
 * per render, so a timeline with nothing to draw can pass a placeholder span.
 */
export function useTimelineScrub({
  plotRef,
  start,
  span,
  onSeek,
}: {
  plotRef: RefObject<HTMLDivElement | null>;
  start: number;
  span: number;
  onSeek?: (at: number) => void;
}) {
  const [scrubbing, setScrubbing] = useState(false);

  const seekFromClientX = (clientX: number) => {
    const plot = plotRef.current;
    if (!plot || !onSeek) return;
    const rect = plot.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(start + ratio * span);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    event.preventDefault();
    seekFromClientX(event.clientX);
    setScrubbing(true);

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const move = (e: PointerEvent) => seekFromClientX(e.clientX);
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = "";
      setScrubbing(false);
    };

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  };

  return {
    scrubbing,
    /** Spread onto the plot element: `<div {...} onPointerDown={onPointerDown}>`. */
    onPointerDown,
    /** Cursor for the plot, so a drag reads as a scrub. */
    cursorClass: onSeek ? (scrubbing ? "cursor-ew-resize" : "cursor-pointer") : undefined,
  };
}
