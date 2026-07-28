/**
 * Shared types for the agent Console.
 *
 * The deployed agent mirrors every `metrics_collected` event onto a room data
 * topic (see `generateAgentCode`), which is how the Console gets per-session
 * STT / LLM / TTS latency instead of process-wide log lines.
 */

/** Room data topic used by both the generated agent and the Console UI. */
export const CONSOLE_METRICS_TOPIC = "lk.metrics";

/**
 * Every metric livekit-agents 1.x emits. `eot` is the turn detector's own
 * inference metric, distinct from `eou` (the end-of-utterance delay the session
 * measures around it).
 */
export type MetricKind =
  | "stt"
  | "llm"
  | "tts"
  | "eou"
  | "eot"
  | "interrupt"
  | "realtime"
  | "vad"
  | "unknown";

/**
 * Who a metric is about, when that is not simply "the agent".
 *
 * A voice agent has one speaker and never sets this. The agent-assist worker
 * runs an `AgentSession` per human on the same room, so its STT and turn
 * detection measure two different people and say which — otherwise a
 * conversation with two speakers draws as one lane, and a slow turn cannot be
 * attributed to the person who caused it.
 */
export interface MetricSpeaker {
  identity?: string;
  name?: string;
  /** "agent" (the human taking the call) or "customer", for assist sessions. */
  role?: string;
}

export interface ConsoleMetric {
  /** Local id — metrics carry no stable id of their own. */
  id: string;
  kind: MetricKind;
  speaker?: MetricSpeaker;
  /** Plugin label, e.g. "openai.LLM". */
  label: string;
  /** When the browser received it (ms epoch). */
  at: number;
  /** Agent-side timestamp, seconds. */
  timestamp?: number;
  /** Groups the metrics of one agent turn together. */
  speechId?: string;
  requestId?: string;

  // Latency — all seconds, as reported by livekit-agents.
  ttft?: number;
  ttfb?: number;
  duration?: number;
  audioDuration?: number;
  endOfUtteranceDelay?: number;
  transcriptionDelay?: number;
  onUserTurnCompletedDelay?: number;

  // Turn detector / interruption detector
  detectionDelay?: number;
  predictionDuration?: number;
  totalDuration?: number;
  numRequests?: number;
  numInterruptions?: number;
  numBackchannels?: number;

  // Usage
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  tokensPerSecond?: number;
  charactersCount?: number;

  cancelled?: boolean;
  raw: Record<string, unknown>;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function speakerOf(v: unknown): MetricSpeaker | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const raw = v as Record<string, unknown>;
  const speaker: MetricSpeaker = {
    identity: str(raw.identity),
    name: str(raw.name),
    role: str(raw.role),
  };
  return speaker.identity || speaker.name || speaker.role ? speaker : undefined;
}

/** Short label for a speaker's lane; empty when the metric names no speaker. */
export function metricSpeakerLabel(m: ConsoleMetric): string {
  const s = m.speaker;
  if (!s) return "";
  return s.name || s.role || s.identity || "";
}

/**
 * Identifies the lane a metric belongs in. One lane per kind, split per speaker
 * once a session has more than one — an assist call transcribes two people and
 * they get a lane each.
 */
export function metricLaneKey(m: ConsoleMetric): string {
  const s = m.speaker;
  const who = s ? s.identity || s.name || s.role || "" : "";
  return who ? `${m.kind}:${who}` : m.kind;
}

/** Maps a class name ("LLMMetrics") or type tag ("llm_metrics") to a kind. */
export function metricKindOf(raw: Record<string, unknown>): MetricKind {
  const hint = `${str(raw.kind) ?? ""} ${str(raw.type) ?? ""}`.toLowerCase();
  // "eot" before "eou": both start with "eo" but mean different things.
  if (hint.includes("eot") || hint.includes("end_of_turn")) return "eot";
  if (hint.includes("interruption")) return "interrupt";
  if (hint.includes("realtime")) return "realtime";
  if (hint.includes("eou") || hint.includes("end_of_utterance")) return "eou";
  if (hint.includes("vad")) return "vad";
  if (hint.includes("stt")) return "stt";
  if (hint.includes("tts")) return "tts";
  if (hint.includes("llm")) return "llm";
  return "unknown";
}

