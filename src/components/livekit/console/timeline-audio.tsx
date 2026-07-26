"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDuration } from "@/lib/console-metrics";
import {
  RECORDING_KIND_LABEL,
  formatClockMs,
  recordingSrc,
  type SavedRecording,
} from "./session-types";

/**
 * Session audio, driven by the timeline rather than by an <audio> element's own
 * controls: the transport, the event log and the transcript all seek by
 * wall-clock instant, which only works if one player owns the position.
 */
export type TimelineAudio = ReturnType<typeof useTimelineAudio>;

export function useTimelineAudio({
  agentName,
  roomName,
  recordings,
  /** Play as soon as the audio is ready. Used by the replay view. */
  autoSelectKind = "mixed",
}: {
  agentName: string;
  roomName: string | null;
  recordings: SavedRecording[];
  autoSelectKind?: string;
}) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const [chosenFile, setChosenFile] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  // Prefer this session's mixed recording, else the newest one on record.
  const selected = useMemo(() => {
    if (chosenFile) {
      const pick = recordings.find((r) => r.file === chosenFile);
      if (pick) return pick;
    }
    const ofRoom = recordings.filter((r) => r.room === roomName);
    return (
      ofRoom.find((r) => r.kind === autoSelectKind) ??
      ofRoom[0] ??
      recordings.find((r) => r.kind === autoSelectKind) ??
      recordings[0] ??
      null
    );
  }, [chosenFile, recordings, roomName, autoSelectKind]);

  const startMs = selected ? new Date(selected.startedAt).getTime() : null;
  const durationMs = selected?.durationMs ?? 0;

  const src = selected ? recordingSrc(agentName, selected.file) : null;

  // The player has no UI of its own — the timeline and transport drive it — so
  // the element is created here instead of rendered.
  useEffect(() => {
    if (!src) return;
    const el = new Audio(src);
    el.preload = "metadata";
    elRef.current = el;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);

    return () => {
      el.pause();
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      elRef.current = null;
    };
  }, [src]);

  // Smooth playhead: `timeupdate` only fires a few times a second.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const el = elRef.current;
      if (el) setPositionMs(el.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seekMs = useCallback(
    (ms: number) => {
      const el = elRef.current;
      const clamped = Math.min(Math.max(0, ms), durationMs);
      setPositionMs(clamped);
      if (el) el.currentTime = clamped / 1000;
    },
    [durationMs]
  );

  /** Seek by wall-clock instant, which is what the timeline and log rows use. */
  const seekTo = useCallback(
    (at: number) => {
      if (startMs === null) return;
      seekMs(at - startMs);
    },
    [seekMs, startMs]
  );

  const canSeekTo = useCallback(
    (at: number) => startMs !== null && at >= startMs - 1000 && at <= startMs + durationMs + 1000,
    [startMs, durationMs]
  );

  const toggle = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const nudge = useCallback(
    (deltaMs: number) => {
      const el = elRef.current;
      if (!el) return;
      seekMs(el.currentTime * 1000 + deltaMs);
    },
    [seekMs]
  );

  return {
    selected,
    src,
    playing,
    positionMs,
    durationMs,
    window: startMs === null ? null : { start: startMs, end: startMs + durationMs },
    playheadAt: startMs === null ? null : startMs + positionMs,
    choose: (file: string) => {
      setChosenFile(file);
      setPositionMs(0);
      setPlaying(false);
    },
    seekTo,
    canSeekTo,
    toggle,
    nudge,
  };
}

export function TimelineTransport({
  audio,
  live,
  recordings,
  emptyLabel,
}: {
  audio: TimelineAudio;
  live?: boolean;
  recordings: SavedRecording[];
  emptyLabel?: string;
}) {
  if (!audio.selected) {
    return (
      <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        {emptyLabel ??
          (live
            ? "recording — audio syncs here when the session ends"
            : "no session audio saved yet")}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button variant="outline" size="icon-xs" onClick={() => audio.nudge(-5000)} title="Back 5s">
        <SkipBack className="size-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon-xs"
        onClick={audio.toggle}
        title={audio.playing ? "Pause" : "Play"}
      >
        {audio.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <Button variant="outline" size="icon-xs" onClick={() => audio.nudge(5000)} title="Forward 5s">
        <SkipForward className="size-3.5" />
      </Button>
      <span className="ml-1 font-mono text-[10px] text-muted-foreground">
        {formatClockMs(audio.positionMs)} / {formatClockMs(audio.durationMs)}
      </span>

      {recordings.length > 1 && (
        <Select value={audio.selected.file} onValueChange={audio.choose}>
          <SelectTrigger size="sm" className="ml-1 h-7 min-w-[220px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {recordings.map((r) => (
              <SelectItem key={r.file} value={r.file} className="text-xs">
                {RECORDING_KIND_LABEL[r.kind] ?? r.kind} · {r.room.slice(-13)} ·{" "}
                {formatDuration(r.durationMs)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
