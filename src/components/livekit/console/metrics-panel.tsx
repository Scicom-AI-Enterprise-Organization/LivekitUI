"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  CONSOLE_METRICS_TOPIC,
  METRIC_KIND_LABEL,
  METRIC_KIND_TITLE,
  aggregateUsage,
  buildTurnTraces,
  formatClock,
  formatCount,
  formatSeconds,
  metricRowCells,
  percentile,
  type ConsoleMetric,
  type MetricKind,
} from "@/lib/console-metrics";
import { MetricsTimeline, metricWindows } from "./metrics-timeline";
import { DockEmpty, StatTile } from "./session-primitives";
import { TIMELINE_ACTIVE_WINDOW_MS } from "./timeline-plot";
import { TimelineTransport, type TimelineAudio } from "./timeline-audio";
import type { AgentConfigView, ConsoleEvent, SavedRecording } from "./session-types";

/** Rendered at once; VAD alone can produce thousands of rows in a few minutes. */
const METRIC_ROW_LIMIT = 300;

/**
 * Latency summary, per-turn tracing, the time-aligned metrics timeline and the
 * raw metric rows.
 *
 * Everything here is read against the same recording the Events tab plays: the
 * transport at the top is the console's one player, so a turn that looks slow
 * on the timeline can be listened to without changing tabs.
 */
