/**
 * Model providers — shared types and helpers.
 *
 * A "provider" is an inference endpoint (OpenAI, Anthropic, Deepgram, or any
 * custom OpenAI-compatible server such as vLLM / Ollama / LiteLLM / Together).
 * Providers are stored in the database and managed from Settings > Providers,
 * so the agent builder never hardcodes a model list.
 *
 * This module is intentionally free of Node/`fs` imports so it can be used from
 * both server routes and client components.
 */

export type ModelKind = "llm" | "stt" | "tts" | "realtime";

export const MODEL_KINDS: { id: ModelKind; label: string }[] = [
  { id: "llm", label: "LLM" },
  { id: "realtime", label: "Realtime" },
  { id: "stt", label: "STT" },
  { id: "tts", label: "TTS" },
];

export interface ProviderModel {
  /** Model id exactly as the endpoint expects it, e.g. "gpt-5.4-mini". */
  id: string;
  /** Optional display name. Falls back to `id`. */
  label?: string;
  kind: ModelKind;
}

export interface ProviderVoice {
  id: string;
  label?: string;
}

export interface Provider {
  id: number;
  /** Stable short id used in model refs, e.g. "openai" in "openai/gpt-5.4". */
  slug: string;
  name: string;
  /** LiveKit Python plugin used to talk to this provider. */
  plugin: string;
  /** OpenAI-compatible base URL. Empty = plugin default. */
  baseUrl: string | null;
  /** Name of a secret (Settings > Secrets) holding the API key. */
  apiKeySecret: string | null;
  /** TTS `response_format`. Empty = whatever the plugin defaults to (mp3). */
  audioFormat: string | null;
  models: ProviderModel[];
  voices: ProviderVoice[];
  builtin: boolean;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Audio containers a TTS endpoint may accept. The OpenAI plugin asks for mp3 by
 * default, which self-hosted servers often reject — they commonly only emit
 * `wav` or raw `pcm`.
 */
export const TTS_AUDIO_FORMATS = ["wav", "pcm", "mp3", "opus", "flac", "aac"] as const;

/**
 * LiveKit Python plugins a provider can be wired to. `openaiCompatible` marks
 * the ones that accept an arbitrary `base_url` and expose `GET /v1/models`.
 */
export const PROVIDER_PLUGINS: {
  id: string;
  label: string;
  openaiCompatible?: boolean;
  kinds: ModelKind[];
}[] = [
  { id: "openai", label: "OpenAI-compatible", openaiCompatible: true, kinds: ["llm", "realtime", "stt", "tts"] },
  { id: "groq", label: "Groq", openaiCompatible: true, kinds: ["llm", "stt", "tts"] },
  { id: "anthropic", label: "Anthropic", kinds: ["llm"] },
  { id: "google", label: "Google", kinds: ["llm", "realtime", "stt", "tts"] },
  { id: "deepgram", label: "Deepgram", kinds: ["stt", "tts"] },
  { id: "cartesia", label: "Cartesia", kinds: ["tts", "stt"] },
  { id: "elevenlabs", label: "ElevenLabs", kinds: ["tts", "stt"] },
];

export function isOpenAiCompatible(plugin: string): boolean {
  return !!PROVIDER_PLUGINS.find((p) => p.id === plugin)?.openaiCompatible;
}

/** Endpoint each plugin talks to when a provider sets no explicit base URL. */
export const PLUGIN_DEFAULT_BASE_URL: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  deepgram: "https://api.deepgram.com/v1",
  cartesia: "https://api.cartesia.ai",
  elevenlabs: "https://api.elevenlabs.io/v1",
};

/** Env vars each plugin reads by convention when no secret is selected. */
export const PLUGIN_KEY_ENV_VARS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  deepgram: ["DEEPGRAM_API_KEY"],
  cartesia: ["CARTESIA_API_KEY"],
  elevenlabs: ["ELEVEN_API_KEY", "ELEVENLABS_API_KEY"],
};

