"use client";

/* ────────────────────────────────────────────────────────────────────────────
   Agent Console — monitor, test and debug one agent live.

   The page always mounts a LiveKitRoom (with connect={false} until a session
   starts) so every panel can read room context without a second code path for
   the idle state. Events, metrics and transcript are accumulated in the outer
   component so they survive the session ending, until "Clear events" — and are
   posted to the session history when it ends, by useSessionPersistence.

   Panels that are not about a *live* room — the transcript, the event log and
   timeline, saved audio, metrics, model usage — live in
   components/livekit/console/ and are shared with the replay view at
   /sessions/history/[id]. What stays here needs the room: the voice stage, the
   SIP panel and participants.
   ──────────────────────────────────────────────────────────────────────────── */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  BarVisualizer,
  VoiceAssistantControlBar,
  useVoiceAssistant,
  useRoomContext,
  useParticipants,
  useLocalParticipant,
  useTracks,
  useTranscriptions,
  useChat,
} from "@livekit/components-react";
import "@livekit/components-styles";
import {
  ConnectionState,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type TrackPublication,
} from "livekit-client";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mic,
  Phone,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Play,
  Settings2,
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
import { cn } from "@/lib/utils";
import { AudioScope } from "@/components/livekit/console/audio-scope";
import { rulesAnswering, type DispatchRuleSummary } from "@/lib/sip-loopback";
import {
  useSessionRecorder,
  type SavedRecording,
} from "@/components/livekit/console/use-session-recorder";
import { useSessionPersistence } from "@/components/livekit/console/use-session-persistence";
import { EventsPanel } from "@/components/livekit/console/events-panel";
import { useRuntimeConfig } from "@/components/runtime-config-provider";
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
  formatBytes,
  type AgentConfigView,
  type ConsoleEvent,
  type TranscriptLine,
} from "@/components/livekit/console/session-types";
import {
  CONSOLE_METRICS_TOPIC,
  formatDuration,
  parseConsoleMetric,
  type ConsoleMetric,
} from "@/lib/console-metrics";

const TABS = [
  "Audio",
  "Events",
  "Session",
  "Participants",
  "Metrics",
  "Models",
] as const;
type Tab = (typeof TABS)[number];

/**
 * Upper bound on what the console keeps in memory. A long call with a chatty
 * agent can emit metrics continuously; the oldest entries fall off.
 */
const BUFFER_LIMIT = 5000;

function capped<T>(items: T[]): T[] {
  return items.length > BUFFER_LIMIT ? items.slice(-BUFFER_LIMIT) : items;
}

/** `?tab=metrics` → "Metrics"; anything unknown falls back to the first tab. */
function parseTab(value: string | null): Tab {
  const match = TABS.find((t) => t.toLowerCase() === value?.toLowerCase());
  return match ?? "Audio";
}

/**
 * How you speak to the agent.
 *
 * `browser` publishes your microphone into the room. `sip` means *you* place
 * the call: you dial one of this deployment's inbound numbers from a phone, the
 * dispatch rule puts the agent in the room, and the console attaches to that
 * room to watch, trace and record — without publishing audio of its own.
 */
type TalkMode = "browser" | "sip";

function parseTalkMode(value: string | null): TalkMode {
  return value?.toLowerCase() === "sip" ? "sip" : "browser";
}

interface AgentListEntry {
  agentName: string;
  status: string;
  running: boolean;
}

interface JoinOptions {
  participantName: string;
  participantMetadata: string;
  roomMetadata: string;
}

/** A live SIP call, as reported by /api/calls. */
interface LiveCall {
  callId: string;
  roomName: string;
  from: string | null;
  to: string | null;
  direction: string | null;
  status: string;
  startedAt: string | null;
}

/** An inbound number to dial, and who the dispatch rules will put on the line. */
interface DialInTarget {
  number: string;
  trunk: string;
  trunkId: string;
  agents: string[];
  ruleName: string | null;
}

interface OutboundTrunk {
  trunkId: string;
  name: string;
  address?: string;
}

/**
 * The phone leg attached to this session.
 *
 * Direction decides what hanging up means: a call the console placed is torn
 * down with the room, while a call that came *in* is only left — the person on
 * the other end owns it.
 */
interface SipCall {
  room: string;
  peer: string;
  direction: "out" | "in";
}

/** Set on transcription text streams; segments of one utterance share it. */
const SEGMENT_ID_ATTRIBUTE = "lk.segment_id";

