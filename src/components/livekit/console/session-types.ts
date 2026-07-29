/**
 * Shapes shared by the live console and the session replay view.
 *
 * A replayed session is the same data as a live one — events, metrics,
 * transcript, recordings — read back from the database instead of a room, so
 * both views render it with the same components.
 */

export interface ConsoleEvent {
  id: string;
  at: number;
  name: string;
  detail: string;
  level: "info" | "warn" | "error";
}

export interface TranscriptLine {
  /** Stable per speech segment; a streaming line keeps its id as it grows. */
  id: string;
  /**
   * Wall clock of the utterance, pinned when the segment is first seen — a
   * segment's text keeps growing as it streams, so timestamping the latest
   * version would read every line as "now" and line none of them up with the
   * event log or the recording.
   */
  at: number;
  identity: string;
  text: string;
  isAgent: boolean;
  /**
   * How the line reached the agent. Typed chat never passes through STT, so it
   * produces no transcription — it has to be collected from the chat topic or
   * it goes unrecorded, which reads as the user having said nothing at all.
   */
  via?: "voice" | "text";
}

export interface AgentConfigView {
  llmModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  sttModel?: string;
  sttLanguage?: string;
  pipelineMode?: string;
}

/** A recording as the API reports it. */
export interface SavedRecording {
  file: string;
  agent: string;
  room: string;
  kind: string;
  mimeType: string;
  bytes: number;
  durationMs: number;
  /** Wall clock of the first recorded sample — the audio↔event clock. */
  startedAt: string;
  createdAt: string;
  /** Which backend holds the bytes: "local" or "s3". */
  storage?: string;
}

export const RECORDING_KIND_LABEL: Record<string, string> = {
  mixed: "Mixed",
  agent: "Agent only",
  // The user side is the browser mic and/or a dialled caller.
  user: "You / caller",
};

/** URL that streams a recording back, wherever its bytes actually live. */
export function recordingSrc(agentName: string, file: string): string {
  return `/api/agents/${encodeURIComponent(agentName)}/recordings/${encodeURIComponent(file)}`;
}

/**
 * Which agent's recordings the API should be asked for.
 *
 * The recording's **own** agent, not the page's. `file` names the stored object
 * within one agent (`session_recordings` is `UNIQUE(agent_name, file)`), so the
 * two together are what addresses the bytes. A session's recordings are looked up
 * by *room*, and a room's captures do not all belong to the page's agent: each
 * observer job names its capture after its own participant identity, which is new
 * every job. Passing the page's agent then streams a different call's audio, or
 * 404s. The fallback covers a row from before `agent` was reported.
 */
export function recordingAgent(recording: SavedRecording, fallback: string): string {
  return recording.agent || fallback;
}

export function recordingSrcOf(recording: SavedRecording, fallbackAgent: string): string {
  return recordingSrc(recordingAgent(recording, fallbackAgent), recording.file);
}

/**
 * Stable identity of one recording, for React keys and for a `<Select>` value.
 *
 * **Not `file` alone.** Two calls into the same room produce the same file name
 * under different agents, so keying on `file` gave React duplicate keys and made
 * a picker ambiguous — choosing the third entry selected the first, and the
 * timeline was then plotted against the wrong recording's `startedAt`.
 */
export function recordingKey(recording: SavedRecording): string {
  return `${recording.agent}/${recording.file}`;
}

/**
 * When a recording was made, short enough for a picker.
 *
 * A room that took more than one call has a recording per call, all the same kind
 * and much the same length — "Mixed · 00:54" three times over says nothing about
 * which is which, and the clock is the one thing that does.
 */
export function recordingClock(recording: SavedRecording): string {
  const at = new Date(recording.startedAt);
  return Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** mm:ss.t — a tenth of a second matters when lining up against events. */
export function formatClockMs(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const tenth = Math.floor((total * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${tenth}`;
}