/** The endpoint a provider will actually reach, explicit or plugin default. */
export function effectiveBaseUrl(plugin: string, baseUrl?: string | null): string {
  const explicit = (baseUrl || "").trim().replace(/\/+$/, "");
  return explicit || PLUGIN_DEFAULT_BASE_URL[plugin] || "";
}

// ---------------------------------------------------------------------------
// Model refs — "<provider-slug>/<model-id>"
// ---------------------------------------------------------------------------

export function modelRef(slug: string, modelId: string): string {
  return `${slug}/${modelId}`;
}

/** Splits on the *first* slash so model ids may contain slashes. */
export function parseModelRef(ref: string): { slug: string | null; modelId: string } {
  const idx = ref.indexOf("/");
  if (idx === -1) return { slug: null, modelId: ref };
  return { slug: ref.slice(0, idx), modelId: ref.slice(idx + 1) };
}

export interface ModelOption {
  ref: string;
  label: string;
  provider: Provider;
  model: ProviderModel;
}

/** All models of a given kind across enabled providers, ready for a <Select>. */
export function listModels(providers: Provider[], kind: ModelKind): ModelOption[] {
  const out: ModelOption[] = [];
  for (const provider of providers) {
    if (!provider.enabled) continue;
    for (const model of provider.models) {
      if (model.kind !== kind) continue;
      out.push({
        ref: modelRef(provider.slug, model.id),
        label: `${provider.name} ${model.label || model.id}`,
        provider,
        model,
      });
    }
  }
  return out;
}

export function findModel(
  providers: Provider[],
  ref: string
): { provider: Provider; model: ProviderModel } | null {
  const { slug, modelId } = parseModelRef(ref);
  if (!slug) return null;
  const provider = providers.find((p) => p.slug === slug);
  if (!provider) return null;
  const model = provider.models.find((m) => m.id === modelId);
  if (!model) return null;
  return { provider, model };
}

/** Voices offered by the provider that owns `ref`. */
export function voicesForModel(providers: Provider[], ref: string): ProviderVoice[] {
  return findModel(providers, ref)?.provider.voices ?? [];
}

export interface ResolvedModel {
  /** Python plugin module, e.g. "openai". */
  plugin: string;
  /** Model id passed to the plugin. */
  model: string;
  baseUrl: string | null;
  apiKeySecret: string | null;
  /** TTS `response_format`, when the provider pins one. */
  audioFormat: string | null;
}

/**
 * Turns a stored model value into everything the code generator needs.
 * `legacyMap` migrates values saved before providers existed (e.g. "gpt-5.4").
 */
export function resolveModel(
  value: string,
  providers: Provider[],
  legacyMap: Record<string, string> = {}
): ResolvedModel {
  const ref = legacyMap[value] || value;
  const { slug, modelId } = parseModelRef(ref);
  const provider = slug ? providers.find((p) => p.slug === slug) : undefined;

  if (provider) {
    return {
      plugin: provider.plugin,
      model: modelId,
      baseUrl: provider.baseUrl || null,
      apiKeySecret: provider.apiKeySecret || null,
      audioFormat: provider.audioFormat || null,
    };
  }

  // Unknown provider: fall back to treating the prefix as a plugin name.
  const knownPlugin = PROVIDER_PLUGINS.some((p) => p.id === slug);
  return {
    plugin: knownPlugin ? (slug as string) : "openai",
    model: knownPlugin ? modelId : ref,
    baseUrl: null,
    apiKeySecret: null,
    audioFormat: null,
  };
}

/**
 * Normalizes a stored model value to a `slug/model` ref using the provider
 * list, so legacy configs keep working and get migrated on the next save.
 */
