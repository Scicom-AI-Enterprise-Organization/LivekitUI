"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Tracing-style timeline for console events, optionally synced to the session
 * recording.
 *
 * Point events (participant joined, track published, data received…) are drawn
 * as markers on a lane per category. Agent state is drawn as spans instead —
 * each state runs until the next transition — so the listening → thinking →
 * speaking rhythm of a call is readable at a glance.
 *
 * When `playheadAt` is supplied the timeline draws a playhead at that wall-clock
 * instant and clicking anywhere in the plot reports the instant clicked, which
 * is how the audio player scrubs.
 */

export interface TimelineEvent {
  id: string;
  at: number;
  name: string;
  detail: string;
  level: "info" | "warn" | "error";
}

interface Lane {
  key: string;
  label: string;
  color: string;
}

const LANES: Lane[] = [
  { key: "agent", label: "Agent state", color: "#a78bfa" },
  { key: "session", label: "Session", color: "#22c55e" },
  { key: "room", label: "Room", color: "#f59e0b" },
  { key: "participant", label: "Participants", color: "#38bdf8" },
  { key: "track", label: "Tracks", color: "#2dd4bf" },
  { key: "data", label: "Data", color: "#e879f9" },
  { key: "control", label: "RPC / DTMF", color: "#fb7185" },
  { key: "other", label: "Other", color: "#94a3b8" },
];

/** Colours agent states so a span's meaning is obvious without a legend. */
const AGENT_STATE_COLOR: Record<string, string> = {
  listening: "#38bdf8",
  thinking: "#a78bfa",
  speaking: "#22c55e",
  initializing: "#94a3b8",
  connecting: "#f59e0b",
  disconnected: "#64748b",
};

/** How close the playhead must be for a marker to count as "now". */
export const TIMELINE_ACTIVE_WINDOW_MS = 350;

function laneOf(name: string): string {
  const prefix = name.split(".")[0];
  switch (prefix) {
    case "agent":
      return "agent";
    case "session":
      return "session";
    case "room":
    case "connection":
      return "room";
    case "participant":
      return "participant";
    case "track":
      return "track";
    case "data":
      return "data";
    case "dtmf":
    case "rpc":
      return "control";
    default:
      return "other";
  }
}

