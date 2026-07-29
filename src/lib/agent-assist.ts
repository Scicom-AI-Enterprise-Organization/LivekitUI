/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

/**
 * Deploying the **agent assist** worker: the silent Python participant that
 * transcribes a call between two humans and coaches the one taking it.
 *
 * Unlike the agent builder, nothing here generates code.
 * `example/agent-assist-python/src/agent.py` is configured entirely through
 * environment variables, so the deployed copy is byte-identical to the one in
 * the repo and this module only decides what goes in `.env.local`. Editing the
 * worker therefore means editing one Python file rather than a template string
 * inside a TSX page, and a redeploy picks the edit up.
 *
 * It rides on the same runner as every other agent (`deployAgent`), so the
 * worker appears on `/agents` with logs, restart, stop and per-agent secrets
 * without any of that being reimplemented here.
 *
 * The config shape, its defaults and its validation live in
 * `agent-assist-config.ts`, which the sandbox pages import — this half may not
 * be reached from a client component.
 */

import { ensureDb, type DbProvider } from "./db";
import {
  resolveModel,
  type Provider,
  type ProviderModel,
  type ProviderVoice,
} from "./providers";
import { deployAgent } from "./agent-runner";
import {
  assistConfigFromAgent,
  assistWorkerName,
  type AssistWorkerConfig,
} from "./agent-assist-config";
import { normalizeAudioChunkMs } from "./audio-input";

export {
  ASSIST_TEMPLATE,
  ASSIST_WORKER_SUFFIX,
  assistWorkerName,
  normalizeAssistConfig,
  DEFAULT_ASSIST_CONFIG,
  type AssistWorkerConfig,
} from "./agent-assist-config";

const fs: any = require("fs");
const path: any = require("path");

function workerSourcePath(): string {
  return path.join(process.cwd(), "example", "agent-assist-python", "src", "agent.py");
}

