"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  METRIC_KIND_LABEL,
  METRIC_KIND_TITLE,
  formatClock,
  formatSeconds,
  metricLaneKey,
  metricWindows,
  metricRowCells,
  metricSpeakerLabel,
  type ConsoleMetric,
  type MetricKind,
  type MetricWindow,
} from "@/lib/console-metrics";
import { AGENT_STATE_COLOR } from "./event-timeline";
import {
  TIMELINE_ACTIVE_WINDOW_MS,
  TimelineAxis,
  TimelinePlayhead,
  TimelineZoomControls,
  buildTicks,
  useTimelineScrub,
  useTimelineView,
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
  // Runs on the audio path before anything recognises it.
  "nc",
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
  nc: "#22d3ee",
  unknown: "#64748b",
};

/** `#rrggbb` + alpha, so a bar can dim without dimming what is drawn inside it. */
function alpha(hex: string, a: number): string {
  return `${hex}${Math.round(a * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/**
 * Where every metric belongs on a wall-clock axis lives in `console-metrics.ts`,
 * with the rest of the placement rules — the metric rows and the transcript
 * highlight read the same windows, so none of the three can drift. Re-exported
 * here because this is where callers have always imported it from.
 */
export { metricWindows, type MetricWindow };

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

function tooltipOf(m: ConsoleMetric, window: MetricWindow): string {
  const { from, to } = window;
  const cells = metricRowCells(m);
  const who = metricSpeakerLabel(m);
  return [
    `${METRIC_KIND_LABEL[m.kind]}${who ? ` · ${who}` : ""} · ${m.label}`,
    `${formatClock(from)} → ${formatClock(to)}`,
    cells.latency !== "—" ? `${cells.latencyLabel} ${cells.latency}` : null,
    m.kind === "tts" && m.audioDuration !== undefined
      ? `speaks ${formatSeconds(m.audioDuration)}`
      : null,
    // Where the bar sits versus where the speech in it sits.
    m.kind === "stt" && window.speech
      ? `speech ${formatClock(window.speech.from)} → ${formatClock(window.speech.to)}`
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

  /** The whole session — the window when fully zoomed out. */
  const full = grouped && {
    start: Math.min(grouped.first, audioWindow?.start ?? grouped.first),
    end: Math.max(
      grouped.last + 500,
      audioWindow?.end ?? 0,
      live ? now : 0,
      Math.min(grouped.first, audioWindow?.start ?? grouped.first) + 1000
    ),
  };

  // Hooks run before the early return, so both take a placeholder window until
  // there is something to plot.
  const view = useTimelineView({
    plotRef,
    start: full ? full.start : 0,
    end: full ? full.end : 1,
    playheadAt,
    live,
  });
  const model = full && {
    ...view,
    ticks: buildTicks(view.span, 6, view.offset),
  };

  // The agent's states become spans between transitions, the last running to
  // the edge of the session — not of the visible window: zooming clips a span,
  // it does not shorten it.
  const sessionEnd = full ? full.end : 0;
  const stateSpans = useMemo(() => {
    if (!agentStates || agentStates.length === 0 || !sessionEnd) return [];
    return agentStates.map((point, i) => {
      const next = agentStates[i + 1];
      return { ...point, until: next ? next.at : sessionEnd };
    });
  }, [agentStates, sessionEnd]);

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

  /** Zoomed in, most of the session is off-window; drawing it would pile slivers
      against the edges. */
  const visible = (from: number, to: number) => to >= model.start && from <= model.end;

  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <TimelineZoomControls view={view} className="mb-1.5 justify-end" />
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
                if (!visible(span.at, span.until)) return null;
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
                  if (!visible(window.from, window.to)) return null;
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
                  // The block is the work itself; a trailing wait — the
                  // recogniser answering after the audio stopped — is drawn as a
                  // thin tail, so the bar still ends where the speech ended and
                  // the gap before the turn detector is accounted for.
                  const blockTo = window.waitFrom ?? window.to;
                  const { left, width } = barOf(window.from, blockTo);
                  const tail =
                    window.waitFrom !== undefined && window.to > window.waitFrom
                      ? barOf(window.waitFrom, window.to)
                      : null;
                  // The bar carries the tooltip, so the wait is drawn inside it
                  // — and tinted with alpha rather than opacity, which a child
                  // would inherit and cancel out.
                  const solidPct =
                    window.solidTo !== undefined && blockTo > window.from
                      ? Math.max(
                          2,
                          Math.min(
                            100,
                            ((window.solidTo - window.from) / (blockTo - window.from)) * 100
                          )
                        )
                      : null;

                  const speechPct =
                    window.speech && blockTo > window.from
                      ? {
                          left:
                            ((window.speech.from - window.from) / (blockTo - window.from)) * 100,
                          width: Math.max(
                            2,
                            ((window.speech.to - window.speech.from) / (blockTo - window.from)) *
                              100
                          ),
                        }
                      : null;

                  return (
                    <Fragment key={m.id}>
                    <div
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
                      {/* The audible part of an utterance. What sticks out either
                          side of it is padding the VAD added and the recogniser
                          was billed for — the reason a segment reads longer than
                          it sounds. */}
                      {speechPct && (
                        <div
                          className="absolute inset-y-0 rounded-sm"
                          style={{
                            left: `${speechPct.left}%`,
                            width: `${speechPct.width}%`,
                            backgroundColor: alpha(color, active ? 1 : 0.85),
                          }}
                        />
                      )}
                    </div>
                    {tail && (
                      <div
                        className="absolute top-1/2 h-px -translate-y-1/2"
                        style={{
                          left: `${tail.left}%`,
                          width: `${tail.width}%`,
                          backgroundColor: alpha(color, active ? 0.9 : 0.55),
                        }}
                        title={title}
                      />
                    )}
                    </Fragment>
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
        <span className="text-muted-foreground/70">
          · STT: solid = speech, faint = vad padding, tail = waiting for the transcript
        </span>
        {/* Only when the lane is actually drawn — it is off by default, and a
            legend for a lane that isn't there is noise. */}
        {lanes.some((lane) => lane.kind === "nc") && (
          <span className="text-muted-foreground/70">
            · NC: bar = a window of audio, solid = the compute the filter spent on it
          </span>
        )}
        {onSeek && <span className="text-muted-foreground/70">· click or drag to seek</span>}
        {live && <span className="text-muted-foreground/70">· live</span>}
      </div>
    </div>
  );
}
