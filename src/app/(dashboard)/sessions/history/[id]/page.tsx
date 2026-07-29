"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mic,
  Pause,
  Phone,
  Play,
  PlayCircle,
  SkipBack,
  SkipForward,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDuration, type ConsoleMetric } from "@/lib/console-metrics";
import { EventsPanel } from "@/components/livekit/console/events-panel";
import { MetricsPanel, ModelsPanel } from "@/components/livekit/console/metrics-panel";
import { SavedAudioList } from "@/components/livekit/console/recordings-panel";
import {
  DEFAULT_DOCK_HEIGHT,
  DockEmpty,
  DockResizeHandle,
  RailRow,
  RailSection,
  TranscriptPanel,
} from "@/components/livekit/console/session-primitives";
import { useTimelineAudio } from "@/components/livekit/console/timeline-audio";
import {
  RECORDING_KIND_LABEL,
  formatClockMs,
  recordingClock,
  recordingKey,
  type AgentConfigView,
  type ConsoleEvent,
  type SavedRecording,
  type TranscriptLine,
} from "@/components/livekit/console/session-types";

/**
 * Replay of a finished console session.
 *
 * Same panels as the live Console — transcript, event timeline, metrics, model
 * usage — but nothing streams: the data comes from the saved session and the
 * audio from storage. The recording is the clock, so playing it moves the
 * timeline playhead, highlights the line being spoken and lights up the events
 * that fired at that instant.
 */

const TABS = ["Audio", "Events", "Transcript", "Session", "Metrics", "Models"] as const;
type Tab = (typeof TABS)[number];

function parseTab(value: string | null): Tab {
  const match = TABS.find((t) => t.toLowerCase() === value?.toLowerCase());
  return match ?? "Events";
}

interface SessionDetail {
  id: number;
  agentName: string;
  room: string;
  roomSid: string | null;
  talkMode: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  participants: number;
  eventCount: number;
  metricCount: number;
  transcriptCount: number;
  agentIdentity: string | null;
  serverUrl: string;
  createdAt: string;
  config: AgentConfigView;
  events: ConsoleEvent[];
  metrics: ConsoleMetric[];
  transcript: TranscriptLine[];
}

/**
 * Fills in what a stored transcript may predate. Lines have carried an id and a
 * timestamp since the console started saving them, but a session written by an
 * older build would otherwise render "Invalid Date" and never highlight.
 */
function normalizeSession(session: SessionDetail): SessionDetail {
  const startedAt = new Date(session.startedAt).getTime();
  return {
    ...session,
    transcript: (session.transcript ?? []).map((line, i) => ({
      ...line,
      id: line.id ?? `line-${i}`,
      at: typeof line.at === "number" ? line.at : startedAt,
    })),
  };
}

export default function SessionReplayPageRoute() {
  // useSearchParams (the dock tab) needs a boundary to fall back to.
  return (
    <Suspense fallback={null}>
      <SessionReplayPage />
    </Suspense>
  );
}

function SessionReplayPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timelineOn, setTimelineOn] = useState(true);
  const [transcriptOn, setTranscriptOn] = useState(true);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockHeight, setDockHeight] = useState(DEFAULT_DOCK_HEIGHT);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const setTab = useCallback(
    (next: Tab) => {
      const query = new URLSearchParams(searchParams.toString());
      query.set("tab", next.toLowerCase());
      router.replace(`?${query.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    setLoading(true);
    fetch(`/api/sessions/${encodeURIComponent(params.id)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
      })
      .then((data) => {
        setSession(normalizeSession(data.session as SessionDetail));
        setRecordings((data.recordings || []) as SavedRecording[]);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [params.id]);

  const audio = useTimelineAudio({
    agentName: session?.agentName ?? "",
    roomName: session?.room ?? null,
    recordings,
    // Which call this replay is of. A room name can be reused, so its recordings
    // may span several calls and only one of them shares this session's clock.
    sessionStartedAt: session?.startedAt ?? null,
  });

  const events = session?.events ?? [];
  const metrics = session?.metrics ?? [];
  const transcript = session?.transcript ?? [];

  const remove = async () => {
    if (!session) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Could not delete the session", {
          description:
            data.error === "Insufficient permissions"
              ? "Only an admin or owner can delete a session."
              : data.error || `HTTP ${res.status}`,
        });
        return;
      }
      toast.success("Session deleted");
      router.push("/sessions/history");
    } catch {
      toast.error("Could not reach the dashboard API");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading session…
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="size-6 text-yellow-500" />
        <p className="text-sm text-foreground">{error || "Session not found"}</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/sessions/history">Back to session history</Link>
        </Button>
      </div>
    );
  }

  const started = new Date(session.startedAt);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon-sm" asChild>
            <Link href="/sessions/history">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <span className="text-base font-semibold text-foreground">Session replay</span>
          <span className="h-4 w-px bg-border" />
          <Link
            href={`/agents/${encodeURIComponent(session.agentName)}`}
            className="font-mono text-sm text-foreground/80 hover:text-primary"
          >
            {session.agentName}
          </Link>
          <Badge variant="outline" className="gap-1.5 text-[10px] uppercase text-muted-foreground">
            {session.talkMode === "sip" ? <Mic className="size-3" /> : <Phone className="size-3" />}
            {session.talkMode}
          </Badge>
          <span className="text-xs text-muted-foreground">{started.toLocaleString()}</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
              Current status
            </div>
            <div className="flex items-center justify-end gap-1.5 font-mono text-xs text-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground" />
              ENDED
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/agents/${encodeURIComponent(session.agentName)}/console`}>
              <PlayCircle className="size-3.5" />
              Open console
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {/* Stage + rail */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="flex min-h-0 flex-1 rounded-lg border border-dashed">
            <div className="flex min-h-0 w-full">
              <PlaybackStage
                audio={audio}
                recordings={recordings}
                durationMs={session.durationMs}
              />
              <TranscriptPanel
                lines={transcript}
                autoScroll={false}
                emptyMessage="This session saved no transcript."
                metrics={metrics}
                playheadAt={audio.selected ? audio.playheadAt : null}
                onSeek={audio.selected ? audio.seekTo : undefined}
                canSeekTo={audio.canSeekTo}
              />
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="w-[300px] shrink-0 overflow-y-auto border-l p-4">
          <RailSection title="Session">
            <RailRow
              label="Talked via"
              value={session.talkMode === "sip" ? "sip · phone" : "browser mic"}
              mono
            />
            <RailRow label="Room" value={session.room} mono />
            <RailRow label="Started" value={started.toLocaleString()} />
            <RailRow
              label="Ended"
              value={session.endedAt ? new Date(session.endedAt).toLocaleString() : "—"}
            />
            <RailRow
              label="Duration"
              value={session.durationMs ? formatDuration(session.durationMs) : "—"}
            />
            <RailRow label="Participants" value={String(session.participants)} />
          </RailSection>

          <RailSection title="Captured">
            <RailRow label="Transcript" value={`${transcript.length} lines`} />
            <RailRow label="Events" value={String(events.length)} />
            <RailRow label="Metrics" value={String(metrics.length)} />
            <RailRow label="Recordings" value={String(recordings.length)} />
            <RailRow
              label="Audio storage"
              value={recordings[0]?.storage ?? "—"}
              mono
            />
          </RailSection>

          <RailSection title="Agent configuration">
            <RailRow label="Agent" value={session.agentName} mono />
            <RailRow label="Identity" value={session.agentIdentity ?? "—"} mono />
            <RailRow label="Pipeline" value={session.config?.pipelineMode ?? "—"} />
            <RailRow label="LLM" value={session.config?.llmModel ?? "—"} mono />
            <RailRow
              label="TTS"
              value={
                session.config?.ttsModel
                  ? `${session.config.ttsModel}${
                      session.config.ttsVoice ? ` · ${session.config.ttsVoice}` : ""
                    }`
                  : "—"
              }
              mono
            />
            <RailRow label="STT" value={session.config?.sttModel ?? "—"} mono />
            <RailRow label="Server" value={session.serverUrl || "—"} mono />
          </RailSection>
        </div>
      </div>

      {/* Dock */}
      <div className="shrink-0 border-t">
        {dockOpen && <DockResizeHandle height={dockHeight} onResize={setDockHeight} />}
        <div className="flex items-center justify-between border-b bg-muted/30 pr-3">
          <div className="flex items-center overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  if (!dockOpen) setDockOpen(true);
                }}
                className={cn(
                  "whitespace-nowrap border-r px-4 py-2 text-sm transition-colors",
                  tab === t
                    ? "bg-background font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t}
                {t === "Events" && events.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{events.length}</span>
                )}
                {t === "Metrics" && metrics.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{metrics.length}</span>
                )}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon-xs" onClick={() => setDockOpen((o) => !o)}>
            {dockOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        </div>

        {dockOpen && (
          <div
            style={{ height: dockHeight }}
            className={cn(
              "flex min-h-0 flex-col",
              tab === "Events" || tab === "Metrics" ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            {tab === "Audio" && (
              <div className="space-y-4 p-4">
                <SavedAudioList
                  agentName={session.agentName}
                  recordings={recordings}
                  emptyMessage="No audio was saved for this session. Recording happens in the browser tab that ran it, so a session closed mid-call can end up with events but no audio."
                />
              </div>
            )}
            {tab === "Events" && (
              <EventsPanel
                events={events}
                transcript={transcript}
                timelineOn={timelineOn}
                onTimelineToggle={setTimelineOn}
                transcriptOn={transcriptOn}
                onTranscriptToggle={setTranscriptOn}
                recordings={recordings}
                dockHeight={dockHeight}
                audio={audio}
                emptyMessage="This session saved no events"
                transportEmptyLabel="no audio saved for this session"
              />
            )}
            {tab === "Transcript" && (
              <TranscriptPanel
                lines={transcript}
                className="w-full"
                autoScroll={false}
                emptyMessage="This session saved no transcript."
                metrics={metrics}
                playheadAt={audio.selected ? audio.playheadAt : null}
                onSeek={audio.selected ? audio.seekTo : undefined}
                canSeekTo={audio.canSeekTo}
              />
            )}
            {tab === "Session" && <SessionTab session={session} recordings={recordings} />}
            {tab === "Metrics" && (
              <MetricsPanel
                metrics={metrics}
                events={events}
                timelineOn={timelineOn}
                onTimelineToggle={setTimelineOn}
                recordings={recordings}
                dockHeight={dockHeight}
                audio={audio}
                // Not always a stale agent: a captured session has no metrics when
                // no agent was in the room at all, which is what happens when a
                // sandbox dispatches a worker that is not running. Naming both
                // causes beats sending someone to the Builder for a worker that
                // never came from it.
                emptyHint="No metrics were recorded. Agents publish them on the lk.metrics topic, so this is either an agent deployed before that existed — redeploy it — or a call no agent ever joined."
                transportEmptyLabel="no audio saved for this session"
              />
            )}
            {tab === "Models" && <ModelsPanel metrics={metrics} config={session.config} />}
          </div>
        )}
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              The transcript, events, metrics and {recordings.length} recording
              {recordings.length === 1 ? "" : "s"} are deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The transport, where a live console shows the voice visualizer. It is the
 * only thing on this page that moves, so it gets the space the visualizer had.
 */
function PlaybackStage({
  audio,
  recordings,
  durationMs,
}: {
  audio: ReturnType<typeof useTimelineAudio>;
  recordings: SavedRecording[];
  durationMs: number;
}) {
  const windowStart = audio.window?.start ?? null;

  if (!audio.selected) {
    return (
      <div className="flex w-1/2 flex-col items-center justify-center gap-2 border-r p-6 text-center">
        <span className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
          No audio saved
        </span>
        <p className="max-w-xs text-xs text-muted-foreground">
          The transcript and events below are still complete
          {durationMs ? ` for all ${formatDuration(durationMs)} of this session` : ""}. Audio is
          recorded by the browser tab running the console and uploaded when the session ends.
        </p>
      </div>
    );
  }

  const progress = audio.durationMs > 0 ? (audio.positionMs / audio.durationMs) * 100 : 0;

  return (
    <div className="flex w-1/2 flex-col items-center justify-center gap-4 border-r p-6">
      <div className="w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            {RECORDING_KIND_LABEL[audio.selected.kind] ?? audio.selected.kind}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {formatClockMs(audio.positionMs)} / {formatClockMs(audio.durationMs)}
          </span>
        </div>

        {/* Scrub bar. Seeking is by wall clock, which is what keeps the
            transcript, the event log and the timeline on the same instant. */}
        <div className="relative">
          <input
            type="range"
            min={0}
            max={Math.max(1, audio.durationMs)}
            step={100}
            value={Math.min(audio.positionMs, audio.durationMs)}
            onChange={(e) => {
              if (windowStart === null) return;
              audio.seekTo(windowStart + Number(e.target.value));
            }}
            aria-label="Seek"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted outline-none [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
            style={{
              background: `linear-gradient(to right, var(--primary) ${progress}%, var(--muted) ${progress}%)`,
            }}
          />
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => audio.nudge(-5000)} title="Back 5s">
            <SkipBack className="size-4" />
          </Button>
          <Button size="icon" onClick={audio.toggle} title={audio.playing ? "Pause" : "Play"}>
            {audio.playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => audio.nudge(5000)}
            title="Forward 5s"
          >
            <SkipForward className="size-4" />
          </Button>
        </div>

        {recordings.length > 1 && (
          // Keyed by `agent/file`: a room that took more than one call has a
          // recording per call, all sharing one file name under different agents,
          // so `file` is neither a unique React key nor an unambiguous value.
          <Select value={recordingKey(audio.selected)} onValueChange={audio.choose}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {recordings.map((r) => (
                <SelectItem key={recordingKey(r)} value={recordingKey(r)} className="text-xs">
                  {RECORDING_KIND_LABEL[r.kind] ?? r.kind} · {formatDuration(r.durationMs)}
                  {recordingClock(r) && ` · ${recordingClock(r)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Click a transcript line or an event to jump the audio to it.
        </p>
      </div>
    </div>
  );
}

