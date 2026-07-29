/**
 * Shape and defaults of the **agent assist** worker's configuration.
 *
 * Node-free on purpose: the sandbox pages are client components and import this
 * for their forms, while `agent-assist.ts` (which spawns processes and reads the
 * worker source off disk) imports it too. Same rule as `providers.ts` — nothing
 * from `fs`, `path` or a server-only module may appear here.
 */

import { DEFAULT_AUDIO_CHUNK_MS, normalizeAudioChunkMs } from "./audio-input";

/** Template directory under `example/`, and the sandbox's `template` column. */
export const ASSIST_TEMPLATE = "agent-assist-react";

/** Appended to the sandbox name to get the worker's agent name. */
export const ASSIST_WORKER_SUFFIX = "-assist";

/**
 * Where the worker's source lives. Unlike the other templates this one is not in
 * `livekit-examples` — it ships in this repo, so the link points at the copy the
 * dashboard actually deploys.
 */
export const ASSIST_SOURCE_URL =
  "https://github.com/Scicom-AI-Enterprise-Organization/LivekitUI/tree/main/example/agent-assist-python";

export function assistWorkerName(sandboxName: string): string {
  return `${sandboxName}${ASSIST_WORKER_SUFFIX}`;
}

export type AssistTurnDetector = "audio" | "livekit" | "scicom" | "none";
export type AssistNoiseCancellation = "gtcrn" | "none";
export type AssistSuggestFor = "customer" | "agent" | "off";

export interface AssistWorkerConfig {
  /**
   * Name of an agent this worker takes its models from. When set it is the source
   * of truth: `buildAssistEnv` re-reads that agent's saved config on **every**
   * deploy, so editing it in the builder changes what the worker runs. Blank
   * means the fields below were set by hand.
   */
  sourceAgent: string;
  /**
   * Provider refs (`<provider-slug>/<model-id>`), same format as the builder.
   *
   * With `sourceAgent` set these are a cache of what that agent last resolved to
   * — shown in the UI, and used only if the agent has since been deleted. They
   * are never something the user has to fill in twice.
   */
  sttModel: string;
  llmModel: string;
  /** Blank lets the STT provider auto-detect. */
  language: string;
  turnDetector: AssistTurnDetector;
  noiseCancellation: AssistNoiseCancellation;
  /**
   * Audio handed to the filter (and the VAD, and the STT) per call, in ms. The
   * same decision the builder exposes, and one a source agent carries over.
   */
  audioChunkMs: number;
  /** vLLM endpoint. Only read when turnDetector is "scicom". */
  eotUrl: string;
  suggestFor: AssistSuggestFor;
  /** Blank keeps the worker's built-in coaching prompt. */
  instructions: string;
}

/**
 * Only a starting point. The create dialog replaces either model with the first
 * one the deployment's providers actually offer, so a self-hosted install with
 * no OpenAI key does not default to a model it cannot reach.
 */
export const DEFAULT_ASSIST_CONFIG: AssistWorkerConfig = {
  sourceAgent: "",
  sttModel: "openai/whisper-1",
  llmModel: "openai/gpt-5.4-mini",
  language: "",
  turnDetector: "audio",
  noiseCancellation: "gtcrn",
  audioChunkMs: DEFAULT_AUDIO_CHUNK_MS,
  eotUrl: "",
  suggestFor: "customer",
  instructions: "",
};

export const TURN_DETECTOR_OPTIONS: {
  id: AssistTurnDetector;
  label: string;
  hint: string;
}[] = [
  {
    id: "audio",
    label: "Audio (LiveKit v1-mini)",
    hint: "Runs in the worker process. Weights ship with livekit-agents — nothing to download, no Cloud account. Draws no turn-detector lane: only LiveKit Cloud's transport reports EOT metrics, so self-hosted the detection works and the timing is invisible.",
  },
  {
    id: "livekit",
    label: "Text (LiveKit multilingual)",
    hint: "Needs `python -m livekit.agents download-files` in the agent venv, or the worker dies on model_q8.onnx.",
  },
  {
    id: "scicom",
    label: "Text (Scicom remote)",
    hint: "Forwards each prediction to a vLLM endpoint. Needs the URL below.",
  },
  {
    id: "none",
    label: "None (VAD silence only)",
    hint: "A turn ends after a VAD pause. Cheapest, and coaches on fragments instead of finished thoughts.",
  },
];

export const NOISE_CANCELLATION_OPTIONS: {
  id: AssistNoiseCancellation;
  label: string;
  hint: string;
}[] = [
  {
    id: "gtcrn",
    label: "GTCRN (self-hosted)",
    hint: "A 48 K-parameter ONNX denoiser per stream, inside the worker. Input runs at 16 kHz, its native rate.",
  },
  {
    id: "none",
    label: "None",
    hint: "Raw participant audio. Fine for browser mics, which already arrive processed; bad for phone audio.",
  },
];

export const SUGGEST_FOR_OPTIONS: { id: AssistSuggestFor; label: string }[] = [
  { id: "customer", label: "After the customer speaks" },
  { id: "agent", label: "After the support agent speaks" },
  { id: "off", label: "Never — transcribe only" },
];