/**
 * When an utterance started. The sender stamps the stream with its own
 * `Date.now()`, which is accurate — agents run on this machine — and earlier
 * than the moment the text arrives here. Fall back to local arrival if that
 * clock is implausible, because a wrong timestamp would drag the whole
 * timeline out of shape.
 */
function utteranceStart(sentAt: number): number {
  const now = Date.now();
  return sentAt > 0 && Math.abs(now - sentAt) <= 60_000 ? sentAt : now;
}

/* ────────────────────────────────────
   Page
   ──────────────────────────────────── */
export default function AgentConsolePageRoute() {
  // useSearchParams (the dock tab) needs a boundary to fall back to.
  return (
    <Suspense fallback={null}>
      <AgentConsolePage />
    </Suspense>
  );
}

function AgentConsolePage() {
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
  const [transcriptOn, setTranscriptOn] = useState(true);

  // The dock tab and talk mode live in the URL so a view can be linked and
  // survives a reload.
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const talkMode = parseTalkMode(searchParams.get("talk"));

  const setQueryParam = useCallback(
    (key: string, value: string) => {
      const query = new URLSearchParams(searchParams.toString());
      query.set(key, value);
      router.replace(`?${query.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );
  const setTab = useCallback(
    (next: Tab) => setQueryParam("tab", next.toLowerCase()),
    [setQueryParam]
  );
  const setTalkMode = useCallback(
    (next: TalkMode) => setQueryParam("talk", next),
    [setQueryParam]
  );

  const [dockOpen, setDockOpen] = useState(true);
  const [dockHeight, setDockHeight] = useState(DEFAULT_DOCK_HEIGHT);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [joinOptions, setJoinOptions] = useState<JoinOptions>({
    participantName: "",
    participantMetadata: "",
    roomMetadata: "",
  });

  // SIP mode: place a call into this session, or wait for one to arrive.
  const [dialInTargets, setDialInTargets] = useState<DialInTarget[]>([]);
  const [outboundTrunks, setOutboundTrunks] = useState<OutboundTrunk[]>([]);
  const [waitingForCall, setWaitingForCall] = useState(false);
  const [sipCall, setSipCall] = useState<SipCall | null>(null);
  /**
   * Whether the stage shows the dialler or the last call's transcript. It flips
   * to the transcript when a call ends, because reading what just happened is
   * the point of hanging up.
   */
  const [sipPanelOpen, setSipPanelOpen] = useState(true);

  const seqRef = useRef(0);

  const { livekitUrl: serverUrl } = useRuntimeConfig();

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
      setEvents((prev) => capped([...prev, { id, at: Date.now(), name, detail, level }]));
    },
    []
  );

  const addMetric = useCallback((raw: unknown) => {
    seqRef.current += 1;
    const metric = parseConsoleMetric(raw, Date.now(), seqRef.current);
    if (metric) setMetrics((prev) => capped([...prev, metric]));
  }, []);

  // "Clear events" resets the whole console for this agent, including the audio
  // saved on disk — so it asks first. Success is silent: the panels emptying is
  // the feedback. Only audio that survived the clear needs saying, in the same
  // banner the rest of the console uses.
  const clearEverything = useCallback(async () => {
    setEvents([]);
    setMetrics([]);
    setTranscript([]);
    setError(null);

    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/recordings`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          `Events cleared, but the saved audio was kept: ${
            data.error === "Insufficient permissions"
              ? "only an admin or owner can delete recordings."
              : data.error || "the recordings could not be deleted."
          }`
        );
        return;
      }
      setRecordings([]);
    } catch {
      setError("Events cleared, but the saved audio was kept: the dashboard API is unreachable.");
    }
  }, [agentName]);

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
  /**
   * Creates the room, dispatches the agent and joins with the mic live. Returns
   * the room so a caller (the SIP dialler) can act on it without waiting for a
   * re-render.
   */
  const startSession = useCallback(
    async (): Promise<string | null> => {
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
          return null;
        }
        setToken(data.token);
        setRoomName(data.room);
        setStartedAt(Date.now());
        addEvent("session.dispatched", `${data.agent} → ${data.room}`);
        return data.room as string;
      } catch {
        setError("Could not reach the dashboard API");
        addEvent("session.start_failed", "Could not reach the dashboard API", "error");
        return null;
      } finally {
        setConnecting(false);
      }
    },
    [agentName, joinOptions, addEvent]
  );

  /**
   * Ends the session. A call the console placed is hung up with the room —
   * leaving would strand the phone leg and the agent talking to each other. A
   * call that came in is only left: it is someone else's call.
   */
  const endSession = useCallback(async () => {
    const call = sipCall;
    setToken(null);
    setEndedAt(Date.now());
    setWaitingForCall(false);
    setSipCall(null);
    setSipPanelOpen(false);

    if (call?.direction === "out") {
      try {
        await fetch("/api/calls/place", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: call.room }),
        });
        addEvent("sip.hung_up", call.peer);
      } catch {
        addEvent("sip.hangup_failed", call.room, "warn");
      }
    }
  }, [sipCall, addEvent]);

  /**
   * Places a call into this console session: the room is created and the agent
   * dispatched first, so it is already on the line when the callee answers.
   */
  const placeCall = useCallback(
    async ({ callTo, trunkId }: { callTo: string; trunkId?: string }) => {
      const room = token && roomName ? roomName : await startSession();
      if (!room) return;

      setConnecting(true);
      setError(null);
      try {
        const res = await fetch("/api/calls/place", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callTo,
            trunkId,
            roomName: room,
            // The dial tone is published into the room, so the agent would hear
            // it ringing and its VAD would treat it as speech. The stage says
            // "Calling …" instead.
            playDialtone: false,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message = data.reason || data.error || `Dial failed (HTTP ${res.status})`;
          setError(message);
          addEvent("sip.dial_failed", message, "error");
          return;
        }
        setSipCall({ room, peer: data.callTo, direction: "out" });
        // The stage says "Calling …" and the event log carries the call id, so
        // there is nothing left for a notification to add.
        addEvent("sip.dialled", `${data.callTo}${data.sipCallId ? ` (${data.sipCallId})` : ""}`);
      } catch {
        setError("Could not reach the dashboard API");
      } finally {
        setConnecting(false);
      }
    },
    [token, roomName, startSession, addEvent]
  );

  const live = !!token;

  /** Attaches the console to a call that is already up, as a silent observer. */
  const attachToCall = useCallback(
    async (call: LiveCall) => {
      setConnecting(true);
      setError(null);
      setEndedAt(null);
      try {
        const res = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "observe",
            room: call.roomName,
            participantName: joinOptions.participantName || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.token) {
          setError(data.error || "Could not join the call");
          addEvent("call.attach_failed", data.error || `HTTP ${res.status}`, "error");
          return;
        }
        setToken(data.token);
        setRoomName(call.roomName);
        setStartedAt(call.startedAt ? new Date(call.startedAt).getTime() : Date.now());
        setSipCall({ room: call.roomName, peer: call.from ?? "caller", direction: "in" });
        setWaitingForCall(false);
        addEvent("call.attached", `${call.from ?? "caller"} → ${call.roomName}`);
      } catch {
        setError("Could not reach the dashboard API");
      } finally {
        setConnecting(false);
      }
    },
    [joinOptions.participantName, addEvent]
  );

  // While waiting, watch for a SIP call to arrive and jump into its room. The
  // console's own rooms are skipped: those are browser sessions, not calls in.
  useEffect(() => {
    if (!waitingForCall || live) return;

    let cancelled = false;
    const poll = () => {
      fetch("/api/calls")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled || !data?.calls?.length) return;
          // Newest first from the API. Skip the console's own rooms, and prefer
          // a call LiveKit marked inbound when an outbound test is also running.
          const candidates = (data.calls as LiveCall[]).filter(
            (c) => !c.roomName.startsWith("agent-console-")
          );
          const call = candidates.find((c) => c.direction === "inbound") ?? candidates[0];
          if (call) void attachToCall(call);
        })
        .catch(() => {});
    };

    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [waitingForCall, live, attachToCall]);

  // Numbers to dial in on, with whoever the dispatch rules will put on the line.
  useEffect(() => {
    if (talkMode !== "sip") return;

    fetch("/api/sip-trunks?direction=outbound")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOutboundTrunks(d?.trunks ?? []))
      .catch(() => {});

    Promise.all([
      fetch("/api/sip-trunks?direction=inbound").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/dispatch-rules").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([trunkData, ruleData]) => {
        const rules: DispatchRuleSummary[] = ruleData?.rules ?? [];
        const targets: DialInTarget[] = (trunkData?.trunks ?? []).flatMap(
          (t: { name: string; trunkId: string; numbers?: string[] }) =>
            (t.numbers ?? []).map((number: string) => {
              const matched = rulesAnswering(rules, t.trunkId, number);
              const withAgent = matched.find((r) => r.agents.length > 0);
              return {
                number,
                trunk: t.name || t.trunkId,
                trunkId: t.trunkId,
                agents: withAgent?.agents ?? [],
                ruleName: (withAgent ?? matched[0])?.name ?? null,
              };
            })
        );
        setDialInTargets(targets);
      })
      .catch(() => {});
  }, [talkMode]);

  return (
    // Keyed on the room: a new session gets a fresh Room (and fresh transcript /
    // participant state), while ending one leaves the last session on screen.
    // Events and metrics live above this, so they survive until "Clear events".
    <LiveKitRoom
      key={roomName ?? "idle"}
      token={token ?? undefined}
      serverUrl={serverUrl}
      connect={live}
      // SIP mode keeps the console silent: you are on the phone, and publishing
      // the browser mic as well would only feed the agent an echo.
      audio={talkMode === "browser"}
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
        transcriptOn={transcriptOn}
        tab={tab}
        dockOpen={dockOpen}
        dockHeight={dockHeight}
        joinOptions={joinOptions}
        talkMode={talkMode}
        dialInTargets={dialInTargets}
        outboundTrunks={outboundTrunks}
        waitingForCall={waitingForCall}
        sipCall={sipCall}
        sipPanelOpen={sipPanelOpen}
        onTalkModeChange={setTalkMode}
        onWaitForCall={() => setWaitingForCall((w) => !w)}
        onPlaceCall={(input) => void placeCall(input)}
        onOpenSipPanel={() => setSipPanelOpen(true)}
        onShowTranscript={() => setSipPanelOpen(false)}
        onTabChange={setTab}
        onDockToggle={() => setDockOpen((o) => !o)}
        onDockResize={setDockHeight}
        onStart={() => void startSession()}
        onEnd={endSession}
        onClear={() => setClearOpen(true)}
        onAddEvent={addEvent}
        onAddMetric={addMetric}
        onTranscript={setTranscript}
        onRecordingSaved={recordingSaved}
        onRecordingDeleted={recordingDeleted}
        onTimelineToggle={setTimelineOn}
        onTranscriptToggle={setTranscriptOn}
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

      <ClearDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        events={events.length}
        metrics={metrics.length}
        transcript={transcript.length}
        recordings={recordings}
        onConfirm={async () => {
          setClearOpen(false);
          await clearEverything();
        }}
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
  transcriptOn,
  tab,
  dockOpen,
  dockHeight,
  joinOptions,
  talkMode,
  dialInTargets,
  outboundTrunks,
  waitingForCall,
  sipCall,
  sipPanelOpen,
  onTalkModeChange,
  onWaitForCall,
  onPlaceCall,
  onOpenSipPanel,
  onShowTranscript,
  onTabChange,
  onDockToggle,
  onDockResize,
  onStart,
  onEnd,
  onClear,
  onAddEvent,
  onAddMetric,
  onTranscript,
  onRecordingSaved,
  onRecordingDeleted,
  onTimelineToggle,
  onTranscriptToggle,
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
  transcriptOn: boolean;
  tab: Tab;
  dockOpen: boolean;
  dockHeight: number;
  joinOptions: JoinOptions;
  talkMode: TalkMode;
  dialInTargets: DialInTarget[];
  outboundTrunks: OutboundTrunk[];
  waitingForCall: boolean;
  sipCall: SipCall | null;
  sipPanelOpen: boolean;
  onTalkModeChange: (mode: TalkMode) => void;
  onWaitForCall: () => void;
  onPlaceCall: (input: { callTo: string; trunkId?: string }) => void;
  onOpenSipPanel: () => void;
  onShowTranscript: () => void;
  onTabChange: (t: Tab) => void;
  onDockToggle: () => void;
  onDockResize: (height: number) => void;
  onStart: () => void;
  onEnd: () => void;
  onClear: () => void;
  onAddEvent: (name: string, detail: string, level?: ConsoleEvent["level"]) => void;
  onAddMetric: (raw: unknown) => void;
  onTranscript: (lines: TranscriptLine[]) => void;
  onRecordingSaved: (recording: SavedRecording) => void;
  onRecordingDeleted: (file: string) => void;
  onTimelineToggle: (on: boolean) => void;
  onTranscriptToggle: (on: boolean) => void;
  onConfigure: () => void;
  onAgentChange: (name: string) => void;
}) {
  const { livekitRegion } = useRuntimeConfig();
  const room = useRoomContext();
  const { state: agentState, agent, audioTrack } = useVoiceAssistant();
  const participants = useParticipants();
  const transcriptions = useTranscriptions();
  // Typed messages are chat, not transcription: without this a text-only
  // conversation records as the agent talking to nobody.
  const { chatMessages, send: sendChat, isSending } = useChat();
  const { microphoneTrack, localParticipant } = useLocalParticipant();

  const connectionState = room?.state ?? ConnectionState.Disconnected;
  const connected = connectionState === ConnectionState.Connected;

  // The hook resets its buffer when the room goes away, so mirror it upwards
  // where it outlives the session.
  const agentIdentity = agent?.identity;
  // A segment's text keeps growing as it streams, so its timestamp has to be
  // pinned the first time the segment is seen — otherwise every line would read
  // as "now" and none of them would line up with the event log or the recording.
  const spokenAtRef = useRef(new Map<string, number>());
  useEffect(() => {
    if (transcriptions.length === 0 && chatMessages.length === 0) return;
    const spokenAt = spokenAtRef.current;

    const spoken: TranscriptLine[] = transcriptions.map((t) => {
      const id = t.streamInfo.attributes?.[SEGMENT_ID_ATTRIBUTE] ?? t.streamInfo.id;
      let at = spokenAt.get(id);
      if (at === undefined) {
        at = utteranceStart(t.streamInfo.timestamp);
        spokenAt.set(id, at);
      }
      return {
        id,
        at,
        identity: t.participantInfo.identity,
        text: t.text,
        isAgent: !!agentIdentity && t.participantInfo.identity === agentIdentity,
        via: "voice",
      };
    });

    // A chat message arrives whole and is never revised, so its own timestamp
    // is the moment it was sent.
    const typed: TranscriptLine[] = chatMessages.map((m) => ({
      id: `chat-${m.id}`,
      at: m.timestamp,
      identity: m.from?.identity ?? "you",
      text: m.message,
      isAgent: !!agentIdentity && m.from?.identity === agentIdentity,
      via: "text",
    }));

    onTranscript([...spoken, ...typed].sort((a, b) => a.at - b.at));
  }, [transcriptions, chatMessages, agentIdentity, onTranscript]);

  // ── Session audio: raw media tracks for the scopes and the recorder ──
  const agentMediaTrack = audioTrack?.publication?.track?.mediaStreamTrack;
  const micMediaTrack = microphoneTrack?.track?.mediaStreamTrack;

  // A dialled phone is a remote participant that isn't the agent. Its audio is
  // the user side of the conversation, so scopes and recordings must include it.
  const remoteMics = useTracks([Track.Source.Microphone], { onlySubscribed: true });
  const callerRef = remoteMics.find(
    (t) => !t.participant.isLocal && t.participant.identity !== agentIdentity
  );
  const callerMediaTrack = callerRef?.publication?.track?.mediaStreamTrack;
  const callerIdentity = callerRef?.participant.identity;

  // One player for the whole console: the Events timeline, its log and the
  // transcript all seek the same recording, and it keeps playing across tabs.
  const timelineAudio = useTimelineAudio({ agentName, roomName, recordings });

  /**
   * Takes a turn by typing. The agent's session listens on the chat topic and
   * treats what arrives as user input — it interrupts itself and answers out
   * loud, exactly as if the words had been spoken.
   */
  const sendMessage = useCallback(
    async (text: string) => {
      try {
        await sendChat(text);
        onAddEvent("chat.sent", text.slice(0, 300));
      } catch (err) {
        onAddEvent(
          "chat.send_failed",
          err instanceof Error ? err.message : String(err),
          "error"
        );
      }
    },
    [sendChat, onAddEvent]
  );

  const { recording, uploading, unsupported } = useSessionRecorder({
    agentName,
    roomName,
    live,
    agentTrack: agentMediaTrack,
    micTrack: micMediaTrack,
    callerTrack: callerMediaTrack,
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

  // ── Session history ──
  // What is on screen is written to /sessions/history when the session ends, so
  // the call can be replayed later against its recording.
  useSessionPersistence({
    agentName,
    roomName,
    live,
    startedAt,
    endedAt,
    talkMode,
    roomSid: roomSid?.room === roomName ? roomSid.sid : null,
    agentIdentity,
    participants: participants.length,
    serverUrl,
    config,
    events,
    metrics,
    transcript,
    onSaved: ({ id }) => onAddEvent("session.saved", `history #${id}`),
    onError: (message) => onAddEvent("session.save_failed", message, "warn"),
  });

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
          {/* How you talk to the agent: browser mic, or your phone over SIP. */}
          <div className="flex items-center rounded-lg border border-border p-0.5">
            {(
              [
                { key: "browser", label: "Browser", icon: Mic },
                { key: "sip", label: "SIP", icon: Phone },
              ] as const
            ).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onTalkModeChange(option.key)}
                title={
                  option.key === "browser"
                    ? "Talk with your microphone in this tab"
                    : "Ring your phone and talk there — the console stays muted"
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                  talkMode === option.key
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <option.icon className="size-3" />
                {option.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={onConfigure}>
            <Settings2 className="size-3.5" />
            Configure
          </Button>
          {live ? (
            <Button size="sm" variant="destructive" onClick={onEnd}>
              {sipCall ? <PhoneOff className="size-3.5" /> : <Square className="size-3.5" />}
              {sipCall ? (sipCall.direction === "out" ? "Hang up" : "Leave call") : "End session"}
            </Button>
          ) : talkMode === "sip" ? (
            <Button
              size="sm"
              variant={waitingForCall ? "outline" : "default"}
              onClick={onWaitForCall}
              disabled={connecting}
            >
              {connecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : waitingForCall ? (
                <Square className="size-3.5" />
              ) : (
                <PhoneIncoming className="size-3.5" />
              )}
              {waitingForCall ? "Stop waiting" : "Wait for my call"}
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
                  {sipCall && (
                    <p className="mt-2 max-w-xs text-center text-xs text-muted-foreground">
                      {sipCall.direction === "out" ? "Calling " : "On a call from "}
                      <span className="font-mono text-foreground/80">{sipCall.peer}</span> — the
                      console is listening, not speaking.
                    </p>
                  )}
                  <div className="mt-6">
                    <VoiceAssistantControlBar />
                  </div>
                </div>
                {/* Transcript, with a composer: typing is a third way in
                    alongside the browser mic and a phone. */}
                <TranscriptPanel
                  lines={transcript}
                  onSend={sendMessage}
                  sending={isSending}
                  composerPlaceholder={
                    agent ? "Message the agent…" : "Waiting for the agent to join…"
                  }
                />
              </div>
            ) : transcript.length > 0 && !sipPanelOpen ? (
              /* Ended — what was said stays on screen until you ask for the
                 dialler again. Hanging up should not wipe the call you just
                 had off the stage. */
              <div className="flex min-h-0 w-full flex-col">
                <div className="flex items-center justify-between gap-3 border-b px-3 py-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                    {talkMode === "sip" ? "Call ended" : "Session ended"}
                    {duration !== null ? ` · ${formatDuration(duration)}` : ""}
                  </span>
                  {talkMode === "sip" ? (
                    <Button size="sm" onClick={onOpenSipPanel}>
                      <PhoneOutgoing className="size-3.5" />
                      New call
                    </Button>
                  ) : (
                    <Button size="sm" onClick={onStart} disabled={connecting}>
                      {connecting && <Loader2 className="size-3.5 animate-spin" />}
                      Start a session
                    </Button>
                  )}
                </div>
                <TranscriptPanel lines={transcript} className="w-full" />
              </div>
            ) : talkMode === "sip" ? (
              <SipPanel
                agentName={agentName}
                targets={dialInTargets}
                trunks={outboundTrunks}
                waiting={waitingForCall}
                connecting={connecting}
                hasTranscript={transcript.length > 0}
                onWait={onWaitForCall}
                onPlaceCall={onPlaceCall}
                onShowTranscript={onShowTranscript}
              />
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
            <RailRow
              label="You talk via"
              value={
                talkMode === "sip"
                  ? sipCall
                    ? `sip · ${sipCall.peer}`
                    : waitingForCall
                      ? "sip · waiting for your call"
                      : "sip · dial in"
                  : "browser mic"
              }
              mono
            />
            <RailRow label="Room" value={roomName ?? "—"} mono />
            <RailRow label="Region" value={livekitRegion} />
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
        {dockOpen && <DockResizeHandle height={dockHeight} onResize={onDockResize} />}
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
          // Events manages its own panes (pinned timeline + scrolling log), so
          // the dock keeps its scrollbar to itself for the other tabs.
          <div
            style={{ height: dockHeight }}
            className={cn(
              "flex min-h-0 flex-col",
              tab === "Events" || tab === "Metrics" ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            {tab === "Audio" && (
              <AudioTab
                live={live}
                agentName={agentName}
                agentTrack={agentMediaTrack}
                micTrack={micMediaTrack}
                callerTrack={callerMediaTrack}
                callerIdentity={callerIdentity}
                micMuted={microphoneTrack?.isMuted ?? !localParticipant?.isMicrophoneEnabled}
                recordings={recordings}
                recording={recording}
                uploading={uploading}
                unsupported={unsupported}
                onDeleted={onRecordingDeleted}
              />
            )}
            {tab === "Events" && (
              <EventsPanel
                events={events}
                transcript={transcript}
                live={live}
                timelineOn={timelineOn}
                onTimelineToggle={onTimelineToggle}
                transcriptOn={transcriptOn}
                onTranscriptToggle={onTranscriptToggle}
                recordings={recordings}
                dockHeight={dockHeight}
                audio={timelineAudio}
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
            {tab === "Metrics" && (
              <MetricsPanel
                metrics={metrics}
                events={events}
                live={live}
                timelineOn={timelineOn}
                onTimelineToggle={onTimelineToggle}
                recordings={recordings}
                dockHeight={dockHeight}
                audio={timelineAudio}
              />
            )}
            {tab === "Models" && <ModelsPanel metrics={metrics} config={config} />}
          </div>
        )}
      </div>
    </>
  );
}

/* ────────────────────────────────────
   SIP mode: you place the call
   ──────────────────────────────────── */
function SipPanel({
  agentName,
  targets,
  trunks,
  waiting,
  connecting,
  hasTranscript,
  onWait,
  onPlaceCall,
  onShowTranscript,
}: {
  agentName: string;
  targets: DialInTarget[];
  trunks: OutboundTrunk[];
  waiting: boolean;
  connecting: boolean;
  /** A previous call left a transcript worth going back to. */
  hasTranscript: boolean;
  onWait: () => void;
  onPlaceCall: (input: { callTo: string; trunkId?: string }) => void;
  onShowTranscript: () => void;
}) {
  const [callTo, setCallTo] = useState("");
  const [trunkId, setTrunkId] = useState("");

  // `sip:name@host` rings that device directly; a number needs a trunk.
  const trimmed = callTo.trim().replace(/^sips?:/i, "");
  const atIndex = trimmed.lastIndexOf("@");
  const direct = atIndex > 0 && !!trimmed.slice(atIndex + 1).trim();
  const selfDialled = targets.find((t) => t.number === callTo.trim());
  const canCall = !!callTo.trim() && (direct || !!trunkId);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 overflow-y-auto p-5">
      {/* Call out — the console dials, the agent is already in the room */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <PhoneOutgoing className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Call out</span>
          <span className="text-xs text-muted-foreground">
            {agentName} joins the room, then the phone rings
          </span>
          {hasTranscript && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 text-xs"
              onClick={onShowTranscript}
            >
              <ArrowLeft className="size-3" />
              Transcript
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          <Select value={trunkId} onValueChange={setTrunkId} disabled={direct}>
            <SelectTrigger size="sm" className="w-[190px] shrink-0">
              <SelectValue placeholder={direct ? "not needed" : "Outbound trunk"} />
            </SelectTrigger>
            <SelectContent>
              {trunks.map((t) => (
                <SelectItem key={t.trunkId} value={t.trunkId}>
                  {t.name || t.trunkId}
                  {t.address ? ` — ${t.address}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={callTo}
            onChange={(e) => setCallTo(e.target.value)}
            placeholder="+15551234567 or sip:you@192.168.1.10"
            className="h-8 font-mono text-sm"
          />
          <Button
            size="sm"
            className="shrink-0"
            disabled={!canCall || connecting}
            onClick={() => onPlaceCall({ callTo: callTo.trim(), trunkId: direct ? undefined : trunkId })}
          >
            {connecting ? <Loader2 className="size-3.5 animate-spin" /> : <PhoneOutgoing className="size-3.5" />}
            Call
          </Button>
        </div>

        {targets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Your inbound numbers:</span>
            {targets.map((t) => (
              <button
                key={`${t.trunkId}-${t.number}`}
                type="button"
                onClick={() => setCallTo(t.number)}
                className="rounded-full border border-border px-2 py-0.5 font-mono text-xs transition-colors hover:border-primary hover:text-primary"
              >
                {t.number}
              </button>
            ))}
          </div>
        )}

        {selfDialled ? (
          <p
            className={
              selfDialled.agents.length > 0
                ? "text-xs text-yellow-600 dark:text-yellow-500"
                : "text-xs text-muted-foreground"
            }
          >
            {selfDialled.agents.length > 0 ? (
              <>
                That is your own number: the call comes back in and rule{" "}
                <span className="font-medium">{selfDialled.ruleName}</span> answers with{" "}
                <span className="font-medium">{selfDialled.agents.join(", ")}</span>, so the two
                agents talk to each other. Call a phone or a{" "}
                <code className="rounded bg-muted px-1 py-0.5">sip:you@host</code> address instead.
              </>
            ) : (
              <>
                That is your own number, and no rule dispatches an agent to it — the far end is an
                empty room, so nobody answers.
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            A number needs a carrier on the trunk. A{" "}
            <code className="rounded bg-muted px-1 py-0.5">sip:</code> address rings that device
            directly, with no trunk and no dispatch rule in the way.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Call in — you dial, the console attaches to the call that lands */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <PhoneIncoming className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Call in</span>
          <span className="text-xs text-muted-foreground">
            you dial, the console attaches to the call
          </span>
        </div>

        {targets.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No inbound numbers. Add an inbound trunk and a dispatch rule under{" "}
            <Link href="/telephony/sip-trunks" className="text-primary hover:underline">
              Telephony
            </Link>{" "}
            to receive calls.
          </p>
        ) : (
          <div className="space-y-1">
            {targets.map((t) => (
              <div key={`in-${t.trunkId}-${t.number}`} className="flex items-baseline gap-2">
                <span className="font-mono text-sm text-foreground">{t.number}</span>
                <span className="text-xs text-muted-foreground">
                  {t.agents.length > 0 ? (
                    <>
                      answered by{" "}
                      <span
                        className={
                          t.agents.includes(agentName) ? "text-foreground" : "text-yellow-500"
                        }
                      >
                        {t.agents.join(", ")}
                      </span>
                      {!t.agents.includes(agentName) && " (not this agent)"}
                    </>
                  ) : (
                    <span className="text-yellow-500">
                      {t.ruleName
                        ? `rule ${t.ruleName} dispatches no agent — nobody will answer`
                        : "no dispatch rule matches — the call will be rejected"}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        <Button
          size="sm"
          variant={waiting ? "outline" : "secondary"}
          onClick={onWait}
          disabled={connecting}
        >
          {waiting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Waiting for your call…
            </>
          ) : (
            <>
              <PhoneIncoming className="size-3.5" />
              Wait for my call
            </>
          )}
        </Button>
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
  callerTrack,
  callerIdentity,
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
  callerTrack?: MediaStreamTrack;
  callerIdentity?: string;
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
        {callerTrack && (
          <div className="rounded-lg border p-3 md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
                Caller
              </span>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {callerIdentity ?? "sip"}
              </Badge>
            </div>
            <AudioScope track={callerTrack} color="#f59e0b" label="caller · sip" />
          </div>
        )}
      </div>

      {unsupported && (
        <p className="text-xs text-yellow-500">
          This browser has no MediaRecorder support, so session audio cannot be saved.
        </p>
      )}

      <SavedAudioList
        agentName={agentName}
        recordings={recordings}
        onDeleted={onDeleted}
        emptyMessage={
          live
            ? "Recording this session — the agent audio and the mixed conversation are saved when it ends."
            : "No saved audio yet. Start a session; the agent output, your side and the mix are stored when it ends."
        }
        status={
          <>
            {recording && (
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-red-500">
                <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
                recording
              </span>
            )}
            {uploading && (
              <span className="text-[10px] font-mono uppercase text-muted-foreground">saving…</span>
            )}
          </>
        }
      />
    </div>
  );
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
   Clear confirmation
   ──────────────────────────────────── */
function ClearDialog({
  open,
  onOpenChange,
  events,
  metrics,
  transcript,
  recordings,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: number;
  metrics: number;
  transcript: number;
  recordings: SavedRecording[];
  onConfirm: () => void;
}) {
  const bytes = recordings.reduce((sum, r) => sum + r.bytes, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear console session data?</DialogTitle>
          <DialogDescription>
            This resets the console for this agent. Saved audio is deleted from disk and
            cannot be recovered.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 text-sm text-foreground/80">
          <li className="flex justify-between gap-4">
            <span>Events</span>
            <span className="font-mono text-muted-foreground">{events}</span>
          </li>
          <li className="flex justify-between gap-4">
            <span>Metrics</span>
            <span className="font-mono text-muted-foreground">{metrics}</span>
          </li>
          <li className="flex justify-between gap-4">
            <span>Transcript lines</span>
            <span className="font-mono text-muted-foreground">{transcript}</span>
          </li>
          <li className="flex justify-between gap-4">
            <span className={recordings.length > 0 ? "text-destructive" : undefined}>
              Saved recordings (deleted from disk)
            </span>
            <span className="font-mono text-muted-foreground">
              {recordings.length}
              {recordings.length > 0 ? ` · ${formatBytes(bytes)}` : ""}
            </span>
          </li>
        </ul>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm}>
            <Trash2 className="size-4" />
            Clear{recordings.length > 0 ? " and delete audio" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