export function EventTimeline({
  events,
  live,
  className,
  audioWindow,
  playheadAt,
  onSeek,
}: {
  events: TimelineEvent[];
  /** While live the axis extends to now, so spans keep growing. */
  live?: boolean;
  className?: string;
  /** Recording span, so the axis covers audio that runs past the last event. */
  audioWindow?: { start: number; end: number } | null;
  /** Wall-clock instant of the audio playhead. */
  playheadAt?: number | null;
  /** Called with the wall-clock instant clicked in the plot. */
  onSeek?: (at: number) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);

  // While the session is live the axis has to follow the clock, not the last
  // event: otherwise nothing moves between events and the state the agent is
  // *currently* in never grows.
  const [now, setNow] = useState(() => Date.now());
  const [scrubbing, setScrubbing] = useState(false);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [live]);

  // Grouping only depends on the events, so it survives every clock tick.
  const grouped = useMemo(() => {
    if (events.length === 0) return null;

    const byLane = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const key = laneOf(e.name);
      const bucket = byLane.get(key) ?? [];
      bucket.push(e);
      byLane.set(key, bucket);
    }

    return {
      first: events[0].at,
      last: events[events.length - 1].at,
      byLane,
      stateEvents: (byLane.get("agent") ?? []).filter((e) => e.name === "agent.state"),
    };
  }, [events]);

  if (!grouped) return null;

  // Cheap enough to redo on every tick.
  const model = (() => {
    const start = Math.min(grouped.first, audioWindow?.start ?? grouped.first);
    const end = Math.max(
      grouped.last + 500,
      audioWindow?.end ?? 0,
      live ? now : 0,
      start + 1000
    );
    const span = end - start;

    // Agent state → spans between transitions; the last one runs to the edge,
    // which is "now" during a live session.
    const spans = grouped.stateEvents.map((e, i) => {
      const next = grouped.stateEvents[i + 1];
      const spanEnd = next ? next.at : end;
      return {
        id: e.id,
        state: e.detail,
        left: ((e.at - start) / span) * 100,
        width: Math.max(0.4, ((spanEnd - e.at) / span) * 100),
        at: e.at,
        durationMs: spanEnd - e.at,
      };
    });

    const ticks: { left: number; label: string }[] = [];
    const tickCount = 6;
    for (let i = 0; i <= tickCount; i++) {
      const t = (span / tickCount) * i;
      ticks.push({
        left: (i / tickCount) * 100,
        label: `${(t / 1000).toFixed(t < 10000 ? 1 : 0)}s`,
      });
    }

    return { start, end, span, byLane: grouped.byLane, spans, ticks };
  })();

  const lanes = LANES.filter((lane) => (model.byLane.get(lane.key)?.length ?? 0) > 0);

  const playheadPct =
    playheadAt != null && playheadAt >= model.start && playheadAt <= model.end
      ? ((playheadAt - model.start) / model.span) * 100
      : null;

  const audioPct = audioWindow
    ? {
        left: ((Math.max(audioWindow.start, model.start) - model.start) / model.span) * 100,
        width:
          ((Math.min(audioWindow.end, model.end) - Math.max(audioWindow.start, model.start)) /
            model.span) *
          100,
      }
    : null;

  const seekFromClientX = (clientX: number) => {
    const plot = plotRef.current;
    if (!plot || !onSeek) return;
    const rect = plot.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(model.start + ratio * model.span);
  };

  /**
   * Press anywhere in the plot to seek there, and keep seeking while the
   * pointer moves — so a click and a scrub are the same gesture. Listeners live
   * for the duration of the drag only, and follow the pointer outside the plot
   * so the playhead doesn't stick when you overshoot.
   */
  const startScrub = (event: React.PointerEvent<HTMLDivElement>) => {
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

  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <div className="flex gap-2">
        {/* Lane labels */}
        <div className="w-[104px] shrink-0 space-y-1.5">
          <div className="h-4" />
          {lanes.map((lane) => (
            <div
              key={lane.key}
              className="flex h-5 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: lane.color }} />
              <span className="truncate">{lane.label}</span>
              <span className="text-muted-foreground/60">
                {model.byLane.get(lane.key)?.length ?? 0}
              </span>
            </div>
          ))}
        </div>

        {/* Plot */}
        <div
          ref={plotRef}
          className={cn(
            "relative min-w-0 flex-1 space-y-1.5 touch-none",
            onSeek && (scrubbing ? "cursor-ew-resize" : "cursor-pointer")
          )}
          onPointerDown={startScrub}
        >
          {/* Axis */}
          <div className="relative h-4 border-b border-border/60">
            {model.ticks.map((tick, i) => (
              <div
                key={i}
                className="absolute top-0 h-full border-l border-border/40 pl-1 font-mono text-[9px] text-muted-foreground"
                style={{ left: `${tick.left}%` }}
              >
                {tick.label}
              </div>
            ))}
          </div>

          {lanes.map((lane) => {
            const laneEvents = model.byLane.get(lane.key) ?? [];
            return (
              <div key={lane.key} className="relative h-5 rounded bg-muted/50">
                {/* Recorded span, so it is obvious what the audio covers */}
                {audioPct && (
                  <div
                    className="absolute inset-y-0 rounded bg-foreground/5"
                    style={{ left: `${audioPct.left}%`, width: `${audioPct.width}%` }}
                  />
                )}

                {/* Agent state spans */}
                {lane.key === "agent" &&
                  model.spans.map((span) => (
                    <div
                      key={`span-${span.id}`}
                      className="absolute inset-y-0.5 rounded-sm"
                      style={{
                        left: `${span.left}%`,
                        width: `${span.width}%`,
                        backgroundColor: AGENT_STATE_COLOR[span.state] ?? lane.color,
                        opacity:
                          playheadAt != null &&
                          playheadAt >= span.at &&
                          playheadAt < span.at + span.durationMs
                            ? 1
                            : 0.7,
                      }}
                      title={`${span.state} · ${(span.durationMs / 1000).toFixed(2)}s`}
                    />
                  ))}

                {/* Point markers */}
                {laneEvents.map((e) => {
                  if (lane.key === "agent" && e.name === "agent.state") return null;
                  const left = ((e.at - model.start) / model.span) * 100;
                  const active =
                    playheadAt != null &&
                    Math.abs(e.at - playheadAt) <= TIMELINE_ACTIVE_WINDOW_MS;
                  return (
                    <div
                      key={e.id}
                      className={cn(
                        "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 transition-transform",
                        active ? "size-3 ring-2 ring-foreground" : "size-2",
                        !active && e.level === "error"
                          ? "ring-destructive"
                          : !active && e.level === "warn"
                            ? "ring-yellow-500"
                            : !active && "ring-background"
                      )}
                      style={{
                        left: `${left}%`,
                        backgroundColor:
                          e.level === "error"
                            ? "#ef4444"
                            : e.level === "warn"
                              ? "#eab308"
                              : lane.color,
                      }}
                      title={`${new Date(e.at).toLocaleTimeString("en-US", { hour12: false })} ${e.name}\n${e.detail}`}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* "Now" edge — makes it obvious the axis is still advancing. */}
          {live && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-px animate-pulse bg-emerald-500/70" />
          )}

          {/* Playhead */}
          {playheadPct !== null && (
            // Pointer events stay off so the press lands on the plot underneath
            // — grabbing the line itself is just a scrub that starts on it.
            <div
              className={cn(
                "pointer-events-none absolute inset-y-0 z-10 bg-red-500",
                scrubbing ? "w-0.5" : "w-px"
              )}
              style={{ left: `${playheadPct}%` }}
            >
              <div
                className={cn(
                  "absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-red-500 transition-transform",
                  scrubbing ? "size-3 ring-2 ring-red-500/30" : "size-2"
                )}
              />
            </div>
          )}
        </div>
      </div>

      {/* Agent state legend — the only lane where colour carries meaning */}
      {model.spans.length > 0 && (
        <div className="ml-[112px] flex flex-wrap items-center gap-3 pt-2 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
          {Array.from(new Set(model.spans.map((s) => s.state))).map((state) => (
            <span key={state} className="flex items-center gap-1">
              <span
                className="size-2 rounded-sm"
                style={{ backgroundColor: AGENT_STATE_COLOR[state] ?? "#94a3b8" }}
              />
              {state}
            </span>
          ))}
          {onSeek && <span className="text-muted-foreground/70">· click or drag to seek</span>}
          {live && <span className="text-muted-foreground/70">· live</span>}
        </div>
      )}
    </div>
  );
}
