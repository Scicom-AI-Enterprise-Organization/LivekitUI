"use client";

/* ────────────────────────────────────────────────────────────────────────────
   Agent Console — monitor, test and debug one agent live.

   The page always mounts a LiveKitRoom (with connect={false} until a session
   starts) so every panel can read room context without a second code path for
   the idle state. Events, metrics and transcript are accumulated in the outer
   component so they survive the session ending, until "Clear events".
   ──────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  BarVisualizer,
  VoiceAssistantControlBar,
  useVoiceAssistant,
  useRoomContext,
  useParticipants,
  useLocalParticipant,
  useTranscriptions,
} from "@livekit/components-react";
import "@livekit/components-styles";
import {
  ConnectionState,
  RoomEvent,
  type Participant,
  type RemoteParticipant,
  type TrackPublication,
} from "livekit-client";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Pause,
  Play,
  Settings2,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  TriangleAlert,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { AudioScope } from "@/components/livekit/console/audio-scope";
import {
  EventTimeline,
  TIMELINE_ACTIVE_WINDOW_MS,
} from "@/components/livekit/console/event-timeline";
import {
  useSessionRecorder,
  type SavedRecording,
} from "@/components/livekit/console/use-session-recorder";
import {
  CONSOLE_METRICS_TOPIC,
  METRIC_KIND_LABEL,
  aggregateUsage,
  buildTurnTraces,
  formatClock,
  formatCount,
  formatDuration,
  formatSeconds,
  parseConsoleMetric,
  percentile,
  type ConsoleMetric,
} from "@/lib/console-metrics";

const TABS = [
  "Audio",
  "Events",
  "Session",
  "Participants",
  "RPC",
  "DTMF",
  "Metrics",
  "Models",
] as const;
type Tab = (typeof TABS)[number];

interface ConsoleEvent {
  id: string;
  at: number;
  name: string;
  detail: string;
  level: "info" | "warn" | "error";
}

interface AgentListEntry {
  agentName: string;
  status: string;
  running: boolean;
}

interface AgentConfigView {
  llmModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  sttModel?: string;
  sttLanguage?: string;
  pipelineMode?: string;
}

interface JoinOptions {
  participantName: string;
  participantMetadata: string;
  roomMetadata: string;
}

interface TranscriptLine {
  identity: string;
  text: string;
  isAgent: boolean;
}

/* ────────────────────────────────────
   Page
   ──────────────────────────────────── */
