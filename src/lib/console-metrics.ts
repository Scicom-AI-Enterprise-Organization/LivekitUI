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
  | "nc"
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

  // Noise cancellation. The filter runs inline on the audio path and reports
  // nothing of its own, so the agent times it and sends a rolling summary — one
  // metric per window of audio rather than one per chunk, which at 20 chunks a
  // second per stream would bury everything else on the topic.
  /** Chunks processed in the window. */
  frames?: number;
  /** Wall-clock the window covered — what the bar spans. */
  windowDuration?: number;
  /** Compute ÷ audio. 1.0 is real time: above it, the filter is falling behind. */
  rtf?: number;
  /** Mean and worst time one chunk took. */
  frameAvg?: number;
  frameMax?: number;
  /** Audio in one chunk — 50 ms at the SDK's default `frame_size_ms`. */
  chunkDuration?: number;
  /** Rate the filter ran at, which for GTCRN should be its native 16 kHz. */
  sampleRate?: number;

  cancelled?: boolean;
  /**
   * Whether the plugin streamed rather than sending one request. It decides what
   * `duration` means — a single round trip, or the life of the stream — and so
   * where the bar for it belongs.
   */
  streamed?: boolean;
  /**
   * Seconds of the segment that were never speech, when the agent reports them:
   * the VAD keeps some audio from before speech started and waits out some
   * silence before calling it ended, and all of it goes to the recogniser. Only
   * with these can a bar say which part of an utterance you would actually hear.
   */
  vadPadding?: { prefix: number; silence: number };
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
  // Matched on "noise", never on a bare "nc": the lane is called NC, but that
  // substring also lives inside "inference".
  if (hint.includes("noise") || hint.includes("nc_metrics")) return "nc";
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
  nc: "NC",
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
  nc: "Noise cancellation",
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
    frames: num(raw.frames),
    windowDuration: num(raw.window_duration) ?? num(raw.windowDuration),
    rtf: num(raw.rtf),
    frameAvg: num(raw.frame_avg) ?? num(raw.frameAvg),
    frameMax: num(raw.frame_max) ?? num(raw.frameMax),
    chunkDuration: num(raw.chunk_duration) ?? num(raw.chunkDuration),
    sampleRate: num(raw.sample_rate) ?? num(raw.sampleRate),
    cancelled: typeof raw.cancelled === "boolean" ? raw.cancelled : undefined,
    streamed: typeof raw.streamed === "boolean" ? raw.streamed : undefined,
    vadPadding: paddingOf(raw.vadPadding),
    raw,
  };
}

function paddingOf(v: unknown): { prefix: number; silence: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const raw = v as Record<string, unknown>;
  const prefix = num(raw.prefix) ?? 0;
  const silence = num(raw.silence) ?? 0;
  return prefix || silence ? { prefix, silence } : undefined;
}

// ---------------------------------------------------------------------------
// Placing a metric in time
// ---------------------------------------------------------------------------

/** Metric fields are seconds; every plot here is in milliseconds. */
const ms = (value?: number) => (value ?? 0) * 1000;

export interface MetricWindow {
  /** Wall-clock instant the work started. */
  from: number;
  /** Wall-clock instant it finished — for TTS, when the speech stopped. */
  to: number;
  /** End of the part that was pure waiting (TTFT, TTFB, EOU delay). */
  solidTo?: number;
  /**
   * The audible part, inside a window that covers more than it. Only STT has
   * one: its segment is the utterance plus the VAD's padding, and the two are
   * worth telling apart — everything either side of this is silence that was
   * transcribed anyway.
   */
  speech?: { from: number; to: number };
  /**
   * Where a *trailing* wait begins — work that happened after the thing measured
   * was over. STT's is its round trip: the audio ended, then the recogniser
   * answered. It matters because a text turn detector cannot run until the
   * transcript exists, so this wait is what sits between an utterance and the
   * turn ending, and it looked like an unexplained gap on the plot.
   */
  waitFrom?: number;
}

