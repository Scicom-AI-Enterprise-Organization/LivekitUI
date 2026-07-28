"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  METRIC_KIND_LABEL,
  METRIC_KIND_TITLE,
  formatClock,
  formatSeconds,
  metricLaneKey,
  metricRowCells,
  metricSpeakerLabel,
  type ConsoleMetric,
  type MetricKind,
} from "@/lib/console-metrics";
import { AGENT_STATE_COLOR } from "./event-timeline";
import {
  TIMELINE_ACTIVE_WINDOW_MS,
  TimelineAxis,
  TimelinePlayhead,
  buildTicks,
  useTimelineScrub,
} from "./timeline-plot";

/**
 * The metrics timeline: the same wall-clock plot the Events tab draws, with a
 * lane per metric kind instead of a lane per event category.
 *
 * Every bar is placed by **when it happened**, not by when it was reported,
 * which is the only way the lanes line up with the recording — see
 * `metricWindow` for what each kind covers. It shares the recording playhead
 * with the event log and the transcript, so clicking a slow turn plays that
 * moment of the call.
 */

/** Lanes read top-to-bottom in the order a turn happens. */
const LANE_ORDER: MetricKind[] = [
  "eou",
  "eot",
  "stt",
  "llm",
  "realtime",
  "tts",
  "interrupt",
  "vad",
  "unknown",
];

/** Matches the turn-latency legend below: EOU sky, LLM violet, TTS amber. */
const KIND_COLOR: Record<MetricKind, string> = {
  eou: "#38bdf8",
  eot: "#e879f9",
  stt: "#2dd4bf",
  llm: "#a78bfa",
  realtime: "#818cf8",
  tts: "#f59e0b",
  interrupt: "#fb7185",
  vad: "#94a3b8",
  unknown: "#64748b",
};