export default function AgentConsolePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const agentName = decodeURIComponent(params.id);

  const [agents, setAgents] = useState<AgentListEntry[]>([]);
  const [config, setConfig] = useState<AgentConfigView | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>("unknown");

  const [token, setToken] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);

  const [events, setEvents] = useState<ConsoleEvent[]>([]);
  const [metrics, setMetrics] = useState<ConsoleMetric[]>([]);
  // Transcript, recordings and the timeline toggle live here, above the room, so
  // ending a session (which remounts LiveKitRoom) does not wipe them.
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [timelineOn, setTimelineOn] = useState(true);

  const [tab, setTab] = useState<Tab>("Audio");
  const [dockOpen, setDockOpen] = useState(true);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [joinOptions, setJoinOptions] = useState<JoinOptions>({
    participantName: "",
    participantMetadata: "",
    roomMetadata: "",
  });

  const seqRef = useRef(0);

  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || "ws://localhost:7880";

  // ── Agent metadata ──
  useEffect(() => {
    fetch("/api/agents")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const list: AgentListEntry[] = data?.agents ?? [];
        setAgents(list);
        const mine = list.find((a) => a.agentName === agentName);
        if (mine) setAgentStatus(mine.running ? "connected" : mine.status);
      })
      .catch(() => {});

    fetch(`/api/agents/by-name?name=${encodeURIComponent(agentName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.agent?.config) setConfig(data.agent.config as AgentConfigView);
      })
      .catch(() => {});
  }, [agentName]);

  const addEvent = useCallback(
    (name: string, detail: string, level: ConsoleEvent["level"] = "info") => {
      seqRef.current += 1;
      const id = `${Date.now()}-${seqRef.current}`;
      setEvents((prev) => [...prev, { id, at: Date.now(), name, detail, level }]);
    },
    []
  );

  const addMetric = useCallback((raw: unknown) => {
    seqRef.current += 1;
    const metric = parseConsoleMetric(raw, Date.now(), seqRef.current);
    if (metric) setMetrics((prev) => [...prev, metric]);
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setMetrics([]);
    setTranscript([]);
  }, []);

  const recordingSaved = useCallback((recording: SavedRecording) => {
    setRecordings((prev) => [
      recording,
      ...prev.filter((r) => r.file !== recording.file),
    ]);
  }, []);

  const recordingDeleted = useCallback((file: string) => {
    setRecordings((prev) => prev.filter((r) => r.file !== file));
  }, []);

  // Saved recordings from earlier sessions.
  useEffect(() => {
    fetch(`/api/agents/${encodeURIComponent(agentName)}/recordings`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.recordings) setRecordings(data.recordings as SavedRecording[]);
      })
      .catch(() => {});
  }, [agentName]);

  // ── Session control ──
  const startSession = useCallback(async () => {
    setConnecting(true);
    setError(null);
    setEndedAt(null);
    try {
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName,
          mode: "console",
          participantName: joinOptions.participantName || undefined,
          participantMetadata: joinOptions.participantMetadata || undefined,
          roomMetadata: joinOptions.roomMetadata || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        setError(data.error || "Failed to start the session");
        addEvent("session.start_failed", data.error || `HTTP ${res.status}`, "error");
        return;
      }
      setToken(data.token);
      setRoomName(data.room);
      setStartedAt(Date.now());
      addEvent("session.dispatched", `${data.agent} → ${data.room}`);
    } catch {
      setError("Could not reach the dashboard API");
      addEvent("session.start_failed", "Could not reach the dashboard API", "error");
    } finally {
      setConnecting(false);
    }
  }, [agentName, joinOptions, addEvent]);

  const endSession = useCallback(() => {
    setToken(null);
    setEndedAt(Date.now());
  }, []);

  const live = !!token;

  return (
    // Keyed on the room: a new session gets a fresh Room (and fresh transcript /
    // participant state), while ending one leaves the last session on screen.
    // Events and metrics live above this, so they survive until "Clear events".
    <LiveKitRoom
      key={roomName ?? "idle"}
      token={token ?? undefined}
      serverUrl={serverUrl}
      connect={live}
      audio
      video={false}
      onDisconnected={() => {
        setToken(null);
        setEndedAt((prev) => prev ?? Date.now());
      }}
      onError={(err) => setError(err.message)}
      className="flex h-full flex-col overflow-hidden"
    >
      <ConsoleShell
        agentName={agentName}
        agents={agents}
        agentStatus={agentStatus}
        config={config}
        roomName={roomName}
        serverUrl={serverUrl}
        live={live}
        connecting={connecting}
        error={error}
        startedAt={startedAt}
        endedAt={endedAt}
        events={events}
        metrics={metrics}
        transcript={transcript}
        recordings={recordings}
        timelineOn={timelineOn}
        tab={tab}
        dockOpen={dockOpen}
        joinOptions={joinOptions}
        onTabChange={setTab}
        onDockToggle={() => setDockOpen((o) => !o)}
        onStart={startSession}
        onEnd={endSession}
        onClear={clearEvents}
        onAddEvent={addEvent}
        onAddMetric={addMetric}
        onTranscript={setTranscript}
        onRecordingSaved={recordingSaved}
        onRecordingDeleted={recordingDeleted}
        onTimelineToggle={setTimelineOn}
        onConfigure={() => setConfigureOpen(true)}
        onAgentChange={(name) => router.push(`/agents/${encodeURIComponent(name)}/console`)}
      />
      <RoomAudioRenderer />

      {/* Keyed on `open` so the draft starts from the saved options each time. */}
      <ConfigureDialog
        key={configureOpen ? "configure-open" : "configure-closed"}
        open={configureOpen}
        options={joinOptions}
        live={live}
        onOpenChange={setConfigureOpen}
        onSave={setJoinOptions}
      />
    </LiveKitRoom>
  );
}

/* ────────────────────────────────────
   Shell: header + stage + rail + dock
   ──────────────────────────────────── */
function ConsoleShell({
  agentName,
  agents,
  agentStatus,
  config,
  roomName,
  serverUrl,
  live,
  connecting,
  error,
  startedAt,
  endedAt,
  events,
  metrics,
  transcript,
  recordings,
  timelineOn,
  tab,
  dockOpen,
  joinOptions,
  onTabChange,
  onDockToggle,
  onStart,
  onEnd,
  onClear,
  onAddEvent,
  onAddMetric,
  onTranscript,
  onRecordingSaved,
  onRecordingDeleted,
  onTimelineToggle,
  onConfigure,
  onAgentChange,
}: {
  agentName: string;
  agents: AgentListEntry[];
  agentStatus: string;
  config: AgentConfigView | null;
  roomName: string | null;
  serverUrl: string;
  live: boolean;
  connecting: boolean;
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;
  events: ConsoleEvent[];
  metrics: ConsoleMetric[];
  transcript: TranscriptLine[];
  recordings: SavedRecording[];
  timelineOn: boolean;
  tab: Tab;
  dockOpen: boolean;
  joinOptions: JoinOptions;
  onTabChange: (t: Tab) => void;
  onDockToggle: () => void;
  onStart: () => void;
  onEnd: () => void;
  onClear: () => void;
  onAddEvent: (name: string, detail: string, level?: ConsoleEvent["level"]) => void;
  onAddMetric: (raw: unknown) => void;
  onTranscript: (lines: TranscriptLine[]) => void;
  onRecordingSaved: (recording: SavedRecording) => void;
  onRecordingDeleted: (file: string) => void;
  onTimelineToggle: (on: boolean) => void;
  onConfigure: () => void;
  onAgentChange: (name: string) => void;
}) {
  const room = useRoomContext();
  const { state: agentState, agent, audioTrack } = useVoiceAssistant();
  const participants = useParticipants();
  const transcriptions = useTranscriptions();
  const { microphoneTrack, localParticipant } = useLocalParticipant();

  const connectionState = room?.state ?? ConnectionState.Disconnected;
  const connected = connectionState === ConnectionState.Connected;

  // The hook resets its buffer when the room goes away, so mirror it upwards
  // where it outlives the session.
  const agentIdentity = agent?.identity;
  useEffect(() => {
    if (transcriptions.length === 0) return;
    onTranscript(
      transcriptions.map((t) => ({
        identity: t.participantInfo.identity,
        text: t.text,
        isAgent: !!agentIdentity && t.participantInfo.identity === agentIdentity,
      }))
    );
  }, [transcriptions, agentIdentity, onTranscript]);

  // ── Session audio: raw media tracks for the scopes and the recorder ──
  const agentMediaTrack = audioTrack?.publication?.track?.mediaStreamTrack;
  const micMediaTrack = microphoneTrack?.track?.mediaStreamTrack;

  const { recording, uploading, unsupported } = useSessionRecorder({
    agentName,
    roomName,
    live,
    agentTrack: agentMediaTrack,
    micTrack: micMediaTrack,
    onSaved: onRecordingSaved,
    onError: (message) => onAddEvent("recording.error", message, "warn"),
  });

  // ── Room → console events + metrics ──
  useEffect(() => {
    if (!room) return;

    const onData = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string
    ) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        parsed = null;
      }

      if (topic === CONSOLE_METRICS_TOPIC) {
        onAddMetric(parsed);
        return;
      }
      onAddEvent(
        "data.received",
        `${participant?.identity ?? "server"}${topic ? ` [${topic}]` : ""} ${
          typeof parsed === "object" ? JSON.stringify(parsed) : `${payload.byteLength} bytes`
        }`.slice(0, 300)
      );
    };

    const onParticipantConnected = (p: RemoteParticipant) =>
      onAddEvent("participant.connected", `${p.identity}${p.isAgent ? " (agent)" : ""}`);
    const onParticipantDisconnected = (p: RemoteParticipant) =>
      onAddEvent("participant.disconnected", p.identity);
    const onTrackSubscribed = (_t: unknown, pub: TrackPublication, p: Participant) =>
      onAddEvent("track.subscribed", `${p.identity} ${pub.source} (${pub.trackSid})`);
    const onTrackUnsubscribed = (_t: unknown, pub: TrackPublication, p: Participant) =>
      onAddEvent("track.unsubscribed", `${p.identity} ${pub.source}`);
    const onTrackPublished = (pub: TrackPublication, p: Participant) =>
      onAddEvent("track.published", `${p.identity} ${pub.source}`);
    const onTrackMuted = (pub: TrackPublication, p: Participant) =>
      onAddEvent("track.muted", `${p.identity} ${pub.source}`);
    const onTrackUnmuted = (pub: TrackPublication, p: Participant) =>
      onAddEvent("track.unmuted", `${p.identity} ${pub.source}`);
    const onConnectionStateChanged = (state: ConnectionState) =>
      onAddEvent("connection.state", state, state === ConnectionState.Reconnecting ? "warn" : "info");
    const onDisconnected = (reason?: unknown) =>
      onAddEvent("room.disconnected", reason !== undefined ? String(reason) : "—", "warn");
    const onRoomMetadata = (metadata: string) =>
      onAddEvent("room.metadata_changed", metadata || "—");
    const onAttributesChanged = (
      changed: Record<string, string>,
      p: Participant
    ) =>
      onAddEvent(
        "participant.attributes",
        `${p.identity} ${JSON.stringify(changed)}`.slice(0, 300)
      );

    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.TrackPublished, onTrackPublished);
    room.on(RoomEvent.TrackMuted, onTrackMuted);
    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted);
    room.on(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.RoomMetadataChanged, onRoomMetadata);
    room.on(RoomEvent.ParticipantAttributesChanged, onAttributesChanged);

    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.TrackPublished, onTrackPublished);
      room.off(RoomEvent.TrackMuted, onTrackMuted);
      room.off(RoomEvent.TrackUnmuted, onTrackUnmuted);
      room.off(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.RoomMetadataChanged, onRoomMetadata);
      room.off(RoomEvent.ParticipantAttributesChanged, onAttributesChanged);
    };
  }, [room, onAddEvent, onAddMetric]);

  // Agent state transitions are the single most useful debugging signal.
  const lastAgentState = useRef<string | null>(null);
  useEffect(() => {
    if (!live) return;
    if (lastAgentState.current === agentState) return;
    lastAgentState.current = agentState;
    onAddEvent("agent.state", agentState);
  }, [agentState, live, onAddEvent]);

  // Room SID is only issued by the server, so it has to be awaited. It is kept
  // with the room it belongs to, so a previous session's sid is never shown
  // against a new room.
  const [roomSid, setRoomSid] = useState<{ room: string; sid: string } | null>(null);
  useEffect(() => {
    if (!room || !connected || !roomName) return;
    let cancelled = false;
    room
      .getSid()
      .then((sid) => {
        if (!cancelled) setRoomSid({ room: roomName, sid });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [room, connected, roomName]);

  // ── Live duration ──
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  const duration =
    startedAt === null ? null : (live ? now : (endedAt ?? now)) - startedAt;

  const status = connecting
    ? "CONNECTING"
    : live && connected
      ? "LIVE"
      : live
        ? "JOINING"
        : "IDLE";

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon-sm" asChild>
            <Link href={`/agents/${encodeURIComponent(agentName)}`}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <span className="text-base font-semibold text-foreground">Console</span>
          <span className="h-4 w-px bg-border" />
          <span className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wide text-muted-foreground">
            Testing
            <TriangleAlert className="size-3.5 text-yellow-500" />
          </span>
          <Select value={agentName} onValueChange={onAgentChange}>
            <SelectTrigger size="sm" className="min-w-[190px]">
              <SelectValue placeholder="No agent selected" />
            </SelectTrigger>
            <SelectContent>
              {agents.length === 0 && (
                <SelectItem value={agentName}>{agentName}</SelectItem>
              )}
              {agents.map((a) => (
                <SelectItem key={a.agentName} value={a.agentName}>
                  {a.agentName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3">
          {(recording || uploading) && (
            <Badge variant="outline" className="gap-1.5 border-red-500/30 text-red-500">
              <span
                className={cn(
                  "size-1.5 rounded-full bg-red-500",
                  recording && "animate-pulse"
                )}
              />
              {uploading ? "SAVING" : "REC"}
            </Badge>
          )}
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
              Current status
            </div>
            <div className="flex items-center justify-end gap-1.5 text-xs font-mono text-foreground">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  status === "LIVE"
                    ? "bg-emerald-500 animate-pulse"
                    : status === "IDLE"
                      ? "bg-muted-foreground"
                      : "bg-yellow-500 animate-pulse"
                )}
              />
              {status}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onConfigure}>
            <Settings2 className="size-3.5" />
            Configure
          </Button>
          {live ? (
            <Button size="sm" variant="destructive" onClick={onEnd}>
              <Square className="size-3.5" />
              End session
            </Button>
          ) : (
            <Button size="sm" onClick={onStart} disabled={connecting}>
              {connecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Start session
            </Button>
          )}
        </div>
      </div>

      {/* Stage + rail */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col p-4">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="size-4 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          <div className="flex min-h-0 flex-1 rounded-lg border border-dashed">
            {live ? (
              <div className="flex min-h-0 w-full">
                {/* Voice stage */}
                <div className="flex w-1/2 flex-col items-center justify-center border-r p-4">
                  <BarVisualizer
                    state={agentState}
                    barCount={5}
                    trackRef={audioTrack}
                    className="h-[120px] w-[200px]"
                    options={{ minHeight: 10 }}
                  />
                  <p className="mt-4 font-mono text-sm capitalize text-muted-foreground">
                    {agentState}
                  </p>
                  {!agent && connected && (
                    <p className="mt-2 max-w-xs text-center text-xs text-yellow-500">
                      No agent has joined this room yet. If it never joins, check the
                      agent logs — a missing plugin or rejected provider key is the usual
                      cause.
                    </p>
                  )}
                  <div className="mt-6">
                    <VoiceAssistantControlBar />
                  </div>
                </div>
                {/* Transcript */}
                <TranscriptPanel lines={transcript} />
              </div>
            ) : transcript.length > 0 ? (
              /* The session ended — keep what was said on screen for review. */
              <div className="flex min-h-0 w-full flex-col">
                <div className="flex items-center justify-between gap-3 border-b px-3 py-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                    Session ended
                    {duration !== null ? ` · ${formatDuration(duration)}` : ""}
                  </span>
                  <Button size="sm" onClick={onStart} disabled={connecting}>
                    {connecting && <Loader2 className="size-3.5 animate-spin" />}
                    Start a session
                  </Button>
                </div>
                <TranscriptPanel lines={transcript} className="w-full" />
              </div>
            ) : (
              <div className="flex w-full flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="text-sm font-semibold text-foreground">Test your agent</div>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Console is the fastest way to monitor, test, and debug your agent live,
                  with transcripts, events, and usage details.
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={onConfigure}>
                    Open Console configuration
                  </Button>
                  <Button size="sm" onClick={onStart} disabled={connecting}>
                    {connecting && <Loader2 className="size-3.5 animate-spin" />}
                    Start a session
                  </Button>
                </div>
                {agentStatus !== "connected" && (
                  <p className="mt-2 text-xs text-yellow-500">
                    This agent is {agentStatus}. Deploy it before starting a session.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right rail */}
        <div className="w-[300px] shrink-0 overflow-y-auto border-l p-4">
          <RailSection title="Session">
            <RailRow label="Room" value={roomName ?? "—"} mono />
            <RailRow label="Region" value={process.env.NEXT_PUBLIC_LIVEKIT_REGION || "local"} />
            <RailRow label="Duration" value={duration === null ? "—" : formatDuration(duration)} />
            <RailRow label="Participants" value={String(participants.length)} />
          </RailSection>

          <RailSection title="Room configuration">
            <RailRow label="Metadata" value={room?.metadata || joinOptions.roomMetadata || "—"} />
            <RailRow label="E2E encryption" value={room?.isE2EEEnabled ? "on" : "off"} />
            <RailRow
              label="Recording"
              value={
                recording
                  ? "console (agent + mic)"
                  : room?.isRecording
                    ? "server egress"
                    : "—"
              }
            />
          </RailSection>

          <RailSection title="Agent configuration">
            <RailRow label="Agent" value={agentName} mono />
            <RailRow label="Identity" value={agent?.identity ?? "—"} mono />
            <RailRow label="Pipeline" value={config?.pipelineMode ?? "—"} />
            <RailRow label="LLM" value={config?.llmModel ?? "—"} mono />
            <RailRow
              label="TTS"
              value={config?.ttsModel ? `${config.ttsModel}${config.ttsVoice ? ` · ${config.ttsVoice}` : ""}` : "—"}
              mono
            />
            <RailRow label="STT" value={config?.sttModel ?? "—"} mono />
            <RailRow label="Server" value={serverUrl} mono />
          </RailSection>
        </div>
      </div>

      {/* Dock */}
      <div className="shrink-0 border-t">
        <div className="flex items-center justify-between border-b bg-muted/30 pr-3">
          <div className="flex items-center overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  onTabChange(t);
                  if (!dockOpen) onDockToggle();
                }}
                className={cn(
                  "border-r px-4 py-2 text-sm transition-colors whitespace-nowrap",
                  tab === t
                    ? "bg-background text-foreground font-medium"
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
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onClear}>
              <Trash2 className="size-3.5" />
              Clear events
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={onDockToggle}>
              {dockOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </Button>
          </div>
        </div>

        {dockOpen && (
          <div className="h-[280px] overflow-y-auto">
            {tab === "Audio" && (
              <AudioTab
                live={live}
                agentName={agentName}
                agentTrack={agentMediaTrack}
                micTrack={micMediaTrack}
                micMuted={microphoneTrack?.isMuted ?? !localParticipant?.isMicrophoneEnabled}
                recordings={recordings}
                recording={recording}
                uploading={uploading}
                unsupported={unsupported}
                onDeleted={onRecordingDeleted}
              />
            )}
            {tab === "Events" && (
              <EventsTab
                events={events}
                live={live}
                timelineOn={timelineOn}
                onTimelineToggle={onTimelineToggle}
                agentName={agentName}
                roomName={roomName}
                recordings={recordings}
              />
            )}
            {tab === "Session" && (
              <SessionTab
                roomName={roomName}
                roomSid={roomSid?.room === roomName ? roomSid.sid : null}
                room={room}
                serverUrl={serverUrl}
                connectionState={connectionState}
                startedAt={startedAt}
                endedAt={endedAt}
                duration={duration}
                agentIdentity={agent?.identity}
                agentState={agentState}
                participants={participants.length}
              />
            )}
            {tab === "Participants" && <ParticipantsTab />}
            {tab === "RPC" && <RpcTab agentIdentity={agent?.identity} live={live} />}
            {tab === "DTMF" && <DtmfTab live={live} onAddEvent={onAddEvent} />}
            {tab === "Metrics" && <MetricsTab metrics={metrics} live={live} />}
            {tab === "Models" && <ModelsTab metrics={metrics} config={config} />}
          </div>
        )}
      </div>
    </>
  );
}

/* ────────────────────────────────────
   Right rail primitives
   ──────────────────────────────────── */
function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function RailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="font-mono uppercase tracking-wide text-muted-foreground shrink-0">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 break-all text-right text-foreground/80",
          mono && "font-mono"
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function DockEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

/* ────────────────────────────────────
   Transcript
   ──────────────────────────────────── */
function TranscriptPanel({
  lines,
  className,
}: {
  lines: TranscriptLine[];
  className?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  return (
    <div className={cn("flex min-h-0 flex-col", className ?? "w-1/2")}>
      <div className="border-b px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        Transcript
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {lines.length === 0 && (
          <p className="text-sm text-muted-foreground">Waiting for speech…</p>
        )}
        {lines.map((line, i) => (
          <div key={i} className="text-sm">
            <span
              className={cn(
                "mr-2 font-mono text-xs",
                line.isAgent ? "text-primary" : "text-muted-foreground"
              )}
            >
              {line.isAgent ? "agent" : line.identity}
            </span>
            <span className="text-foreground/90">{line.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

/* ────────────────────────────────────
   Tab: Audio
   ──────────────────────────────────── */
function AudioTab({
  live,
  agentName,
  agentTrack,
  micTrack,
  micMuted,
  recordings,
  recording,
  uploading,
  unsupported,
  onDeleted,
}: {
  live: boolean;
  agentName: string;
  agentTrack?: MediaStreamTrack;
  micTrack?: MediaStreamTrack;
  micMuted: boolean;
  recordings: SavedRecording[];
  recording: boolean;
  uploading: boolean;
  unsupported: boolean;
  onDeleted: (file: string) => void;
}) {
  return (
    <div className="space-y-4 p-4">
      {/* Live scopes — real samples off each track, not a state animation. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
              Agent output
            </span>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {agentTrack ? "receiving" : live ? "waiting" : "idle"}
            </Badge>
          </div>
          <AudioScope track={agentTrack} color="#22c55e" label="agent · tts" />
        </div>
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
              Your microphone
            </span>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {!micTrack ? (live ? "not published" : "idle") : micMuted ? "muted" : "live"}
            </Badge>
          </div>
          <AudioScope track={micMuted ? undefined : micTrack} color="#38bdf8" label="you · mic" />
        </div>
      </div>

      {/* Saved audio */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            Saved session audio
          </span>
          <span className="h-px flex-1 bg-border" />
          {recording && (
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-red-500">
              <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
              recording
            </span>
          )}
          {uploading && (
            <span className="text-[10px] font-mono uppercase text-muted-foreground">saving…</span>
          )}
        </div>

        {unsupported && (
          <p className="text-xs text-yellow-500">
            This browser has no MediaRecorder support, so session audio cannot be saved.
          </p>
        )}

        {recordings.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {live
              ? "Recording this session — the agent audio and the mixed conversation are saved when it ends."
              : "No saved audio yet. Start a session; both the agent output and the mixed conversation are written to disk when it ends."}
          </p>
        ) : (
          <div className="space-y-2">
            {recordings.map((r) => (
              <RecordingRow
                key={r.file}
                agentName={agentName}
                recording={r}
                onDeleted={onDeleted}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecordingRow({
  agentName,
  recording,
  onDeleted,
}: {
  agentName: string;
  recording: SavedRecording;
  onDeleted: (file: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const src = `/api/agents/${encodeURIComponent(agentName)}/recordings/${encodeURIComponent(recording.file)}`;

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/recordings`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: recording.file }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to delete");
        return;
      }
      onDeleted(recording.file);
    } catch {
      setError("Failed to delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={recording.kind === "agent" ? "secondary" : "outline"}
          className="text-[10px] uppercase"
        >
          {recording.kind === "agent" ? "agent only" : "mixed"}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80" title={recording.room}>
          {recording.room}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatDuration(recording.durationMs)} · {formatBytes(recording.bytes)} ·{" "}
          {new Date(recording.createdAt).toLocaleString()}
        </span>
        <Button variant="ghost" size="icon-xs" asChild title="Download">
          <a href={src} download={recording.file}>
            <Download className="size-3.5" />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive"
          onClick={remove}
          disabled={busy}
          title="Delete"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </Button>
      </div>
      <audio src={src} controls preload="metadata" className="mt-2 h-8 w-full" />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ────────────────────────────────────
   Tab: Events
   ──────────────────────────────────── */
function EventsTab({
  events,
  live,
  timelineOn,
  onTimelineToggle,
  agentName,
  roomName,
  recordings,
}: {
  events: ConsoleEvent[];
  live: boolean;
  timelineOn: boolean;
  onTimelineToggle: (on: boolean) => void;
  agentName: string;
  roomName: string | null;
  recordings: SavedRecording[];
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const autoScroll = live;
  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ block: "end" });
  }, [events.length, autoScroll]);

  const audio = useTimelineAudio({ agentName, roomName, recordings });

  if (events.length === 0) return <DockEmpty>No events received yet</DockEmpty>;

  return (
    <div className="p-2 font-mono text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2 px-2">
        {timelineOn && (
          <TimelineTransport audio={audio} live={live} recordings={recordings} />
        )}
        <div className="ml-auto flex items-center gap-2">
          <Label
            htmlFor="events-timeline"
            className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            Timeline
          </Label>
          <Switch id="events-timeline" checked={timelineOn} onCheckedChange={onTimelineToggle} />
        </div>
      </div>

      {timelineOn && (
        <EventTimeline
          events={events}
          live={live}
          className="mb-3"
          audioWindow={audio.window}
          playheadAt={audio.playheadAt}
          onSeek={audio.selected ? audio.seekTo : undefined}
        />
      )}

      {events.map((e) => {
        const active =
          audio.playheadAt != null &&
          Math.abs(e.at - audio.playheadAt) <= TIMELINE_ACTIVE_WINDOW_MS;
        const seekable = audio.canSeekTo(e.at);
        return (
          <div
            key={e.id}
            role={seekable ? "button" : undefined}
            tabIndex={seekable ? 0 : undefined}
            onClick={seekable ? () => audio.seekTo(e.at) : undefined}
            onKeyDown={
              seekable
                ? (ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      audio.seekTo(e.at);
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
            <span className="shrink-0 text-muted-foreground">{formatClock(e.at)}</span>
            <span
              className={cn(
                "w-[190px] shrink-0",
                e.level === "error"
                  ? "text-destructive"
                  : e.level === "warn"
                    ? "text-yellow-500"
                    : "text-primary"
              )}
            >
              {e.name}
            </span>
            <span className="min-w-0 break-all text-foreground/80">{e.detail}</span>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

/* ────────────────────────────────────
   Events tab: audio synced to the timeline
   ──────────────────────────────────── */
type TimelineAudio = ReturnType<typeof useTimelineAudio>;

function useTimelineAudio({
  agentName,
  roomName,
  recordings,
}: {
  agentName: string;
  roomName: string | null;
  recordings: SavedRecording[];
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
      ofRoom.find((r) => r.kind === "mixed") ??
      ofRoom[0] ??
      recordings.find((r) => r.kind === "mixed") ??
      recordings[0] ??
      null
    );
  }, [chosenFile, recordings, roomName]);

  const startMs = selected ? new Date(selected.startedAt).getTime() : null;
  const durationMs = selected?.durationMs ?? 0;

  const src = selected
    ? `/api/agents/${encodeURIComponent(agentName)}/recordings/${encodeURIComponent(selected.file)}`
    : null;

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
    (at: number) =>
      startMs !== null && at >= startMs - 1000 && at <= startMs + durationMs + 1000,
    [startMs, durationMs]
  );

  const toggle = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const nudge = useCallback((deltaMs: number) => {
    const el = elRef.current;
    if (!el) return;
    seekMs(el.currentTime * 1000 + deltaMs);
  }, [seekMs]);

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

function TimelineTransport({
  audio,
  live,
  recordings,
}: {
  audio: TimelineAudio;
  live: boolean;
  recordings: SavedRecording[];
}) {
  if (!audio.selected) {
    return (
      <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        {live ? "recording — audio syncs here when the session ends" : "no session audio saved yet"}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button variant="outline" size="icon-xs" onClick={() => audio.nudge(-5000)} title="Back 5s">
        <SkipBack className="size-3.5" />
      </Button>
      <Button variant="outline" size="icon-xs" onClick={audio.toggle} title={audio.playing ? "Pause" : "Play"}>
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
                {r.kind === "agent" ? "Agent only" : "Mixed"} · {r.room.slice(-13)} ·{" "}
                {formatDuration(r.durationMs)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/** mm:ss.t — a tenth of a second matters when lining up against events. */
function formatClockMs(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const tenth = Math.floor((total * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${tenth}`;
}

/* ────────────────────────────────────
   Tab: Session
   ──────────────────────────────────── */
function SessionTab({
  roomName,
  roomSid,
  room,
  serverUrl,
  connectionState,
  startedAt,
  endedAt,
  duration,
  agentIdentity,
  agentState,
  participants,
}: {
  roomName: string | null;
  roomSid: string | null;
  room: ReturnType<typeof useRoomContext> | null;
  serverUrl: string;
  connectionState: ConnectionState;
  startedAt: number | null;
  endedAt: number | null;
  duration: number | null;
  agentIdentity?: string;
  agentState: string;
  participants: number;
}) {
  if (!startedAt) return <DockEmpty>Start a session to view details</DockEmpty>;

  const rows: [string, string][] = [
    ["Room name", roomName ?? "—"],
    ["Room SID", roomSid ?? "—"],
    ["Connection state", String(connectionState)],
    ["Started", new Date(startedAt).toLocaleString()],
    ["Ended", endedAt ? new Date(endedAt).toLocaleString() : "—"],
    ["Duration", duration === null ? "—" : formatDuration(duration)],
    ["Participants", String(participants)],
    ["Agent identity", agentIdentity ?? "—"],
    ["Agent state", agentState],
    ["Local identity", room?.localParticipant?.identity ?? "—"],
    ["Server URL", serverUrl],
  ];

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 p-4 text-sm md:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-4 border-b border-border/50 pb-1.5">
          <span className="text-muted-foreground">{k}</span>
          <span className="min-w-0 break-all text-right font-mono text-xs text-foreground/80">{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────
   Tab: Participants
   ──────────────────────────────────── */
function ParticipantsTab() {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  const [name, setName] = useState("");
  const [metadata, setMetadata] = useState("{}");
  const [attributes, setAttributes] = useState<{ key: string; value: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const apply = async () => {
    if (!localParticipant) return;
    setSaving(true);
    setSaveError("");
    try {
      if (name.trim()) await localParticipant.setName(name.trim());
      if (metadata.trim() && metadata.trim() !== "{}") {
        await localParticipant.setMetadata(metadata.trim());
      }
      const attrs = attributes.reduce<Record<string, string>>((acc, a) => {
        if (a.key.trim()) acc[a.key.trim()] = a.value;
        return acc;
      }, {});
      if (Object.keys(attrs).length > 0) await localParticipant.setAttributes(attrs);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs font-mono uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Identity</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Kind</th>
              <th className="px-4 py-2 font-medium">SID</th>
            </tr>
          </thead>
          <tbody>
            {participants.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No participants — start a session
                </td>
              </tr>
            )}
            {participants.map((p) => (
              <tr key={p.sid || p.identity} className="border-b last:border-0">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-foreground/80">{p.identity}</span>
                    {p.isLocal && (
                      <Badge variant="secondary" className="text-[10px]">
                        YOU
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-foreground/70">{p.name || "—"}</td>
                <td className="px-4 py-2">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {p.isAgent ? "agent" : "standard"}
                  </Badge>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {p.sid || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Inspector for your own participant */}
      <div className="w-[320px] shrink-0 space-y-3 overflow-y-auto border-l p-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-foreground/70">Display name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={localParticipant?.name || "my-name"}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-foreground/70">Metadata</Label>
          <textarea
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-foreground/70">Attributes</Label>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setAttributes((a) => [...a, { key: "", value: "" }])}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          {attributes.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={a.key}
                onChange={(e) =>
                  setAttributes((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x))
                  )
                }
                placeholder="key"
                className="h-7 text-xs"
              />
              <Input
                value={a.value}
                onChange={(e) =>
                  setAttributes((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x))
                  )
                }
                placeholder="value"
                className="h-7 text-xs"
              />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setAttributes((prev) => prev.filter((_, j) => j !== i))}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        <Button
          size="sm"
          className="w-full"
          disabled={!localParticipant || saving}
          onClick={apply}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Update your participant details
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────
   Tab: RPC
   ──────────────────────────────────── */
function RpcTab({ agentIdentity, live }: { agentIdentity?: string; live: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const [destination, setDestination] = useState("");
  const [method, setMethod] = useState("");
  const [payload, setPayload] = useState("{}");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (agentIdentity && !destination) setDestination(agentIdentity);
  }, [agentIdentity, destination]);

  if (!live) return <DockEmpty>RPC requires an active session</DockEmpty>;

  const invoke = async () => {
    if (!localParticipant) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await localParticipant.performRpc({
        destinationIdentity: destination,
        method,
        payload,
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-foreground/70">Destination identity</Label>
          <Input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="agent identity"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-foreground/70">Method</Label>
          <Input
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="my.method"
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-foreground/70">Payload</Label>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
        />
      </div>
      <Button size="sm" onClick={invoke} disabled={busy || !destination || !method}>
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        Invoke
      </Button>
      {error && (
        <pre className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/10 p-2 font-mono text-xs text-destructive">
          {error}
        </pre>
      )}
      {result !== null && (
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-mono text-xs text-foreground/80">
          {result || "(empty response)"}
        </pre>
      )}
    </div>
  );
}

/* ────────────────────────────────────
   Tab: DTMF
   ──────────────────────────────────── */
const DTMF_KEYS = [
  ["1", 1], ["2", 2], ["3", 3],
  ["4", 4], ["5", 5], ["6", 6],
  ["7", 7], ["8", 8], ["9", 9],
  ["*", 10], ["0", 0], ["#", 11],
] as const;

function DtmfTab({
  live,
  onAddEvent,
}: {
  live: boolean;
  onAddEvent: (name: string, detail: string, level?: ConsoleEvent["level"]) => void;
}) {
  const { localParticipant } = useLocalParticipant();
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");

  if (!live) return <DockEmpty>DTMF requires an active session</DockEmpty>;

  const press = async (digit: string, code: number) => {
    if (!localParticipant) return;
    setError("");
    try {
      await localParticipant.publishDtmf(code, digit);
      setSent((s) => s + digit);
      onAddEvent("dtmf.sent", digit);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex items-start gap-6 p-4">
      <div className="grid w-[180px] grid-cols-3 gap-2">
        {DTMF_KEYS.map(([digit, code]) => (
          <Button
            key={digit}
            variant="outline"
            className="h-11 font-mono text-base"
            onClick={() => press(digit, code)}
          >
            {digit}
          </Button>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
          Sent digits
        </div>
        <div className="min-h-8 rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-sm text-foreground/80">
          {sent || "—"}
        </div>
        <p className="max-w-sm text-xs text-muted-foreground">
          DTMF tones are delivered to SIP participants in the room. A web-only session
          has nothing to receive them.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {sent && (
          <Button variant="ghost" size="sm" onClick={() => setSent("")}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────
   Tab: Metrics (+ per-turn tracing)
   ──────────────────────────────────── */
function MetricsTab({ metrics, live }: { metrics: ConsoleMetric[]; live: boolean }) {
  const traces = useMemo(() => buildTurnTraces(metrics), [metrics]);

  const ttfts = metrics.filter((m) => m.kind === "llm" && m.ttft !== undefined).map((m) => m.ttft!);
  const ttfbs = metrics.filter((m) => m.kind === "tts" && m.ttfb !== undefined).map((m) => m.ttfb!);
  const totals = traces.map((t) => t.total).filter((t) => t > 0);

  if (metrics.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
          No metrics received yet
        </span>
        <p className="max-w-lg text-xs text-muted-foreground">
          Metrics arrive on the <code className="font-mono">{CONSOLE_METRICS_TOPIC}</code> room
          topic. An agent deployed before console metrics existed does not publish them —
          open it in the Builder and deploy again.
          {live ? " Speak to the agent to produce the first turn." : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="LLM TTFT p50" value={formatSeconds(percentile(ttfts, 50))} />
        <StatTile label="LLM TTFT p90" value={formatSeconds(percentile(ttfts, 90))} />
        <StatTile label="TTS TTFB p50" value={formatSeconds(percentile(ttfbs, 50))} />
        <StatTile label="Turn latency p90" value={formatSeconds(percentile(totals, 90))} />
      </div>

      {/* Tracing */}
      {traces.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-3 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            <span>Turn latency</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-sky-500" /> EOU</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-violet-500" /> LLM TTFT</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-amber-500" /> TTS TTFB</span>
          </div>
          <div className="space-y-1.5">
            {traces.map((t) => {
              const scale = Math.max(...traces.map((x) => x.total), 0.001);
              const pct = (v?: number) => ((v ?? 0) / scale) * 100;
              return (
                <div key={t.speechId} className="flex items-center gap-3">
                  <span className="w-[92px] shrink-0 truncate font-mono text-xs text-muted-foreground" title={t.speechId}>
                    {t.speechId.slice(0, 12)}
                  </span>
                  <div className="flex h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
                    <div className="bg-sky-500" style={{ width: `${pct(t.eou)}%` }} title={`EOU ${formatSeconds(t.eou)}`} />
                    <div className="bg-violet-500" style={{ width: `${pct(t.ttft)}%` }} title={`TTFT ${formatSeconds(t.ttft)}`} />
                    <div className="bg-amber-500" style={{ width: `${pct(t.ttfb)}%` }} title={`TTFB ${formatSeconds(t.ttfb)}`} />
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

      {/* Raw rows */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left font-mono uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Time</th>
              <th className="px-2 py-1.5 font-medium">Type</th>
              <th className="px-2 py-1.5 font-medium">Label</th>
              <th className="px-2 py-1.5 font-medium">TTFT / TTFB</th>
              <th className="px-2 py-1.5 font-medium">Duration</th>
              <th className="px-2 py-1.5 font-medium">Audio</th>
              <th className="px-2 py-1.5 font-medium">Tokens</th>
              <th className="px-2 py-1.5 font-medium">TPS</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {[...metrics].reverse().map((m) => (
              <tr key={m.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-2 py-1.5 text-muted-foreground">{formatClock(m.at)}</td>
                <td className="px-2 py-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {METRIC_KIND_LABEL[m.kind]}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 text-foreground/70">{m.label}</td>
                <td className="px-2 py-1.5 text-foreground/80">
                  {m.kind === "llm"
                    ? formatSeconds(m.ttft)
                    : m.kind === "tts"
                      ? formatSeconds(m.ttfb)
                      : m.kind === "eou"
                        ? formatSeconds(m.endOfUtteranceDelay)
                        : "—"}
                </td>
                <td className="px-2 py-1.5 text-foreground/70">{formatSeconds(m.duration)}</td>
                <td className="px-2 py-1.5 text-foreground/70">{formatSeconds(m.audioDuration)}</td>
                <td className="px-2 py-1.5 text-foreground/70">
                  {m.promptTokens !== undefined || m.completionTokens !== undefined
                    ? `${formatCount(m.promptTokens)} → ${formatCount(m.completionTokens)}`
                    : "—"}
                </td>
                <td className="px-2 py-1.5 text-foreground/70">
                  {m.tokensPerSecond !== undefined ? m.tokensPerSecond.toFixed(1) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg text-foreground">{value}</div>
    </div>
  );
}

/* ────────────────────────────────────
   Tab: Models (usage)
   ──────────────────────────────────── */
function ModelsTab({
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
                  <td className="px-2 py-1.5 text-foreground/70">{formatCount(u.completionTokens)}</td>
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

/* ────────────────────────────────────
   Console configuration dialog
   ──────────────────────────────────── */
function ConfigureDialog({
  open,
  options,
  live,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  options: JoinOptions;
  live: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (o: JoinOptions) => void;
}) {
  const [draft, setDraft] = useState<JoinOptions>(options);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Console configuration</DialogTitle>
          <DialogDescription>
            Applied when the next session starts — the values are baked into the join
            token and the room.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {live && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              A session is running. End it and start a new one for these to take effect.
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Your display name</Label>
            <Input
              value={draft.participantName}
              onChange={(e) => setDraft({ ...draft, participantName: e.target.value })}
              placeholder="my-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Participant metadata</Label>
            <textarea
              value={draft.participantMetadata}
              onChange={(e) => setDraft({ ...draft, participantMetadata: e.target.value })}
              rows={2}
              placeholder="{}"
              className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Room metadata</Label>
            <textarea
              value={draft.roomMetadata}
              onChange={(e) => setDraft({ ...draft, roomMetadata: e.target.value })}
              rows={2}
              placeholder="{}"
              className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            Save configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