/**
 * What one metric covers in wall-clock time, read from its own fields.
 *
 * A metric is *reported* after the work it measures, so a bar runs back from its
 * timestamp over its duration. `metricWindows` refines the kinds where that is
 * not the whole story.
 */
function baseWindow(m: ConsoleMetric): MetricWindow {
  switch (m.kind) {
    case "llm":
    case "realtime": {
      // Compute, not audio: the reply was being generated up to the report.
      const from = m.at - ms(m.duration ?? m.ttft);
      return {
        from,
        to: m.at,
        solidTo: m.ttft !== undefined ? from + ms(m.ttft) : undefined,
      };
    }
    case "tts": {
      const requested = m.at - ms(m.duration);
      const speaks = requested + ms(m.ttfb);
      return {
        from: requested,
        // Falls back to the report instant when the plugin gives no audio
        // length; never shorter than the synthesis it measured.
        to: Math.max(speaks + ms(m.audioDuration), m.at),
        solidTo: m.ttfb !== undefined ? speaks : undefined,
      };
    }
    case "stt": {
      // The user's speech, not the recogniser's compute — and the recogniser
      // reports when it *returned*, which is a round trip after the speech
      // stopped. A one-shot STT collects the utterance, sends it, and answers
      // `duration` later, so the audio ended about that far before the report;
      // anchoring the bar to the report instead drew every utterance a second or
      // so late, past where you hear it in the recording. A streaming plugin
      // measures the life of the stream instead, and its transcript lands with
      // the audio, so nothing is taken off.
      // `raw` as a fallback: a session saved before this field was parsed still
      // carries the payload it arrived in, so its bars are corrected too rather
      // than the fix only applying to calls made from now on.
      const streamed =
        m.streamed ?? (typeof m.raw?.streamed === "boolean" ? m.raw.streamed : undefined);
      const audioTo = streamed === false ? m.at - ms(m.duration) : m.at;
      // `audio_duration` is what the segment covered, silence padding included,
      // so this window is wider than the speech itself — which is why the agent
      // reports the padding it added and the audible part is marked inside.
      const from = audioTo - ms(m.audioDuration ?? m.duration);
      // The window runs on to the report, with the round trip marked as a wait:
      // ending it at the audio left a gap before the turn detector that looked
      // like nothing was happening, when in fact the recogniser was answering.
      const waitFrom = audioTo < m.at ? audioTo : undefined;
      const pad = m.vadPadding;
      if (!pad) return { from, to: m.at, waitFrom };
      const speechFrom = Math.min(from + ms(pad.prefix), audioTo);
      const speechTo = Math.max(audioTo - ms(pad.silence), speechFrom);
      return { from, to: m.at, waitFrom, speech: { from: speechFrom, to: speechTo } };
    }
    case "eou": {
      const from = m.at - ms(m.endOfUtteranceDelay);
      return {
        from,
        to: m.at,
        solidTo: m.transcriptionDelay !== undefined ? from + ms(m.transcriptionDelay) : undefined,
      };
    }
    case "eot": {
      const from = m.at - ms(m.totalDuration ?? m.predictionDuration ?? m.detectionDelay);
      return {
        from,
        to: m.at,
        solidTo: m.detectionDelay !== undefined ? from + ms(m.detectionDelay) : undefined,
      };
    }
    case "interrupt": {
      const from = m.at - ms(m.predictionDuration ?? m.detectionDelay);
      return {
        from,
        to: m.at,
        solidTo: m.detectionDelay !== undefined ? from + ms(m.detectionDelay) : undefined,
      };
    }
    case "nc": {
      // Not one piece of work but a window of them: the filter runs on every
      // chunk of inbound audio, and the agent reports a rolling summary rather
      // than 20 metrics a second. The bar therefore spans the window it covers,
      // and its solid head is the compute inside — a filter keeping up shows a
      // sliver, one falling behind fills the bar.
      const from = m.at - ms(m.windowDuration ?? m.audioDuration ?? m.duration);
      return {
        from,
        to: m.at,
        solidTo: m.duration !== undefined ? from + ms(m.duration) : undefined,
      };
    }
    default:
      return { from: m.at - ms(m.duration), to: m.at };
  }
}

