"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
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

/**
 * Evenly spaced ticks, labelled by offset from the start of the session.
 *
 * `offset` is how far the visible window itself starts into the session, so a
 * zoomed-in view keeps counting from where the call began instead of restarting
 * at zero — which is the whole point of zooming in on a timestamp.
 */
export function buildTicks(span: number, count = 6, offset = 0): TimelineTick[] {
  const ticks: TimelineTick[] = [];
  // A zoomed-in window needs more decimals than a whole call does.
  const decimals = span < 2000 ? 2 : span < 20000 ? 1 : 0;
  for (let i = 0; i <= count; i++) {
    const t = offset + (span / count) * i;
    ticks.push({
      left: (i / count) * 100,
      label: `${(t / 1000).toFixed(decimals)}s`,
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

/** Zoom steps, and the shortest window worth drawing: a quarter of a second. */
const ZOOM_STEP = 2;
const MAX_ZOOM = 256;
const MIN_SPAN_MS = 250;

export interface TimelineView {
  /** Visible window — what every lane, bar and tick is drawn against. */
  start: number;
  end: number;
  span: number;
  /** 1 is the whole session; the maximum zoom *out*. */
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** Full session span, for the "4.0s of 26.1s" readout. */
  fullSpan: number;
  /** How far into the session the window starts, for tick labels. */
  offset: number;
}

/**
 * A zoomable window over a timeline.
 *
 * Fully zoomed out is the whole session, which is what the plots showed before
 * this existed — so the default is unchanged and zooming only ever narrows.
 *
 * The window **centres on the playhead** rather than being panned in absolute
 * terms: zoom in and you get the moment you are listening to, and it stays in
 * view as the recording plays. That is a pure derivation from the playhead, with
 * no effect chasing it — an effect would fight `react-hooks/set-state-in-effect`
 * and, worse, lag the audio by a frame. Panning shifts the window *relative* to
 * the playhead and survives until it is reset.
 */
export function useTimelineView({
  plotRef,
  start,
  end,
  playheadAt,
  live,
}: {
  plotRef: RefObject<HTMLDivElement | null>;
  start: number;
  end: number;
  /** Where the audio is, if there is any. The window follows it while zoomed. */
  playheadAt?: number | null;
  /** A live session anchors to now instead, since that is where it is drawing. */
  live?: boolean;
}): TimelineView {
  const [zoom, setZoom] = useState(1);
  /** User pan, in milliseconds relative to the anchor. */
  const [pan, setPan] = useState(0);

  const fullSpan = Math.max(1, end - start);
  const maxZoom = Math.min(MAX_ZOOM, Math.max(1, fullSpan / MIN_SPAN_MS));
  const effectiveZoom = Math.min(zoom, maxZoom);
  const span = fullSpan / effectiveZoom;

  // What the window is built around: the playhead if there is one, else the live
  // edge, else the middle of the session.
  const anchor = playheadAt ?? (live ? end : start + fullSpan / 2);
  const clampedStart = Math.min(
    Math.max(start, anchor - span / 2 + pan),
    Math.max(start, end - span)
  );

  const zoomBy = (factor: number) =>
    setZoom((current) => Math.min(maxZoom, Math.max(1, current * factor)));

  // The gesture reads the window through a ref so the listener can be attached
  // once: `anchor` moves with the playhead, which ticks several times a second
  // while audio plays, and re-subscribing that often is pure churn.
  const windowRef = useRef({ anchor, clampedStart, span, effectiveZoom, fullSpan, maxZoom });
  useEffect(() => {
    windowRef.current = { anchor, clampedStart, span, effectiveZoom, fullSpan, maxZoom };
  }, [anchor, clampedStart, span, effectiveZoom, fullSpan, maxZoom]);

  // A native, non-passive listener rather than React's `onWheel`: React attaches
  // wheel handlers passively, so `preventDefault()` there is ignored — ⌘/ctrl
  // wheel would zoom the whole browser page and shift-wheel would scroll it.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;

    const onWheel = (event: WheelEvent) => {
      const current = windowRef.current;
      // Plain wheel belongs to the page: the dock this sits in scrolls. Only a
      // modifier means the timeline.
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = plot.getBoundingClientRect();
        const ratio =
          rect.width > 0
            ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
            : 0.5;
        // Keep the instant under the cursor where it is: absorb the shift the
        // zoom would otherwise introduce into the pan.
        const under = current.clampedStart + ratio * current.span;
        const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const nextZoom = Math.min(
          current.maxZoom,
          Math.max(1, current.effectiveZoom * factor)
        );
        const nextSpan = current.fullSpan / nextZoom;
        setZoom(nextZoom);
        setPan(nextZoom === 1 ? 0 : under - ratio * nextSpan - (current.anchor - nextSpan / 2));
        return;
      }
      if (event.shiftKey && current.effectiveZoom > 1) {
        event.preventDefault();
        setPan((pan) => pan + (event.deltaY || event.deltaX) * (current.span / 400));
      }
    };

    plot.addEventListener("wheel", onWheel, { passive: false });
    return () => plot.removeEventListener("wheel", onWheel);
  }, [plotRef]);

  return {
    start: clampedStart,
    end: clampedStart + span,
    span,
    zoom: effectiveZoom,
    canZoomIn: effectiveZoom < maxZoom,
    canZoomOut: effectiveZoom > 1,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => {
      const next = Math.max(1, effectiveZoom / ZOOM_STEP);
      setZoom(next);
      if (next === 1) setPan(0);
    },
    reset: () => {
      setZoom(1);
      setPan(0);
    },
    fullSpan,
    offset: clampedStart - start,
  };
}

/**
 * Zoom controls, and the readout that says what you are looking at. Rendered by
 * both timelines so the two read the same.
 */
export function TimelineZoomControls({
  view,
  className,
}: {
  view: TimelineView;
  className?: string;
}) {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return (
    <div className={cn("flex items-center gap-1 font-mono text-[10px]", className)}>
      <span className="text-muted-foreground/70">
        {view.zoom > 1 ? `${seconds(view.span)} of ${seconds(view.fullSpan)}` : seconds(view.fullSpan)}
      </span>
      <button
        type="button"
        onClick={view.zoomOut}
        disabled={!view.canZoomOut}
        title="Zoom out (⌘/ctrl + scroll)"
        className="rounded border px-1.5 leading-4 text-muted-foreground hover:bg-accent disabled:opacity-40"
      >
        −
      </button>
      <button
        type="button"
        onClick={view.zoomIn}
        disabled={!view.canZoomIn}
        title="Zoom in (⌘/ctrl + scroll); shift + scroll pans"
        className="rounded border px-1.5 leading-4 text-muted-foreground hover:bg-accent disabled:opacity-40"
      >
        +
      </button>
      <button
        type="button"
        onClick={view.reset}
        disabled={!view.canZoomOut}
        title="Fit the whole session"
        className="rounded border px-1.5 leading-4 text-muted-foreground hover:bg-accent disabled:opacity-40"
      >
        fit
      </button>
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