/** `#rrggbb` + alpha, so a bar can dim without dimming what is drawn inside it. */
function alpha(hex: string, a: number): string {
  return `${hex}${Math.round(a * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/** Metric fields are seconds; the plot is in milliseconds. */
const ms = (value?: number) => (value ?? 0) * 1000;

/**
 * One row of the plot: a metric kind, and — for a session that measured more
 * than one person, which in practice means an agent-assist call — the speaker it
 * belongs to.
 */
interface Lane {
  key: string;
  kind: MetricKind;
  /** Empty for a single-speaker session. */
  speaker: string;
  items: { metric: ConsoleMetric; window: MetricWindow }[];
}

export interface MetricWindow {
  /** Wall-clock instant the work started. */
  from: number;
  /** Wall-clock instant it finished — for TTS, when the speech stopped. */
  to: number;
  /** End of the part that was pure waiting (TTFT, TTFB, EOU delay). */
  solidTo?: number;
}

/**
 * What one metric covers in wall-clock time, read from its own fields.
 *
 * A metric is *reported* after the work it measures, so a bar runs back from
 * its timestamp over its duration. `metricWindows` refines the two kinds where
 * that isn't the whole story.
 */
function baseWindow(m: ConsoleMetric): MetricWindow {
  switch (m.kind) {
    case "llm":
    case "realtime": {
      // Compute, not audio: the reply was being generated up to the report.
      const from = m.at - ms(m.duration ?? m.ttft);
      return {
        from,
        to: m.at,
        solidTo: m.ttft !== undefined ? from + ms(m.ttft) : undefined,
      };
    }
    case "tts": {
      const requested = m.at - ms(m.duration);
      const speaks = requested + ms(m.ttfb);
      return {
        from: requested,
        // Falls back to the report instant when the plugin gives no audio
        // length; never shorter than the synthesis it measured.
        to: Math.max(speaks + ms(m.audioDuration), m.at),
        solidTo: m.ttfb !== undefined ? speaks : undefined,
      };
    }
    case "stt":
      // The user's speech, not the recogniser's compute: `audio_duration` is
      // how much audio this final segment covered.
      return { from: m.at - ms(m.audioDuration ?? m.duration), to: m.at };
    case "eou": {
      const from = m.at - ms(m.endOfUtteranceDelay);
      return {
        from,
        to: m.at,
        solidTo: m.transcriptionDelay !== undefined ? from + ms(m.transcriptionDelay) : undefined,
      };
    }
    case "eot": {
      const from = m.at - ms(m.totalDuration ?? m.predictionDuration ?? m.detectionDelay);
      return {
        from,
        to: m.at,
        solidTo: m.detectionDelay !== undefined ? from + ms(m.detectionDelay) : undefined,
      };
    }
    case "interrupt": {
      const from = m.at - ms(m.predictionDuration ?? m.detectionDelay);
      return {
        from,
        to: m.at,
        solidTo: m.detectionDelay !== undefined ? from + ms(m.detectionDelay) : undefined,
      };
    }
    default:
      return { from: m.at - ms(m.duration), to: m.at };
  }
}

/**
 * Where every metric belongs on a wall-clock axis, keyed by metric id.
 *
 * Two things need the whole list rather than one metric:
 *
 * - **TTS is heard, not computed.** Synthesis finishes long before the audio it
 *   produced has finished playing, so a TTS bar runs from the request, through
 *   the wait, and on over `audio_duration` — past the instant the metric
 *   arrived. And a reply split into sentences is *heard back to back*: the
 *   second chunk starts when the first stops playing, not when its own
 *   synthesis returned, which is usually while the first is still being spoken.
 *   Chaining them is what stops one reply drawing as a pile of overlapping bars
 *   and makes the lane match what the recording plays.
 * - **STT segments must not overlap.** Each reaches back over the audio it
 *   transcribed, and consecutive finals would otherwise cover the same speech
 *   twice.
 */
export function metricWindows(metrics: ConsoleMetric[]): Map<string, MetricWindow> {
  const windows = new Map<string, MetricWindow>();
  for (const m of metrics) windows.set(m.id, baseWindow(m));

  // Playout is serial per reply. Keyed on the turn, with one shared bucket for
  // plugins that report no speech id — `Math.max` means an unrelated later turn
  // is never dragged forward by an earlier one.
  const speechEnd = new Map<string, number>();
  for (const m of [...metrics].sort((a, b) => a.at - b.at)) {
    if (m.kind !== "tts" || m.audioDuration === undefined) continue;
    const base = windows.get(m.id)!;
    const key = m.speechId ?? "";
    const readyAt = base.solidTo ?? base.from;
    const previousEnd = speechEnd.get(key);
    const speaks = previousEnd !== undefined ? Math.max(readyAt, previousEnd) : readyAt;
    const to = speaks + ms(m.audioDuration);
    windows.set(m.id, {
      // A chunk that waited on the one before it was not slow — its TTFB
      // elapsed while the agent was still speaking, so it shows no wait.
      from: previousEnd !== undefined && speaks > readyAt ? speaks : base.from,
      to,
      solidTo: previousEnd !== undefined && speaks > readyAt ? undefined : base.solidTo,
    });
    speechEnd.set(key, to);
  }

  let sttEnd: number | null = null;
  for (const m of [...metrics].sort((a, b) => a.at - b.at)) {
    if (m.kind !== "stt") continue;
    const base = windows.get(m.id)!;
    const from = sttEnd !== null ? Math.max(base.from, sttEnd) : base.from;
    windows.set(m.id, { ...base, from: Math.min(from, base.to) });
    sttEnd = base.to;
  }

  return windows;
}

function tooltipOf(m: ConsoleMetric, { from, to }: MetricWindow): string {
  const cells = metricRowCells(m);
  const who = metricSpeakerLabel(m);
  return [
    `${METRIC_KIND_LABEL[m.kind]}${who ? ` · ${who}` : ""} · ${m.label}`,
    `${formatClock(from)} → ${formatClock(to)}`,
    cells.latency !== "—" ? `${cells.latencyLabel} ${cells.latency}` : null,
    m.kind === "tts" && m.audioDuration !== undefined
      ? `speaks ${formatSeconds(m.audioDuration)}`
      : null,
    m.speechId ? `turn ${m.speechId}` : null,
    cells.detail || null,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface AgentStatePoint {
  id: string;
  at: number;
  state: string;
}

export function MetricsTimeline({
  metrics,
  agentStates,
  live,
  className,
  audioWindow,
  playheadAt,
  onSeek,
}: {
  metrics: ConsoleMetric[];
  /**
   * `agent.state` transitions from the event log. The agent's own account of
   * when it was listening, thinking and speaking — ground truth for reading the
   * metric lanes against the recording.
   */
  agentStates?: AgentStatePoint[];
  /** While live the axis extends to now, so the plot keeps advancing. */
  live?: boolean;
  className?: string;
  /** Recording span, so the axis covers audio that runs past the last metric. */
  audioWindow?: { start: number; end: number } | null;
  /** Wall-clock instant of the audio playhead. */
  playheadAt?: number | null;
  /** Called with the wall-clock instant clicked in the plot. */
  onSeek?: (at: number) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);

  // Same reason as the event timeline: while the session is live the axis has
  // to follow the clock, or nothing moves between metrics.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [live]);

  // Bucketing only depends on the metrics, so it survives every clock tick.
  const grouped = useMemo(() => {
    if (metrics.length === 0) return null;

    const windows = metricWindows(metrics);
    const byLane = new Map<string, Lane>();
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;

    for (const metric of metrics) {
      const window = windows.get(metric.id) ?? { from: metric.at, to: metric.at };
      const key = metricLaneKey(metric);
      let lane = byLane.get(key);
      if (!lane) {
        lane = { key, kind: metric.kind, speaker: metricSpeakerLabel(metric), items: [] };
        byLane.set(key, lane);
      }
      lane.items.push({ metric, window });
      first = Math.min(first, window.from);
      last = Math.max(last, window.to);
    }

    // Kinds top-to-bottom in the order a turn happens. Within a kind, one lane
    // per speaker in the order they first spoke — a stable sort, so the Map's
    // insertion order carries that through.
    const lanes = [...byLane.values()].sort(
      (a, b) => LANE_ORDER.indexOf(a.kind) - LANE_ORDER.indexOf(b.kind)
    );

    return { first, last, lanes };
  }, [metrics]);

  const model =
    grouped &&
    (() => {
      const start = Math.min(grouped.first, audioWindow?.start ?? grouped.first);
      const end = Math.max(
        grouped.last + 500,
        audioWindow?.end ?? 0,
        live ? now : 0,
        start + 1000
      );
      const span = end - start;
      return { start, end, span, ticks: buildTicks(span) };
    })();

  // The agent's states become spans between transitions, the last running to
  // the edge of the plot — the same treatment the Events tab gives them.
  const stateSpans = useMemo(() => {
    if (!agentStates || agentStates.length === 0 || !model) return [];
    return agentStates.map((point, i) => {
      const next = agentStates[i + 1];
      return { ...point, until: next ? next.at : model.end };
    });
  }, [agentStates, model]);

  // Hooks run before the early return, so the window is a placeholder until
  // there is something to plot.
  const { scrubbing, onPointerDown, cursorClass } = useTimelineScrub({
    plotRef,
    start: model ? model.start : 0,
    span: model ? model.span : 1,
    onSeek,
  });

  if (!model || !grouped) return null;

  const lanes = grouped.lanes;

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

  const pctOf = (at: number) => ((at - model.start) / model.span) * 100;

  /** Clamped to the plot, so a span starting before the window still shows. */
  const barOf = (from: number, to: number) => {
    const left = Math.max(0, pctOf(from));
    const right = Math.min(100, pctOf(to));
    return { left, width: Math.max(0.4, right - left) };
  };

  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <div className="flex gap-2">
        {/* Lane labels — same width as the event timeline so the two line up */}
        <div className="w-[104px] shrink-0 space-y-1.5">
          <div className="h-4" />
          {stateSpans.length > 0 && (
            <div
              title="What the agent said it was doing — the reference the metric lanes are read against"
              className="flex h-5 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              <span className="size-2 shrink-0 rounded-sm bg-muted-foreground/40" />
              <span className="truncate">Agent</span>
            </div>
          )}
          {lanes.map((lane) => (
            <div
              key={lane.key}
              title={
                lane.speaker
                  ? `${METRIC_KIND_TITLE[lane.kind]} · ${lane.speaker}`
                  : METRIC_KIND_TITLE[lane.kind]
              }
              className="flex h-5 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: KIND_COLOR[lane.kind] }}
              />
              <span className="shrink-0">{METRIC_KIND_LABEL[lane.kind]}</span>
              {/* Truncates before the kind does: which measurement this is
                  matters more than whose it was, and the title has both. */}
              {lane.speaker && (
                <span className="truncate text-muted-foreground/70 normal-case">
                  {lane.speaker}
                </span>
              )}
              <span className="ml-auto shrink-0 text-muted-foreground/60">{lane.items.length}</span>
            </div>
          ))}
        </div>

        {/* Plot */}
        <div
          ref={plotRef}
          className={cn("relative min-w-0 flex-1 space-y-1.5 touch-none", cursorClass)}
          onPointerDown={onPointerDown}
        >
          <TimelineAxis ticks={model.ticks} />

          {/* Agent state, as reported by the room itself */}
          {stateSpans.length > 0 && (
            <div className="relative h-5 rounded bg-muted/50">
              {stateSpans.map((span) => {
                const { left, width } = barOf(span.at, span.until);
                const color = AGENT_STATE_COLOR[span.state] ?? "#94a3b8";
                const active =
                  playheadAt != null && playheadAt >= span.at && playheadAt < span.until;
                return (
                  <div
                    key={span.id}
                    className="absolute inset-y-0.5 rounded-sm"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: alpha(color, active ? 1 : 0.6),
                    }}
                    title={`${span.state} · ${((span.until - span.at) / 1000).toFixed(2)}s`}
                  />
                );
              })}
            </div>
          )}

          {lanes.map((lane) => {
            const laneMetrics = lane.items;
            const color = KIND_COLOR[lane.kind];

            return (
              <div key={lane.key} className="relative h-5 rounded bg-muted/50">
                {/* Recorded span, so it is obvious what the audio covers */}
                {audioPct && (
                  <div
                    className="absolute inset-y-0 rounded bg-foreground/5"
                    style={{ left: `${audioPct.left}%`, width: `${audioPct.width}%` }}
                  />
                )}

                {laneMetrics.map(({ metric: m, window }) => {
                  const title = tooltipOf(m, window);

                  // A metric with no duration (VAD, an empty payload) is an
                  // instant, and reads better as a dot than a hairline bar.
                  if (window.to - window.from < 1) {
                    const active =
                      playheadAt != null &&
                      Math.abs(m.at - playheadAt) <= TIMELINE_ACTIVE_WINDOW_MS;
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 transition-transform",
                          active ? "size-3 ring-2 ring-foreground" : "size-2 ring-background"
                        )}
                        style={{ left: `${pctOf(m.at)}%`, backgroundColor: color }}
                        title={title}
                      />
                    );
                  }

                  const active =
                    playheadAt != null &&
                    playheadAt >= window.from - TIMELINE_ACTIVE_WINDOW_MS &&
                    playheadAt <= window.to + TIMELINE_ACTIVE_WINDOW_MS;
                  const { left, width } = barOf(window.from, window.to);
                  // The bar carries the tooltip, so the wait is drawn inside it
                  // — and tinted with alpha rather than opacity, which a child
                  // would inherit and cancel out.
                  const solidPct =
                    window.solidTo !== undefined && window.to > window.from
                      ? Math.max(
                          2,
                          Math.min(
                            100,
                            ((window.solidTo - window.from) / (window.to - window.from)) * 100
                          )
                        )
                      : null;

                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "absolute inset-y-0.5 rounded-sm",
                        m.cancelled && "outline-1 outline-dashed outline-destructive"
                      )}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: alpha(color, active ? 0.55 : 0.3),
                      }}
                      title={title}
                    >
                      {/* The part the user waited through */}
                      {solidPct !== null && (
                        <div
                          className="absolute inset-y-0 left-0 rounded-l-sm"
                          style={{
                            width: `${solidPct}%`,
                            backgroundColor: alpha(color, active ? 1 : 0.85),
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* "Now" edge — makes it obvious the axis is still advancing. */}
          {live && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-px animate-pulse bg-emerald-500/70" />
          )}

          {playheadPct !== null && <TimelinePlayhead pct={playheadPct} scrubbing={scrubbing} />}
        </div>
      </div>

      <div className="ml-[112px] flex flex-wrap items-center gap-3 pt-2 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
        <span>solid head = the wait (TTFT / TTFB / EOU)</span>
        <span className="text-muted-foreground/70">· TTS runs over the speech it played</span>
        {onSeek && <span className="text-muted-foreground/70">· click or drag to seek</span>}
        {live && <span className="text-muted-foreground/70">· live</span>}
      </div>
    </div>
  );
}