/** The plain facts of the session, matching the Console's Session tab. */
function SessionTab({
  session,
  recordings,
}: {
  session: SessionDetail;
  recordings: SavedRecording[];
}) {
  const rows: [string, string][] = [
    ["Room name", session.room],
    ["Room SID", session.roomSid ?? "—"],
    ["Talk mode", session.talkMode],
    ["Started", new Date(session.startedAt).toLocaleString()],
    ["Ended", session.endedAt ? new Date(session.endedAt).toLocaleString() : "—"],
    ["Duration", session.durationMs ? formatDuration(session.durationMs) : "—"],
    ["Participants", String(session.participants)],
    ["Agent identity", session.agentIdentity ?? "—"],
    ["Transcript lines", String(session.transcript.length)],
    ["Events", String(session.events.length)],
    ["Metrics", String(session.metrics.length)],
    ["Recordings", `${recordings.length}${recordings[0] ? ` · ${recordings[0].storage}` : ""}`],
    ["Saved", new Date(session.createdAt).toLocaleString()],
    ["Server URL", session.serverUrl || "—"],
  ];

  if (!session.room) return <DockEmpty>This session has no details</DockEmpty>;

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 p-4 text-sm md:grid-cols-2">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-start justify-between gap-4 border-b border-border/50 pb-1.5"
        >
          <span className="text-muted-foreground">{k}</span>
          <span className="min-w-0 break-all text-right font-mono text-xs text-foreground/80">
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}
