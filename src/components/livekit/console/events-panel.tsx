"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/console-metrics";
import { EventTimeline } from "./event-timeline";
import { TIMELINE_ACTIVE_WINDOW_MS } from "./timeline-plot";
import { DockEmpty } from "./session-primitives";
import { TimelineTransport, type TimelineAudio } from "./timeline-audio";
import type { ConsoleEvent, SavedRecording, TranscriptLine } from "./session-types";

/** One line of the log: something that happened, or something that was said. */
type LogRow =
  | { kind: "event"; id: string; at: number; event: ConsoleEvent }
  | { kind: "speech"; id: string; at: number; line: TranscriptLine };

/**
 * The event log, the tracing timeline and what was said, sharing one playhead.
 *
 * An event only means something next to the speech around it, so utterances are
 * interleaved into the log on their own timestamps rather than shown alongside
 * it: reading straight down gives "user said X → EOU → thinking → agent said Y"
 * in the order it happened. The audio player is passed in rather than created
 * here — the console and the replay view each own one, so it survives switching
 * tabs and can drive other panels at the same time.
 */
export function EventsPanel({
  events,
  transcript,
  live,
  timelineOn,
  onTimelineToggle,
  transcriptOn,
  onTranscriptToggle,
  recordings,
  dockHeight,
  audio,
  emptyMessage = "No events received yet",
  transportEmptyLabel,
}: {
  events: ConsoleEvent[];
  transcript: TranscriptLine[];
  live?: boolean;
  timelineOn: boolean;
  onTimelineToggle: (on: boolean) => void;
  transcriptOn: boolean;
  onTranscriptToggle: (on: boolean) => void;
  recordings: SavedRecording[];
  dockHeight: number;
  audio: TimelineAudio;
  emptyMessage?: string;
  transportEmptyLabel?: string;
}) {
  // One stream, ordered by when things happened. Transcript lines keep the
  // timestamp they were first seen at, so a growing utterance holds its place.
  const rows = useMemo<LogRow[]>(() => {
    const merged: LogRow[] = events.map((event) => ({
      kind: "event",
      id: `e-${event.id}`,
      at: event.at,
      event,
    }));

    if (transcriptOn) {
      for (const line of transcript) {
        merged.push({ kind: "speech", id: `t-${line.id}`, at: line.at, line });
      }
    }

    return merged.sort((a, b) => a.at - b.at);
  }, [events, transcript, transcriptOn]);

  if (events.length === 0 && transcript.length === 0) {
    return <DockEmpty>{emptyMessage}</DockEmpty>;
  }

  // Two panes: the transport and timeline stay put while the log scrolls under
  // them. Nothing auto-scrolls — reading the log means holding a position.
  return (
    <div className="flex h-full min-h-0 flex-col font-mono text-xs">
      <div className="shrink-0 border-b bg-background px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-2 px-2">
          {timelineOn && (
            <TimelineTransport
              audio={audio}
              live={live}
              recordings={recordings}
              emptyLabel={transportEmptyLabel}
            />
          )}
          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label
                htmlFor="events-transcript"
                className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                Transcript
              </Label>
              <Switch
                id="events-transcript"
                checked={transcriptOn}
                onCheckedChange={onTranscriptToggle}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="events-timeline"
                className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                Timeline
              </Label>
              <Switch id="events-timeline" checked={timelineOn} onCheckedChange={onTimelineToggle} />
            </div>
          </div>
        </div>

        {timelineOn && (
          // Half the dock to the timeline, half to the log, and it scrolls
          // inside its share rather than pushing the log off screen. Drag the
          // dock taller and both grow.
          <div
            className="mt-1.5 overflow-y-auto"
            style={{ maxHeight: Math.max(60, Math.round((dockHeight - 34) * 0.5)) }}
          >
            <EventTimeline
              events={events}
              live={live}
              audioWindow={audio.window}
              playheadAt={audio.playheadAt}
              onSeek={audio.selected ? audio.seekTo : undefined}
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.length === 0 && <p className="px-2 py-1 text-muted-foreground">{emptyMessage}</p>}
        {rows.map((row) => {
          const active =
            audio.playheadAt != null &&
            Math.abs(row.at - audio.playheadAt) <= TIMELINE_ACTIVE_WINDOW_MS;
          const seekable = audio.canSeekTo(row.at);

          return (
            <div
              key={row.id}
              role={seekable ? "button" : undefined}
              tabIndex={seekable ? 0 : undefined}
              onClick={seekable ? () => audio.seekTo(row.at) : undefined}
              onKeyDown={
                seekable
                  ? (ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        audio.seekTo(row.at);
                      }
                    }
                  : undefined
              }
              className={cn(
                "flex gap-3 rounded px-2 py-1",
                active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/40",
                seekable && "cursor-pointer"
              )}
              title={seekable ? "Play the recording from here" : undefined}
            >
              <span className="shrink-0 text-muted-foreground">{formatClock(row.at)}</span>
              {row.kind === "speech" ? (
                <>
                  {/* Speech is the point of the call, so it reads louder than
                      the machinery around it. */}
                  <span
                    className={cn(
                      "w-[190px] shrink-0 truncate",
                      row.line.isAgent ? "text-emerald-500" : "text-sky-500"
                    )}
                    title={row.line.identity}
                  >
                    {row.line.isAgent ? "agent" : "you"}
                    {/* Typed, not spoken — worth knowing when no audio exists
                        for a turn that is nonetheless in the conversation. */}
                    {row.line.via === "text" && (
                      <span className="ml-1 text-muted-foreground">· typed</span>
                    )}
                  </span>
                  <span className="min-w-0 break-words text-foreground">{row.line.text}</span>
                </>
              ) : (
                <>
                  <span
                    className={cn(
                      "w-[190px] shrink-0",
                      row.event.level === "error"
                        ? "text-destructive"
                        : row.event.level === "warn"
                          ? "text-yellow-500"
                          : "text-primary"
                    )}
                  >
                    {row.event.name}
                  </span>
                  <span className="min-w-0 break-all text-foreground/80">{row.event.detail}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