/**
 * Where every metric belongs on a wall-clock axis, keyed by metric id. The one
 * place that decides this — the timeline bars, the metric rows and the transcript
 * highlight all read it, so none of them can drift from the others.
 *
 * Two things need the whole list rather than one metric:
 *
 * - **TTS is heard, not computed.** Synthesis finishes long before the audio it
 *   produced has finished playing, so a TTS bar runs from the request, through
 *   the wait, and on over `audio_duration` — past the instant the metric
 *   arrived. And a reply split into sentences is *heard back to back*: the
 *   second chunk starts when the first stops playing, not when its own
 *   synthesis returned, which is usually while the first is still being spoken.
 *   Chaining them is what stops one reply drawing as a pile of overlapping bars
 *   and makes the lane match what the recording plays.
 * - **STT segments must not overlap.** Each reaches back over the audio it
 *   transcribed, and consecutive finals would otherwise cover the same speech
 *   twice. Per speaker, though: in a room with two people the two are talking
 *   over each other for real, and clamping across them would invent an order.
 */
export function metricWindows(metrics: ConsoleMetric[]): Map<string, MetricWindow> {
  const windows = new Map<string, MetricWindow>();
  for (const m of metrics) windows.set(m.id, baseWindow(m));

  // Playout is serial per reply. Keyed on the turn, with one shared bucket for
  // plugins that report no speech id — `Math.max` means an unrelated later turn
  // is never dragged forward by an earlier one.
  const speechEnd = new Map<string, number>();
  for (const m of [...metrics].sort((a, b) => a.at - b.at)) {
    if (m.kind !== "tts" || m.audioDuration === undefined) continue;
    const base = windows.get(m.id)!;
    const key = m.speechId ?? "";
    const readyAt = base.solidTo ?? base.from;
    const previousEnd = speechEnd.get(key);
    const speaks = previousEnd !== undefined ? Math.max(readyAt, previousEnd) : readyAt;
    const to = speaks + ms(m.audioDuration);
    windows.set(m.id, {
      // A chunk that waited on the one before it was not slow — its TTFB
      // elapsed while the agent was still speaking, so it shows no wait.
      from: previousEnd !== undefined && speaks > readyAt ? speaks : base.from,
      to,
      solidTo: previousEnd !== undefined && speaks > readyAt ? undefined : base.solidTo,
    });
    speechEnd.set(key, to);
  }

  const sttEnd = new Map<string, number>();
  for (const m of [...metrics].sort((a, b) => a.at - b.at)) {
    if (m.kind !== "stt") continue;
    const base = windows.get(m.id)!;
    const who = m.speaker?.identity ?? "";
    const previousEnd = sttEnd.get(who);
    const audioTo = base.waitFrom ?? base.to;
    const from = Math.min(previousEnd !== undefined ? Math.max(base.from, previousEnd) : base.from, audioTo);
    windows.set(m.id, {
      ...base,
      from,
      // The audible part cannot start before the window it sits in.
      speech: base.speech && { ...base.speech, from: Math.max(base.speech.from, from) },
    });
    // Keyed on audio, not on the report: the round trip is not speech, and
    // clamping the next utterance against it would push it later than it was.
    sttEnd.set(who, audioTo);
  }

  return windows;
}

// ---------------------------------------------------------------------------
// Transcript lines against the recording
// ---------------------------------------------------------------------------

/** The little a transcript line has to carry to be placed in time. */
export interface PlaceableLine {
  id: string;
  at: number;
  identity?: string;
  via?: string;
}