export function normalizeModelValue(
  value: string,
  providers: Provider[],
  kind: ModelKind,
  legacyMap: Record<string, string> = {}
): string {
  if (!value) return value;
  if (findModel(providers, value)) return value;

  const mapped = legacyMap[value];
  if (mapped && findModel(providers, mapped)) return mapped;

  // Last resort: a provider that offers a model with this exact id.
  const bare = parseModelRef(mapped || value).modelId;
  for (const provider of providers) {
    const hit = provider.models.find((m) => m.kind === kind && m.id === bare);
    if (hit) return modelRef(provider.slug, hit.id);
  }
  return mapped || value;
}

/** Slugify a display name into a provider slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Secret names double as env var names in the generated agent code. */
export const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Built-in providers
// ---------------------------------------------------------------------------

export interface ProviderSeed {
  slug: string;
  name: string;
  plugin: string;
  models: ProviderModel[];
  voices?: ProviderVoice[];
}

/**
 * Seeded once, on an empty `providers` table, so a fresh install ships with a
 * usable model list. These are ordinary rows — editable and deletable. No
 * `baseUrl`/`apiKeySecret` is set, so each plugin uses its own env var
 * convention (OPENAI_API_KEY, DEEPGRAM_API_KEY, ...).
 */
export const DEFAULT_PROVIDERS: ProviderSeed[] = [
  {
    slug: "openai",
    name: "OpenAI",
    plugin: "openai",
    models: [
      { id: "gpt-5.4", label: "GPT-5.4", kind: "llm" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", kind: "llm" },
      { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", kind: "llm" },
      { id: "gpt-5.3-chat-latest", label: "GPT-5.3 Chat", kind: "llm" },
      { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", kind: "llm" },
      { id: "gpt-realtime-1.5", label: "GPT Realtime 1.5", kind: "realtime" },
      { id: "gpt-realtime-mini", label: "GPT Realtime Mini", kind: "realtime" },
      { id: "gpt-4o-mini-tts", label: "gpt-4o-mini-tts", kind: "tts" },
      { id: "tts-1", label: "tts-1", kind: "tts" },
      { id: "tts-1-hd", label: "tts-1-hd", kind: "tts" },
      { id: "whisper-1", label: "Whisper", kind: "stt" },
    ],
    voices: [
      { id: "coral", label: "Coral" },
      { id: "alloy", label: "Alloy" },
      { id: "ash", label: "Ash" },
      { id: "ballad", label: "Ballad" },
      { id: "echo", label: "Echo" },
      { id: "fable", label: "Fable" },
      { id: "nova", label: "Nova" },
      { id: "onyx", label: "Onyx" },
      { id: "sage", label: "Sage" },
      { id: "shimmer", label: "Shimmer" },
      { id: "verse", label: "Verse" },
      { id: "marin", label: "Marin" },
      { id: "cedar", label: "Cedar" },
      { id: "savannah", label: "Savannah" },
    ],
  },
  {
    slug: "anthropic",
    name: "Anthropic",
    plugin: "anthropic",
    models: [
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", kind: "llm" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", kind: "llm" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", kind: "llm" },
      { id: "claude-opus-4-5", label: "Claude Opus 4.5", kind: "llm" },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", kind: "llm" },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1", kind: "llm" },
      { id: "claude-sonnet-4-0", label: "Claude Sonnet 4", kind: "llm" },
      { id: "claude-opus-4-0", label: "Claude Opus 4", kind: "llm" },
    ],
  },
  {
    slug: "deepgram",
    name: "Deepgram",
    plugin: "deepgram",
    models: [{ id: "nova-3", label: "Nova 3 (Multilingual)", kind: "stt" }],
  },
  {
    slug: "cartesia",
    name: "Cartesia",
    plugin: "cartesia",
    models: [{ id: "sonic-3", label: "Sonic 3", kind: "tts" }],
  },
  {
    slug: "elevenlabs",
    name: "ElevenLabs",
    plugin: "elevenlabs",
    models: [{ id: "eleven_multilingual_v2", label: "Multilingual v2", kind: "tts" }],
  },
];
