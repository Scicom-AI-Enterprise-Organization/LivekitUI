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
  recordingClock,
  recordingKey,
  recordingSrcOf,
  type SavedRecording,
} from "./session-types";

/**
 * Session audio, driven by the timeline rather than by an <audio> element's own
 * controls: the transport, the event log and the transcript all seek by
 * wall-clock instant, which only works if one player owns the position.
 */
export type TimelineAudio = ReturnType<typeof useTimelineAudio>;

/**
 * The candidate closest to when the call began, or the first one when there is
 * nothing to compare against.
 *
 * Nearest rather than first: a room that took more than one call has a recording
 * per call, and only one of them shares a clock with this session's events. The
 * others are not merely the wrong audio — every marker is positioned through the
 * selected recording's window, so picking one from hours earlier stretches the
 * axis across the gap.
 */
function nearestToStart(
  candidates: SavedRecording[],
  startedAt?: string | null
): SavedRecording | undefined {
  if (candidates.length < 2 || !startedAt) return candidates[0];
  const target = new Date(startedAt).getTime();
  if (Number.isNaN(target)) return candidates[0];

  let best = candidates[0];
  let bestGap = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const at = new Date(candidate.startedAt).getTime();
    // A row with no usable start cannot be ranked; it stays the fallback only.
    if (Number.isNaN(at)) continue;
    const gap = Math.abs(at - target);
    if (gap < bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

export function useTimelineAudio({
  agentName,
  roomName,
  recordings,
  /** Play as soon as the audio is ready. Used by the replay view. */
  autoSelectKind = "mixed",
  sessionStartedAt,
}: {
  agentName: string;
  roomName: string | null;
  recordings: SavedRecording[];
  autoSelectKind?: string;
  /**
   * When the call this view is about began (ISO). Recordings are looked up by
   * **room**, and a room name can be reused — the assist sandbox uses one room
   * per sandbox, and a SIP rule can funnel every caller into one — so a session's
   * room may hold a recording per call. This is what says which of them is *this*
   * call's. Without it the first row won, which on a reused room meant audio from
   * a different day: every instant on the plot is mapped through the recording's
   * window, so the axis stretched to span the gap and the whole session collapsed
   * into a sliver at one end.
   */
  sessionStartedAt?: string | null;
}) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  /**
   * A seek the element could not take yet, in seconds.
   *
   * `currentTime` is only honoured once the element has metadata; assigning it
   * before that is dropped, and the element then starts from zero. The target
   * is parked here and applied on `loadedmetadata`.
   */
  const pendingSeekRef = useRef<number | null>(null);
  /** Latest position, readable from callbacks that must not re-create on it. */
  const positionRef = useRef(0);
  // Keyed by `agent/file`, not by file: one room's captures can carry the same
  // file name under different agents, and picking by file alone selected whichever
  // came first.
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  // Keyed by src so switching recordings can't be read as the new one's length,
  // and so nothing has to be reset from inside an effect.
  const [measured, setMeasured] = useState<{ src: string; ms: number } | null>(null);

  // Prefer this session's mixed recording, else the newest one on record.
  const selected = useMemo(() => {
    if (chosenKey) {
      const pick = recordings.find((r) => recordingKey(r) === chosenKey);
      if (pick) return pick;
    }
    const ofRoom = recordings.filter((r) => r.room === roomName);
    const ofKind = ofRoom.filter((r) => r.kind === autoSelectKind);
    // Of this room's recordings, the one from *this* call — the recorder starts a
    // moment after the room connects, so the right one is the nearest in time, not
    // the first on record.
    const pool = ofKind.length > 0 ? ofKind : ofRoom;
    return (
      nearestToStart(pool, sessionStartedAt) ??
      recordings.find((r) => r.kind === autoSelectKind) ??
      recordings[0] ??
      null
    );
  }, [chosenKey, recordings, roomName, autoSelectKind, sessionStartedAt]);

  const startMs = selected ? new Date(selected.startedAt).getTime() : null;
  // The recording's own agent addresses its bytes; the page's is only a fallback.
  const src = selected ? recordingSrcOf(selected, agentName) : null;

  /**
   * The file's own length wins over the length the recorder wrote down.
   *
   * `durationMs` on the record is wall-clock — `Date.now()` at stop minus at
   * start — while the bytes are however much audio the graph actually produced.
   * A suspended AudioContext (autoplay policy, a backgrounded tab) makes the
   * second shorter than the first, and since the whole timeline maps wall-clock
   * instants through this window, the difference shows up as every marker
   * sitting at the wrong place in the audio.
   */
  const durationMs =
    (measured?.src === src ? measured.ms : null) ?? selected?.durationMs ?? 0;

  // The player has no UI of its own — the timeline and transport drive it — so
  // the element is created here instead of rendered.
  useEffect(() => {
    if (!src) return;
    const el = new Audio(src);
    // Session recordings are seconds long, and the whole file has to be read
    // before a webm from MediaRecorder reports its real duration.
    el.preload = "auto";
    elRef.current = el;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    // A webm from MediaRecorder carries no duration in its header, so this
    // reports Infinity until enough of the file has been read. It settles on
    // `durationchange`, which is why both are listened for.
    const onDuration = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setMeasured((prev) =>
          prev?.src === src && prev.ms === el.duration * 1000
            ? prev
            : { src, ms: el.duration * 1000 }
        );
      }
    };
    // Metadata is the first moment a seek can land. Anything the user asked for
    // before now was parked rather than lost.
    const onLoadedMetadata = () => {
      onDuration();
      const pending = pendingSeekRef.current;
      if (pending !== null) {
        pendingSeekRef.current = null;
        el.currentTime = pending;
      }
    };
    // The element is the authority once a seek completes — clamping against a
    // duration we only estimated can land somewhere else.
    const onSeeked = () => {
      positionRef.current = el.currentTime * 1000;
      setPositionMs(positionRef.current);
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("durationchange", onDuration);
    el.addEventListener("seeked", onSeeked);

    return () => {
      el.pause();
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("durationchange", onDuration);
      el.removeEventListener("seeked", onSeeked);
      elRef.current = null;
      pendingSeekRef.current = null;
    };
  }, [src]);

  // Smooth playhead: `timeupdate` only fires a few times a second.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const el = elRef.current;
      // While a seek is in flight `currentTime` still reads the old position,
      // so sampling it here would drag the playhead back to where the user
      // seeked *from* — and the next nudge would then measure from there.
      if (el && !el.seeking) {
        positionRef.current = el.currentTime * 1000;
        setPositionMs(positionRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seekMs = useCallback(
    (ms: number) => {
      const el = elRef.current;

      /**
       * Clamp to what the element actually has, and only when that is known.
       *
       * `durationMs` falls back to the length the recorder wrote down, which is
       * 0 for a row that never got one — and clamping to 0 turns every seek
       * into a jump to the start. An unknown limit is better left to the
       * element, which clamps to its own seekable range anyway.
       */
      const elDuration =
        el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : null;
      const limit = elDuration ?? (durationMs > 0 ? durationMs : Infinity);
      const clamped = Math.min(Math.max(0, ms), limit);

      positionRef.current = clamped;
      setPositionMs(clamped);
      if (!el) return;

      // Before metadata the assignment is dropped on the floor; park it.
      if (el.readyState < 1 /* HAVE_METADATA */) {
        pendingSeekRef.current = clamped / 1000;
        return;
      }
      pendingSeekRef.current = null;
      el.currentTime = clamped / 1000;
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
    if (!el.paused) {
      el.pause();
      return;
    }

    // A seek made while the element was still loading has to land before play
    // starts, or playback begins at zero and throws the seek away.
    const pending = pendingSeekRef.current;
    if (pending !== null && el.readyState >= 1) {
      pendingSeekRef.current = null;
      el.currentTime = pending;
    } else if (el.ended) {
      // play() on an element that has finished rewinds it to the start. When
      // the user has since seeked somewhere else, that is the seek being
      // discarded — put the position back before starting.
      const target = positionRef.current / 1000;
      if (Number.isFinite(target) && target < el.duration) el.currentTime = target;
    }

    void el.play().catch(() => {});
  }, []);

  const nudge = useCallback(
    (deltaMs: number) => {
      const el = elRef.current;
      if (!el) return;
      // Step from where the user last asked to be, not from the element: with a
      // seek still in flight `currentTime` is the old position, so repeated
      // presses would keep re-measuring the same spot instead of advancing.
      const from = el.seeking || pendingSeekRef.current !== null
        ? positionRef.current
        : el.currentTime * 1000;
      seekMs(from + deltaMs);
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
    /** Takes a `recordingKey()`, not a file name. */
    choose: (key: string) => {
      setChosenKey(key);
      positionRef.current = 0;
      pendingSeekRef.current = null;
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
        <Select value={recordingKey(audio.selected)} onValueChange={audio.choose}>
          <SelectTrigger size="sm" className="ml-1 h-7 min-w-[220px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {recordings.map((r) => (
              <SelectItem key={recordingKey(r)} value={recordingKey(r)} className="text-xs">
                {RECORDING_KIND_LABEL[r.kind] ?? r.kind} · {r.room.slice(-13)} ·{" "}
                {formatDuration(r.durationMs)}
                {/* Two calls into one room are the same kind and much the same
                    length; the clock is what tells them apart. */}
                {recordingClock(r) && ` · ${recordingClock(r)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