function readWorkerSource(): string {
  const file = workerSourcePath();
  if (!fs.existsSync(file)) {
    throw new Error(
      `The assist worker source is missing (expected ${file}). Restore example/agent-assist-python, or create the sandbox without a worker.`
    );
  }
  return fs.readFileSync(file, "utf-8");
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return (JSON.parse(raw) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** `providers.ts` shape from a DB row — the same mapping `/api/providers` does. */
function toProvider(row: DbProvider): Provider {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    plugin: row.plugin,
    baseUrl: row.base_url,
    apiKeySecret: row.api_key_secret,
    audioFormat: row.audio_format,
    models: parseJson<ProviderModel[]>(row.models, []),
    voices: parseJson<ProviderVoice[]>(row.voices, []),
    builtin: !!row.builtin,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * What the worker will actually run, with `sourceAgent` applied.
 *
 * This is the difference between referencing an agent and copying it: the lookup
 * happens on **every** deploy, so editing the agent in the builder and
 * redeploying the worker is enough — there is no second copy of its models to
 * keep in step.
 *
 * A source agent that has since been deleted falls back to the stored values,
 * which are the last thing it resolved to. Better a worker that keeps running the
 * models it had than one that refuses to start.
 */
export async function resolveAgainstSourceAgent(
  config: AssistWorkerConfig
): Promise<AssistWorkerConfig> {
  if (!config.sourceAgent) return config;

  const db = await ensureDb();
  const agent = await db.findAgentByName(config.sourceAgent);
  if (!agent) return config;

  const stored = parseJson<Record<string, unknown>>(agent.config, {});
  return assistConfigFromAgent({ ...stored, name: config.sourceAgent }, config).config;
}

/**
 * The worker's environment, as a flat map. `deployAgent` writes it to
 * `.env.local` and passes it to the child, layered over the project's secrets —
 * so a provider's API key, referenced here by *name*, is already in scope by the
 * time the worker reads it.
 */
export async function buildAssistEnv(
  workerName: string,
  config: AssistWorkerConfig
): Promise<Record<string, string>> {
  const db = await ensureDb();
  const providers = (await db.getAllProviders()).map(toProvider);
  const effective = await resolveAgainstSourceAgent(config);

  const stt = resolveModel(effective.sttModel, providers);
  const llm = resolveModel(effective.llmModel, providers);

  const env: Record<string, string> = {
    ASSIST_AGENT_NAME: workerName,
    ASSIST_STT_PLUGIN: stt.plugin,
    ASSIST_STT_MODEL: stt.model,
    ASSIST_STT_BASE_URL: stt.baseUrl || "",
    ASSIST_STT_API_KEY_ENV: stt.apiKeySecret || "",
    ASSIST_LLM_PLUGIN: llm.plugin,
    ASSIST_LLM_MODEL: llm.model,
    ASSIST_LLM_BASE_URL: llm.baseUrl || "",
    ASSIST_LLM_API_KEY_ENV: llm.apiKeySecret || "",
    ASSIST_LANGUAGE: effective.language,
    ASSIST_TURN_DETECTOR: effective.turnDetector,
    ASSIST_NOISE_CANCELLATION: effective.noiseCancellation,
    ASSIST_AUDIO_CHUNK_MS: String(normalizeAudioChunkMs(effective.audioChunkMs)),
    ASSIST_SUGGEST_FOR: effective.suggestFor,
  };

  // Only when the remote detector is selected. The plugin decides at import time
  // whether to register a local ONNX runner and skips it precisely when this is
  // set, so setting it unconditionally would change the other detectors too.
  if (effective.turnDetector === "scicom" && effective.eotUrl) {
    env.LIVEKIT_REMOTE_EOT_URL = effective.eotUrl;
  }

  // A prompt spans lines; `.env.local` is one pair per line. Double-quoted with
  // escaped newlines is the form python-dotenv reads back intact.
  if (effective.instructions.trim()) {
    env.ASSIST_INSTRUCTIONS = JSON.stringify(effective.instructions);
  }

  return env;
}

/**
 * Writes and starts the worker for a sandbox, creating its `agents` row on the
 * first deploy and updating it after that.
 */
export async function deployAssistWorker(
  sandboxName: string,
  config: AssistWorkerConfig,
  deployer: { email: string; name: string }
): Promise<{ workerName: string; pid: number }> {
  const workerName = assistWorkerName(sandboxName);
  const source = readWorkerSource();

  const db = await ensureDb();
  const existing = await db.findAgentByName(workerName);
  // `kind` is what tells the agents page this row is not a builder agent — its
  // config has no instructions, voice or tools to open in the builder.
  const storedConfig = JSON.stringify({ kind: "agent-assist", assist: config });
  if (existing) {
    await db.updateAgent(existing.id, workerName, storedConfig, "deployed");
  } else {
    await db.createAgent(workerName, storedConfig, "deployed");
  }

  // Project secrets first (they hold the provider API keys), then the worker's
  // own — the same precedence the builder's deploy uses — and the assist env
  // last, since it is derived rather than user-entered.
  const secrets: Record<string, string> = {};
  for (const s of await db.getAllSecrets()) secrets[s.name] = s.value;
  for (const s of await db.getAgentSecrets(workerName)) secrets[s.key] = s.value;
  Object.assign(secrets, await buildAssistEnv(workerName, config));

  const { pid } = await deployAgent(workerName, source, secrets);
  await db.addAgentVersion(workerName, deployer.email, deployer.name);

  return { workerName, pid };
}

/**
 * Redeploys every assist worker that takes its models from `agentName`.
 *
 * Called when that agent is deployed from the builder. Without it, "the agent is
 * the source of truth" would only hold until you edited the agent: the worker's
 * models live in an `.env.local` written at deploy, so it would keep running the
 * old ones with nothing on screen saying so.
 *
 * Failures are collected, not thrown — the agent's own deploy succeeded, and that
 * is what the caller asked for.
 */
export async function redeployWorkersSourcedFrom(
  agentName: string,
  deployer: { email: string; name: string }
): Promise<{ worker: string; error?: string }[]> {
  const db = await ensureDb();
  const results: { worker: string; error?: string }[] = [];

  for (const app of await db.getAllSandboxApps()) {
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(app.settings || "{}");
    } catch {
      continue;
    }
    // Only a worker this sandbox owns: one it merely dispatches belongs to
    // whichever sandbox deployed it, and that one will redeploy it itself.
    if (!settings.assistWorker || typeof settings.assist !== "object" || !settings.assist) continue;
    const assist = settings.assist as Partial<AssistWorkerConfig>;
    if (assist.sourceAgent !== agentName) continue;

    try {
      const { workerName } = await deployAssistWorker(
        app.name,
        assist as AssistWorkerConfig,
        deployer
      );
      results.push({ worker: workerName });
    } catch (err) {
      results.push({
        worker: assistWorkerName(app.name),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