const TURN_DETECTORS = TURN_DETECTOR_OPTIONS.map((o) => o.id);
const NOISE_CANCELLATIONS = NOISE_CANCELLATION_OPTIONS.map((o) => o.id);
const SUGGEST_FOR = SUGGEST_FOR_OPTIONS.map((o) => o.id);

/**
 * Resolves an assist config against a builder agent's saved config.
 *
 * The worker *process* cannot be reused — a builder agent is a voice agent, it
 * links to whichever participant joins first and replies out loud — but its
 * models, language, turn detector and noise cancellation are the same decisions
 * this worker needs, already made. So the sandbox stores the agent's **name** and
 * this runs on every deploy: one source of truth, and editing the agent changes
 * the worker.
 *
 * Deliberately **not** taken from a voice agent: `instructions` and `suggestFor`.
 * A voice agent's instructions describe how to talk to a customer; the coaching
 * prompt describes how to write notes to a colleague. Carrying one into the other
 * would produce an assistant that greets the support agent.
 *
 * Returns what could not be carried over verbatim, so callers can say so rather
 * than silently running something else.
 */
export function assistConfigFromAgent(
  agentConfig: Record<string, unknown>,
  current: AssistWorkerConfig
): { config: AssistWorkerConfig; notes: string[] } {
  const notes: string[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  // Another assist worker: same job, so everything transfers — including the
  // coaching prompt, which is exactly what does *not* transfer from a voice agent.
  if (agentConfig.kind === "agent-assist" && agentConfig.assist) {
    return { config: normalizeAssistConfig(agentConfig.assist), notes };
  }

  const next: AssistWorkerConfig = { ...current };

  const stt = str(agentConfig.sttModel);
  const llm = str(agentConfig.llmModel);
  if (stt) next.sttModel = stt;
  if (llm) next.llmModel = llm;

  // A realtime agent does its own listening, so it has no separate STT to lend.
  if (str(agentConfig.pipelineMode) === "realtime") {
    notes.push(
      `${str(agentConfig.name) || "That agent"} is a realtime agent and has no separate transcription model — keeping ${next.sttModel}.`
    );
  }

  // The builder offers `multi` for its multilingual models. Providers want an ISO
  // code and reject that string with a 400 on every utterance, so it means the
  // same thing as blank here: let the provider decide.
  const language = str(agentConfig.sttLanguage).toLowerCase();
  next.language = ["multi", "multilingual", "auto", "any"].includes(language)
    ? ""
    : str(agentConfig.sttLanguage);
  next.eotUrl = str(agentConfig.eotUrl).replace(/\/$/, "");

  const detector = str(agentConfig.turnDetector);
  if ((TURN_DETECTOR_OPTIONS.map((o) => o.id) as string[]).includes(detector)) {
    next.turnDetector = detector as AssistTurnDetector;
  }

  const nc = str(agentConfig.noiseCancellation);
  if (nc === "gtcrn" || nc === "none") {
    next.noiseCancellation = nc;
  } else if (nc === "krisp") {
    // Krisp is not an option here at all: it authorises against LiveKit Cloud and
    // self-hosted it logs `not authorized (404)` and passes audio through. GTCRN
    // is what the agent would want; say that rather than quietly filtering
    // nothing.
    next.noiseCancellation = "gtcrn";
    notes.push("That agent uses Krisp, which does nothing on a self-hosted server — using GTCRN.");
  }

  // Carried over like the rest: it is a property of the audio path, and an agent
  // whose filter was tuned for 20 ms chunks wants the same here.
  next.audioChunkMs = normalizeAudioChunkMs(agentConfig.audioChunkMs);

  return { config: next, notes };
}

/**
 * Coerces whatever the client sent into a config the worker can run. Every
 * enum-ish field is checked against an allow-list because it ends up in the
 * worker's environment, and a bad value there is a worker that registers and
 * then dies on the first call.
 */
export function normalizeAssistConfig(input: unknown): AssistWorkerConfig {
  const raw = (input ?? {}) as Partial<Record<keyof AssistWorkerConfig, unknown>>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const pick = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
    (allowed as readonly string[]).includes(str(v)) ? (str(v) as T) : fallback;

  return {
    sourceAgent: str(raw.sourceAgent),
    sttModel: str(raw.sttModel) || DEFAULT_ASSIST_CONFIG.sttModel,
    llmModel: str(raw.llmModel) || DEFAULT_ASSIST_CONFIG.llmModel,
    language: str(raw.language),
    turnDetector: pick(raw.turnDetector, TURN_DETECTORS, DEFAULT_ASSIST_CONFIG.turnDetector),
    noiseCancellation: pick(
      raw.noiseCancellation,
      NOISE_CANCELLATIONS,
      DEFAULT_ASSIST_CONFIG.noiseCancellation
    ),
    audioChunkMs: normalizeAudioChunkMs(raw.audioChunkMs),
    eotUrl: str(raw.eotUrl).replace(/\/$/, ""),
    suggestFor: pick(raw.suggestFor, SUGGEST_FOR, DEFAULT_ASSIST_CONFIG.suggestFor),
    instructions: typeof raw.instructions === "string" ? raw.instructions : "",
  };
}