/**
 * When each transcript line was *spoken*, rather than when its transcript
 * arrived.
 *
 * A final transcript is reported after the speech it describes — end of turn,
 * then the recogniser — so a line's own `at` can sit seconds past the audio.
 * Highlighting on it lit the line up well after you heard it, which reads as the
 * transcript lagging the recording.
 *
 * The STT metric for that utterance is what knows better: it carries
 * `audio_duration`, the speech the segment covered. Lines are matched to metrics
 * by speaker and proximity, each metric claimed once, so two people talking in
 * one room cannot borrow each other's timing.
 *
 * Typed turns are left alone — they never passed through STT, and their `at` is
 * already the moment they were sent.
 */
export function speechStarts(
  lines: PlaceableLine[],
  metrics: ConsoleMetric[]
): Map<string, number> {
  const starts = new Map<string, number>();
  const stt = metrics.filter((m) => m.kind === "stt" && (m.audioDuration ?? m.duration));
  if (stt.length === 0) return starts;

  // The same windows the timeline draws, so a highlighted line and its bar begin
  // together — including the round trip taken off a one-shot recogniser.
  const windows = metricWindows(metrics);

  const claimed = new Set<string>();
  for (const line of lines) {
    if (line.via === "text") continue;

    let best: ConsoleMetric | undefined;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const metric of stt) {
      if (claimed.has(metric.id)) continue;
      const who = metric.speaker?.identity;
      // Only when both name a speaker: a voice agent's STT metrics name none,
      // and the line still belongs to whoever was transcribed.
      if (who && line.identity && who !== line.identity) continue;
      // A transcript cannot precede the recogniser that produced it by much;
      // the small negative slack covers the two clocks disagreeing.
      const delta = line.at - metric.at;
      if (delta < -250 || delta > SPEECH_MATCH_WINDOW_MS) continue;
      if (Math.abs(delta) < bestDelta) {
        best = metric;
        bestDelta = Math.abs(delta);
      }
    }

    if (!best) continue;
    claimed.add(best.id);
    const window = windows.get(best.id);
    // The audible start when the agent reported its padding, else the segment's.
    const spoken = window ? (window.speech?.from ?? window.from) : best.at;
    starts.set(line.id, Math.min(line.at, spoken));
  }

  return starts;
}

/** How long after its STT metric a transcript line may still belong to it. */
const SPEECH_MATCH_WINDOW_MS = 4000;

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
    case "stt": {
      // What it cost, then what of it was speech: the recogniser is sent the
      // utterance plus the VAD's padding, and only the first is worth reading as
      // "how long they talked".
      const pad = m.vadPadding ? m.vadPadding.prefix + m.vadPadding.silence : 0;
      const speech = m.audioDuration !== undefined ? Math.max(0, m.audioDuration - pad) : undefined;
      return {
        latency: formatSeconds(m.duration),
        latencyLabel: "recogniser",
        duration: formatSeconds(m.duration),
        audio: formatSeconds(m.audioDuration),
        tokens,
        tps,
        detail: pad
          ? `speech ${formatSeconds(speech)} · vad padding ${formatSeconds(pad)}`
          : "",
      };
    }
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
    case "nc": {
      // What one chunk cost is the number to read: it has to stay well inside
      // the chunk's own duration, or the filter is adding latency to the audio
      // it is cleaning. `rtf` says the same thing as a ratio.
      const chunk = m.chunkDuration !== undefined ? `chunk ${formatSeconds(m.chunkDuration)}` : "";
      const rate = m.sampleRate !== undefined ? `${Math.round(m.sampleRate / 1000)} kHz` : "";
      return {
        latency: formatSeconds(m.frameAvg),
        latencyLabel: "per chunk",
        duration: formatSeconds(m.duration),
        audio: formatSeconds(m.audioDuration),
        tokens: m.frames !== undefined ? `${formatCount(m.frames)} chunks` : "—",
        // `rtf` belongs to no column here — it goes in the detail below rather
        // than under a header that says TPS.
        tps: "—",
        detail: [
          m.rtf !== undefined ? `rtf ${m.rtf.toFixed(3)}` : null,
          m.frameMax !== undefined ? `worst chunk ${formatSeconds(m.frameMax)}` : null,
          [chunk, rate].filter(Boolean).join(" @ ") || null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }
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