export function MetricsPanel({
  metrics,
  events,
  live,
  emptyHint,
  timelineOn,
  onTimelineToggle,
  recordings,
  dockHeight,
  audio,
  transportEmptyLabel,
}: {
  metrics: ConsoleMetric[];
  /** Only `agent.state` is read, for the timeline's reference lane. */
  events?: ConsoleEvent[];
  live?: boolean;
  emptyHint?: React.ReactNode;
  timelineOn: boolean;
  onTimelineToggle: (on: boolean) => void;
  recordings: SavedRecording[];
  dockHeight: number;
  audio: TimelineAudio;
  transportEmptyLabel?: string;
}) {
  // VAD is off by default: it fires twice a second and says nothing about a turn.
  const [hidden, setHidden] = useState<MetricKind[]>(["vad"]);

  const traces = useMemo(() => buildTurnTraces(metrics), [metrics]);

  const presentKinds = useMemo(() => {
    const counts = new Map<MetricKind, number>();
    for (const m of metrics) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
    return counts;
  }, [metrics]);

  const shown = useMemo(
    () => metrics.filter((m) => !hidden.includes(m.kind)),
    [metrics, hidden]
  );

  // Rows are placed on the same wall-clock windows as the bars, so clicking one
  // plays the same moment the bar covers.
  const windows = useMemo(() => metricWindows(shown), [shown]);

  // The room's own account of when the agent was listening / thinking /
  // speaking. Nothing here is derived from it — it is the reference the metric
  // lanes are read against, since it lines up with the recording by definition.
  const agentStates = useMemo(
    () =>
      (events ?? [])
        .filter((e) => e.name === "agent.state")
        .map((e) => ({ id: e.id, at: e.at, state: e.detail })),
    [events]
  );

  const ttfts = metrics
    .filter((m) => (m.kind === "llm" || m.kind === "realtime") && m.ttft !== undefined)
    .map((m) => m.ttft!);
  const ttfbs = metrics.filter((m) => m.kind === "tts" && m.ttfb !== undefined).map((m) => m.ttfb!);
  const totals = traces.map((t) => t.total).filter((t) => t > 0);
  // The turn detector's own inference time, else the session's EOU delay.
  const turnDelays = metrics
    .filter((m) => m.kind === "eot" && m.detectionDelay !== undefined)
    .map((m) => m.detectionDelay!);
  const eouDelays = metrics
    .filter((m) => m.kind === "eou" && m.endOfUtteranceDelay !== undefined)
    .map((m) => m.endOfUtteranceDelay!);

  if (metrics.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
          No metrics received yet
        </span>
        <p className="max-w-lg text-xs text-muted-foreground">
          {emptyHint ?? (
            <>
              Metrics arrive on the <code className="font-mono">{CONSOLE_METRICS_TOPIC}</code> room
              topic. An agent deployed before console metrics existed does not publish them — open
              it in the Builder and deploy again.
              {live ? " Speak to the agent to produce the first turn." : ""}
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    // Two panes, like the Events tab: the transport and timeline stay put while
    // the summary and the rows scroll under them.
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b bg-background px-4 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {timelineOn && (
            <TimelineTransport
              audio={audio}
              live={live}
              recordings={recordings}
              emptyLabel={transportEmptyLabel}
            />
          )}
          <div className="ml-auto flex items-center gap-2">
            <Label
              htmlFor="metrics-timeline"
              className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              Timeline
            </Label>
            <Switch
              id="metrics-timeline"
              checked={timelineOn}
              onCheckedChange={onTimelineToggle}
            />
          </div>
        </div>

        {timelineOn && (
          // Half the dock to the timeline, half to the rows — the same split the
          // Events tab uses, so dragging the dock taller grows both.
          <div
            className="mt-1.5 overflow-y-auto"
            style={{ maxHeight: Math.max(60, Math.round((dockHeight - 34) * 0.5)) }}
          >
            <MetricsTimeline
              metrics={shown}
              agentStates={agentStates}
              live={live}
              audioWindow={audio.window}
              playheadAt={audio.playheadAt}
              onSeek={audio.selected ? audio.seekTo : undefined}
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="LLM TTFT p50" value={formatSeconds(percentile(ttfts, 50))} />
          <StatTile label="LLM TTFT p90" value={formatSeconds(percentile(ttfts, 90))} />
          <StatTile label="TTS TTFB p50" value={formatSeconds(percentile(ttfbs, 50))} />
          <StatTile
            label={turnDelays.length > 0 ? "Turn detect p50" : "EOU delay p50"}
            value={formatSeconds(percentile(turnDelays.length > 0 ? turnDelays : eouDelays, 50))}
          />
          <StatTile label="Turn latency p90" value={formatSeconds(percentile(totals, 90))} />
        </div>

        {/* Tracing */}
        {traces.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-3 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
              <span>Turn latency</span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-sky-500" /> EOU
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-violet-500" /> LLM TTFT
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-amber-500" /> TTS TTFB
              </span>
            </div>
            <div className="space-y-1.5">
              {traces.map((t) => {
                const scale = Math.max(...traces.map((x) => x.total), 0.001);
                const pct = (v?: number) => ((v ?? 0) / scale) * 100;
                return (
                  <div key={t.speechId} className="flex items-center gap-3">
                    <span
                      className="w-[92px] shrink-0 truncate font-mono text-xs text-muted-foreground"
                      title={t.speechId}
                    >
                      {t.speechId.slice(0, 12)}
                    </span>
                    <div className="flex h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
                      <div
                        className="bg-sky-500"
                        style={{ width: `${pct(t.eou)}%` }}
                        title={`EOU ${formatSeconds(t.eou)}`}
                      />
                      <div
                        className="bg-violet-500"
                        style={{ width: `${pct(t.ttft)}%` }}
                        title={`TTFT ${formatSeconds(t.ttft)}`}
                      />
                      <div
                        className="bg-amber-500"
                        style={{ width: `${pct(t.ttfb)}%` }}
                        title={`TTFB ${formatSeconds(t.ttfb)}`}
                      />
                    </div>
                    <span className="w-[72px] shrink-0 text-right font-mono text-xs text-foreground/80">
                      {formatSeconds(t.total)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Type filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            Show
          </span>
          {Array.from(presentKinds.entries()).map(([kind, count]) => {
            const on = !hidden.includes(kind);
            return (
              <button
                key={kind}
                onClick={() =>
                  setHidden((prev) =>
                    prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]
                  )
                }
                title={METRIC_KIND_TITLE[kind]}
                className={cn(
                  "rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors",
                  on
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground line-through"
                )}
              >
                {METRIC_KIND_LABEL[kind]} {count}
              </button>
            );
          })}
        </div>

        {/* Raw rows */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left font-mono uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Time</th>
                <th className="px-2 py-1.5 font-medium">Type</th>
                <th className="px-2 py-1.5 font-medium">Label</th>
                <th className="px-2 py-1.5 font-medium">Latency</th>
                <th className="px-2 py-1.5 font-medium">Duration</th>
                <th className="px-2 py-1.5 font-medium">Audio</th>
                <th className="px-2 py-1.5 font-medium">Tokens</th>
                <th className="px-2 py-1.5 font-medium">TPS</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {shown
                .slice(-METRIC_ROW_LIMIT)
                .reverse()
                .map((m) => {
                  const cells = metricRowCells(m);
                  // A row covers the same window its bar does, so the table and
                  // the timeline light up together.
                  const { from, to } = windows.get(m.id) ?? { from: m.at, to: m.at };
                  const active =
                    audio.playheadAt != null &&
                    audio.playheadAt >= from - TIMELINE_ACTIVE_WINDOW_MS &&
                    audio.playheadAt <= to + TIMELINE_ACTIVE_WINDOW_MS;
                  const seekable = audio.canSeekTo(from);
                  return (
                    <tr
                      key={m.id}
                      onClick={seekable ? () => audio.seekTo(from) : undefined}
                      className={cn(
                        "border-b last:border-0",
                        active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/40",
                        seekable && "cursor-pointer"
                      )}
                      title={
                        seekable
                          ? [cells.detail, "Play the recording from here"]
                              .filter(Boolean)
                              .join(" · ")
                          : cells.detail || undefined
                      }
                    >
                      <td className="px-2 py-1.5 text-muted-foreground">{formatClock(m.at)}</td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {METRIC_KIND_LABEL[m.kind]}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-foreground/70">{m.label}</td>
                      <td className="px-2 py-1.5 text-foreground/80" title={cells.latencyLabel}>
                        {cells.latency}
                      </td>
                      <td className="px-2 py-1.5 text-foreground/70">{cells.duration}</td>
                      <td className="px-2 py-1.5 text-foreground/70">{cells.audio}</td>
                      <td className="px-2 py-1.5 text-foreground/70">{cells.tokens}</td>
                      <td className="px-2 py-1.5 text-foreground/70">{cells.tps}</td>
                    </tr>
                  );
                })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                    Every metric type is hidden — turn one back on above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {shown.length > METRIC_ROW_LIMIT && (
            <p className="px-2 py-2 text-[10px] font-mono text-muted-foreground">
              showing the latest {METRIC_ROW_LIMIT} of {shown.length} rows
              {hidden.length > 0 ? ` · ${metrics.length - shown.length} hidden by filter` : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Token, character and audio usage rolled up per model. */
export function ModelsPanel({
  metrics,
  config,
}: {
  metrics: ConsoleMetric[];
  config: AgentConfigView | null;
}) {
  const usage = useMemo(() => aggregateUsage(metrics), [metrics]);

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatTile label="Configured LLM" value={config?.llmModel ?? "—"} />
        <StatTile label="Configured TTS" value={config?.ttsModel ?? "—"} />
        <StatTile label="Configured STT" value={config?.sttModel ?? "—"} />
      </div>

      {usage.length === 0 ? (
        <DockEmpty>No usage metrics received yet</DockEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left font-mono uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Type</th>
                <th className="px-2 py-1.5 font-medium">Label</th>
                <th className="px-2 py-1.5 font-medium">Requests</th>
                <th className="px-2 py-1.5 font-medium">Prompt</th>
                <th className="px-2 py-1.5 font-medium">Completion</th>
                <th className="px-2 py-1.5 font-medium">Total tokens</th>
                <th className="px-2 py-1.5 font-medium">Audio</th>
                <th className="px-2 py-1.5 font-medium">Chars</th>
                <th className="px-2 py-1.5 font-medium">Avg latency</th>
                <th className="px-2 py-1.5 font-medium">Avg TPS</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {usage.map((u) => (
                <tr key={`${u.kind}:${u.label}`} className="border-b last:border-0">
                  <td className="px-2 py-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {METRIC_KIND_LABEL[u.kind]}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5 text-foreground/70">{u.label}</td>
                  <td className="px-2 py-1.5 text-foreground/80">{u.requests}</td>
                  <td className="px-2 py-1.5 text-foreground/70">{formatCount(u.promptTokens)}</td>
                  <td className="px-2 py-1.5 text-foreground/70">
                    {formatCount(u.completionTokens)}
                  </td>
                  <td className="px-2 py-1.5 text-foreground/70">{formatCount(u.totalTokens)}</td>
                  <td className="px-2 py-1.5 text-foreground/70">{formatSeconds(u.audioSeconds)}</td>
                  <td className="px-2 py-1.5 text-foreground/70">{formatCount(u.characters)}</td>
                  <td className="px-2 py-1.5 text-foreground/70">{formatSeconds(u.avgLatency)}</td>
                  <td className="px-2 py-1.5 text-foreground/70">
                    {u.avgTokensPerSecond !== undefined ? u.avgTokensPerSecond.toFixed(1) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