export const METRIC_KIND_LABEL: Record<MetricKind, string> = {
  stt: "STT",
  llm: "LLM",
  tts: "TTS",
  eou: "EOU",
  eot: "TURN",
  interrupt: "INTR",
  realtime: "RT",
  vad: "VAD",
  unknown: "Other",
};

/** Longer names, for filters and tooltips. */
export const METRIC_KIND_TITLE: Record<MetricKind, string> = {
  stt: "Speech to text",
  llm: "LLM",
  tts: "Text to speech",
  eou: "End of utterance",
  eot: "Turn detector",
  interrupt: "Interruptions",
  realtime: "Realtime model",
  vad: "Voice activity (high volume)",
  unknown: "Other",
};

/** Parses one data-channel payload. Returns null when it isn't a metric. */
export function parseConsoleMetric(
  payload: unknown,
  at: number,
  seq: number
): ConsoleMetric | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = payload as Record<string, unknown>;

  const kind = metricKindOf(raw);
  // A payload with neither a type tag nor any timing isn't a metric at all.
  if (kind === "unknown" && raw.timestamp === undefined) return null;

  return {
    id: `${at}-${seq}`,
    kind,
    speaker: speakerOf(raw.speaker),
    label: str(raw.label) ?? METRIC_KIND_TITLE[kind],
    at,
    timestamp: num(raw.timestamp),
    speechId: str(raw.speech_id) ?? str(raw.speechId),
    requestId: str(raw.request_id) ?? str(raw.requestId),
    ttft: num(raw.ttft),
    ttfb: num(raw.ttfb),
    duration: num(raw.duration),
    audioDuration: num(raw.audio_duration) ?? num(raw.audioDuration),
    endOfUtteranceDelay: num(raw.end_of_utterance_delay) ?? num(raw.endOfUtteranceDelay),
    transcriptionDelay: num(raw.transcription_delay) ?? num(raw.transcriptionDelay),
    onUserTurnCompletedDelay:
      num(raw.on_user_turn_completed_delay) ?? num(raw.onUserTurnCompletedDelay),
    detectionDelay: num(raw.detection_delay) ?? num(raw.detectionDelay),
    predictionDuration: num(raw.prediction_duration) ?? num(raw.predictionDuration),
    totalDuration: num(raw.total_duration) ?? num(raw.totalDuration),
    numRequests: num(raw.num_requests) ?? num(raw.numRequests),
    numInterruptions: num(raw.num_interruptions) ?? num(raw.numInterruptions),
    numBackchannels: num(raw.num_backchannels) ?? num(raw.numBackchannels),
    // Realtime and STT/TTS report input/output tokens instead of prompt/completion.
    promptTokens: num(raw.prompt_tokens) ?? num(raw.promptTokens) ?? num(raw.input_tokens),
    completionTokens:
      num(raw.completion_tokens) ?? num(raw.completionTokens) ?? num(raw.output_tokens),
    cachedTokens: num(raw.prompt_cached_tokens) ?? num(raw.cachedTokens),
    totalTokens: num(raw.total_tokens) ?? num(raw.totalTokens),
    tokensPerSecond: num(raw.tokens_per_second) ?? num(raw.tokensPerSecond),
    charactersCount: num(raw.characters_count) ?? num(raw.charactersCount),
    cancelled: typeof raw.cancelled === "boolean" ? raw.cancelled : undefined,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Per-turn tracing
// ---------------------------------------------------------------------------

/**
 * One agent turn, assembled from the metrics that share a speech id. The
 * segments are what the user actually waits through: silence detection, then
 * the LLM's first token, then the first byte of audio.
 */
export interface TurnTrace {
  speechId: string;
  at: number;
  /** Silence → end-of-turn decision. */
  eou?: number;
  /** Final transcript lag inside the EOU delay. */
  transcription?: number;
  /** LLM time to first token. */
  ttft?: number;
  /** TTS time to first byte. */
  ttfb?: number;
  /** eou + ttft + ttfb — what the user hears as the gap before a reply. */
  total: number;
  llmLabel?: string;
  ttsLabel?: string;
  cancelled: boolean;
}

export function buildTurnTraces(metrics: ConsoleMetric[]): TurnTrace[] {
  const byTurn = new Map<string, TurnTrace>();

  for (const m of metrics) {
    if (!m.speechId) continue;
    const turn = byTurn.get(m.speechId) ?? {
      speechId: m.speechId,
      at: m.at,
      total: 0,
      cancelled: false,
    };

    if (m.kind === "eou") {
      turn.eou = m.endOfUtteranceDelay ?? turn.eou;
      turn.transcription = m.transcriptionDelay ?? turn.transcription;
    } else if (m.kind === "llm" || m.kind === "realtime") {
      turn.ttft = m.ttft ?? turn.ttft;
      turn.llmLabel = m.label;
    } else if (m.kind === "tts") {
      turn.ttfb = m.ttfb ?? turn.ttfb;
      turn.ttsLabel = m.label;
    }
    if (m.cancelled) turn.cancelled = true;
    turn.at = Math.min(turn.at, m.at);
    turn.total = (turn.eou ?? 0) + (turn.ttft ?? 0) + (turn.ttfb ?? 0);

    byTurn.set(m.speechId, turn);
  }

  return Array.from(byTurn.values()).sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// Usage roll-up (Models tab)
// ---------------------------------------------------------------------------

export interface ModelUsage {
  kind: MetricKind;
  label: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Seconds of audio processed (STT) or produced (TTS). */
  audioSeconds: number;
  characters: number;
  /** Mean TTFT (LLM) or TTFB (TTS), seconds. */
  avgLatency?: number;
  /** Mean tokens per second, LLM only. */
  avgTokensPerSecond?: number;
}

const USAGE_KINDS: MetricKind[] = ["stt", "llm", "tts", "realtime"];

export function aggregateUsage(metrics: ConsoleMetric[]): ModelUsage[] {
  const rows = new Map<string, ModelUsage & { _lat: number[]; _tps: number[] }>();

  for (const m of metrics) {
    // Only the model calls have usage; the detectors just report timings.
    if (!USAGE_KINDS.includes(m.kind)) continue;
    const key = `${m.kind}:${m.label}`;
    const row =
      rows.get(key) ??
      {
        kind: m.kind,
        label: m.label,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        audioSeconds: 0,
        characters: 0,
        _lat: [] as number[],
        _tps: [] as number[],
      };

    row.requests += 1;
    row.promptTokens += m.promptTokens ?? 0;
    row.completionTokens += m.completionTokens ?? 0;
    row.totalTokens += m.totalTokens ?? (m.promptTokens ?? 0) + (m.completionTokens ?? 0);
    row.audioSeconds += m.audioDuration ?? 0;
    row.characters += m.charactersCount ?? 0;

    const latency =
      m.kind === "llm" || m.kind === "realtime" ? m.ttft : m.kind === "tts" ? m.ttfb : undefined;
    if (latency !== undefined) row._lat.push(latency);
    if (m.tokensPerSecond !== undefined) row._tps.push(m.tokensPerSecond);

    rows.set(key, row);
  }

  return Array.from(rows.values()).map(({ _lat, _tps, ...row }) => ({
    ...row,
    avgLatency: mean(_lat),
    avgTokensPerSecond: mean(_tps),
  }));
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Table cells
// ---------------------------------------------------------------------------

export interface MetricRowCells {
  /** The headline latency for this kind of metric. */
  latency: string;
  latencyLabel: string;
  duration: string;
  audio: string;
  tokens: string;
  tps: string;
  /** Everything the columns can't hold, for the row tooltip. */
  detail: string;
}

/**
 * Each metric kind means something different by "latency" and "duration", so
 * the table asks here rather than showing STT a TTFT column it never fills.
 */
export function metricRowCells(m: ConsoleMetric): MetricRowCells {
  // STT/TTS report input/output token fields that stay at zero for most
  // providers — showing "— → —" there is just noise.
  const tokenTotal = (m.promptTokens ?? 0) + (m.completionTokens ?? 0);
  const tokens =
    tokenTotal > 0
      ? `${formatCount(m.promptTokens)} → ${formatCount(m.completionTokens)}`
      : "—";
  const tps = m.tokensPerSecond !== undefined ? m.tokensPerSecond.toFixed(1) : "—";

  switch (m.kind) {
    case "llm":
    case "realtime":
      return {
        latency: formatSeconds(m.ttft),
        latencyLabel: "TTFT",
        duration: formatSeconds(m.duration),
        audio: formatSeconds(m.audioDuration),
        tokens,
        tps,
        detail: m.cancelled ? "cancelled" : "",
      };
    case "tts":
      return {
        latency: formatSeconds(m.ttfb),
        latencyLabel: "TTFB",
        duration: formatSeconds(m.duration),
        audio: formatSeconds(m.audioDuration),
        tokens: m.charactersCount !== undefined ? `${formatCount(m.charactersCount)} chars` : tokens,
        tps,
        detail: m.cancelled ? "cancelled" : "",
      };
    case "stt":
      return {
        latency: "—",
        latencyLabel: "—",
        duration: formatSeconds(m.duration),
        audio: formatSeconds(m.audioDuration),
        tokens,
        tps,
        detail: "",
      };
    case "eou":
      return {
        latency: formatSeconds(m.endOfUtteranceDelay),
        latencyLabel: "EOU delay",
        duration: formatSeconds(m.transcriptionDelay),
        audio: "—",
        tokens: "—",
        tps: "—",
        detail: `transcription ${formatSeconds(m.transcriptionDelay)} · on_user_turn_completed ${formatSeconds(m.onUserTurnCompletedDelay)}`,
      };
    case "eot":
      // The audio detector knows how long after the speech its verdict landed;
      // a text one only knows its own round trip. Reporting the round trip as a
      // detection delay would be a different measurement, so the label follows
      // whichever number there is.
      return {
        latency: formatSeconds(m.detectionDelay ?? m.totalDuration ?? m.predictionDuration),
        latencyLabel: m.detectionDelay !== undefined ? "detection" : "inference",
        duration: formatSeconds(m.predictionDuration ?? m.totalDuration),
        audio: "—",
        tokens: m.numRequests !== undefined ? `${formatCount(m.numRequests)} runs` : "—",
        tps: "—",
        detail:
          m.detectionDelay !== undefined
            ? `total ${formatSeconds(m.totalDuration)} · prediction ${formatSeconds(m.predictionDuration)}`
            : `round trip ${formatSeconds(m.totalDuration)}`,
      };
    case "interrupt":
      return {
        latency: formatSeconds(m.detectionDelay),
        latencyLabel: "detection",
        duration: formatSeconds(m.predictionDuration),
        audio: "—",
        tokens:
          m.numInterruptions !== undefined
            ? `${formatCount(m.numInterruptions)} intr`
            : "—",
        tps: "—",
        detail: `interruptions ${m.numInterruptions ?? 0} · backchannels ${m.numBackchannels ?? 0} · runs ${m.numRequests ?? 0}`,
      };
    default:
      return {
        latency: "—",
        latencyLabel: "—",
        duration: formatSeconds(m.duration),
        audio: formatSeconds(m.audioDuration),
        tokens,
        tps,
        detail: "",
      };
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Seconds → "412 ms" / "1.24 s". Metrics from livekit-agents are seconds. */
export function formatSeconds(value?: number): string {
  if (value === undefined) return "—";
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  return `${value.toFixed(2)} s`;
}

export function formatCount(value?: number): string {
  if (value === undefined || value === 0) return "—";
  return value.toLocaleString();
}

export function formatClock(at: number): string {
  const d = new Date(at);
  return `${d.toLocaleTimeString("en-US", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
