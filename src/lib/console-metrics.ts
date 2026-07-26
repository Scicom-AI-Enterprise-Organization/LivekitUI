/**
 * Shared types for the agent Console.
 *
 * The deployed agent mirrors every `metrics_collected` event onto a room data
 * topic (see `generateAgentCode`), which is how the Console gets per-session
 * STT / LLM / TTS latency instead of process-wide log lines.
 */

/** Room data topic used by both the generated agent and the Console UI. */
export const CONSOLE_METRICS_TOPIC = "lk.metrics";

export type MetricKind = "stt" | "llm" | "tts" | "eou" | "vad" | "unknown";

export interface ConsoleMetric {
  /** Local id — metrics carry no stable id of their own. */
  id: string;
  kind: MetricKind;
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

/** Maps a class name ("LLMMetrics") or type tag ("llm_metrics") to a kind. */
export function metricKindOf(raw: Record<string, unknown>): MetricKind {
  const hint = `${str(raw.kind) ?? ""} ${str(raw.type) ?? ""}`.toLowerCase();
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
  vad: "VAD",
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
  if (kind === "unknown" && raw.ttft === undefined && raw.ttfb === undefined) {
    return null;
  }

  return {
    id: `${at}-${seq}`,
    kind,
    label: str(raw.label) ?? METRIC_KIND_LABEL[kind],
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
    promptTokens: num(raw.prompt_tokens) ?? num(raw.promptTokens),
    completionTokens: num(raw.completion_tokens) ?? num(raw.completionTokens),
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
    } else if (m.kind === "llm") {
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

export function aggregateUsage(metrics: ConsoleMetric[]): ModelUsage[] {
  const rows = new Map<string, ModelUsage & { _lat: number[]; _tps: number[] }>();

  for (const m of metrics) {
    if (m.kind === "eou" || m.kind === "vad") continue;
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

    const latency = m.kind === "llm" ? m.ttft : m.kind === "tts" ? m.ttfb : undefined;
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
