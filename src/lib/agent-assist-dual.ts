/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

/**
 * Deploying the **dual-track assist** worker: the silent Python participant that
 * transcribes a phone call arriving as two audio tracks on one participant.
 *
 * Same deploy shape as `agent-assist.ts` — nothing here generates code.
 * `example/agent-assist-dual-python/src/agent.py` is configured entirely through
 * environment variables, so the deployed copy is byte-identical to the one in the
 * repo and this module only decides what goes in `.env.local`. Editing the worker
 * means editing one Python file, and a redeploy picks the edit up.
 *
 * It rides on the same runner as every other agent (`deployAgent`), so the worker
 * appears on `/agents` with logs, restart, stop and per-agent secrets without any
 * of that being reimplemented.
 *
 * The environment variables are prefixed `DUAL_` rather than `ASSIST_`. The two
 * workers never share a process — each gets its own `.env.local` — so this is not
 * about collisions; it is so that a log line, a `.env.local` or a stray export
 * says which worker it belongs to without having to look it up.
 *
 * The config shape and its validation live in `agent-assist-dual-config.ts`, which
 * the sandbox pages import — this half may not be reached from a client component.
 */

import { ensureDb, type DbProvider } from "./db";
import {
  resolveModel,
  type Provider,
  type ProviderModel,
  type ProviderVoice,
} from "./providers";
import { deployAgent } from "./agent-runner";
import { assistConfigFromAgent } from "./agent-assist-config";
import {
  dualWorkerName,
  normalizeDualConfig,
  type DualWorkerConfig,
} from "./agent-assist-dual-config";
import { normalizeAudioChunkMs } from "./audio-input";

export {
  ASSIST_DUAL_TEMPLATE,
  ASSIST_DUAL_WORKER_SUFFIX,
  ASSIST_DUAL_SOURCE_URL,
  dualWorkerName,
  normalizeDualConfig,
  DEFAULT_DUAL_CONFIG,
  type DualWorkerConfig,
} from "./agent-assist-dual-config";

const fs: any = require("fs");
const path: any = require("path");

function workerSourcePath(): string {
  return path.join(process.cwd(), "example", "agent-assist-dual-python", "src", "agent.py");
}

function readWorkerSource(): string {
  const file = workerSourcePath();
  if (!fs.existsSync(file)) {
    throw new Error(
      `The dual-track worker source is missing (expected ${file}). Restore example/agent-assist-dual-python, or create the sandbox without a worker.`
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
 * happens on **every** deploy, so editing the agent in the builder and redeploying
 * the worker is enough — there is no second copy of its models to keep in step.
 *
 * `micRole` is never taken from the source agent. A voice agent has no concept of
 * two tracks on one participant, so it has no opinion to inherit, and letting the
 * copy blank it would silently re-point a working deployment's legs.
 */
export async function resolveAgainstSourceAgent(
  config: DualWorkerConfig
): Promise<DualWorkerConfig> {
  if (!config.sourceAgent) return config;

  const db = await ensureDb();
  const agent = await db.findAgentByName(config.sourceAgent);
  if (!agent) return config;

  const stored = parseJson<Record<string, unknown>>(agent.config, {});
  const { config: shared } = assistConfigFromAgent(
    { ...stored, name: config.sourceAgent },
    config
  );
  return { ...shared, micRole: config.micRole };
}

/**
 * The worker's environment, as a flat map. `deployAgent` writes it to `.env.local`
 * and passes it to the child, layered over the project's secrets — so a provider's
 * API key, referenced here by *name*, is already in scope by the time the worker
 * reads it.
 */
export async function buildDualEnv(
  workerName: string,
  config: DualWorkerConfig
): Promise<Record<string, string>> {
  const db = await ensureDb();
  const providers = (await db.getAllProviders()).map(toProvider);
  const effective = await resolveAgainstSourceAgent(config);

  const stt = resolveModel(effective.sttModel, providers);
  const llm = resolveModel(effective.llmModel, providers);

  const env: Record<string, string> = {
    DUAL_AGENT_NAME: workerName,
    DUAL_STT_PLUGIN: stt.plugin,
    DUAL_STT_MODEL: stt.model,
    DUAL_STT_BASE_URL: stt.baseUrl || "",
    DUAL_STT_API_KEY_ENV: stt.apiKeySecret || "",
    DUAL_LLM_PLUGIN: llm.plugin,
    DUAL_LLM_MODEL: llm.model,
    DUAL_LLM_BASE_URL: llm.baseUrl || "",
    DUAL_LLM_API_KEY_ENV: llm.apiKeySecret || "",
    DUAL_LANGUAGE: effective.language,
    DUAL_TURN_DETECTOR: effective.turnDetector,
    DUAL_NOISE_CANCELLATION: effective.noiseCancellation,
    DUAL_AUDIO_CHUNK_MS: String(normalizeAudioChunkMs(effective.audioChunkMs)),
    DUAL_SUGGEST_FOR: effective.suggestFor,
    DUAL_MIC_ROLE: effective.micRole,
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
    env.DUAL_INSTRUCTIONS = JSON.stringify(effective.instructions);
  }

  return env;
}

/**
 * Writes and starts the worker for a sandbox, creating its `agents` row on the
 * first deploy and updating it after that.
 */
export async function deployDualWorker(
  sandboxName: string,
  config: DualWorkerConfig,
  deployer: { email: string; name: string }
): Promise<{ workerName: string; pid: number }> {
  const workerName = dualWorkerName(sandboxName);
  const source = readWorkerSource();

  const db = await ensureDb();
  const existing = await db.findAgentByName(workerName);
  // `kind` is what tells the agents page this row is not a builder agent — its
  // config has no instructions, voice or tools to open in the builder.
  const storedConfig = JSON.stringify({ kind: "agent-assist-dual", assist: config });
  if (existing) {
    await db.updateAgent(existing.id, workerName, storedConfig, "deployed");
  } else {
    await db.createAgent(workerName, storedConfig, "deployed");
  }

  // Project secrets first (they hold the provider API keys), then the worker's
  // own — the same precedence the builder's deploy uses — and the derived env
  // last, since it is computed rather than user-entered.
  const secrets: Record<string, string> = {};
  for (const s of await db.getAllSecrets()) secrets[s.name] = s.value;
  for (const s of await db.getAgentSecrets(workerName)) secrets[s.key] = s.value;
  Object.assign(secrets, await buildDualEnv(workerName, config));

  const { pid } = await deployAgent(workerName, source, secrets);
  await db.addAgentVersion(workerName, deployer.email, deployer.name);

  return { workerName, pid };
}

/**
 * Redeploys every dual-track worker that takes its models from `agentName`.
 *
 * Called when that agent is deployed from the builder, alongside the
 * per-participant workers' equivalent in `agent-assist.ts`. Without it, "the agent
 * is the source of truth" would only hold until you edited the agent: the worker's
 * models live in an `.env.local` written at deploy, so it would keep running the
 * old ones with nothing on screen saying so.
 *
 * Failures are collected, not thrown — the agent's own deploy succeeded, and that
 * is what the caller asked for.
 */
export async function redeployDualWorkersSourcedFrom(
  agentName: string,
  deployer: { email: string; name: string }
): Promise<{ worker: string; error?: string }[]> {
  const db = await ensureDb();
  const results: { worker: string; error?: string }[] = [];

  for (const app of await db.getAllSandboxApps()) {
    if (app.template !== "agent-assist-dual-react") continue;
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(app.settings || "{}");
    } catch {
      continue;
    }
    // Only a worker this sandbox owns: one it merely dispatches belongs to
    // whichever sandbox deployed it, and that one will redeploy it itself.
    if (!settings.assistWorker || typeof settings.assist !== "object" || !settings.assist) continue;
    const assist = settings.assist as Partial<DualWorkerConfig>;
    if (assist.sourceAgent !== agentName) continue;

    try {
      const { workerName } = await deployDualWorker(
        app.name,
        normalizeDualConfig(assist),
        deployer
      );
      results.push({ worker: workerName });
    } catch (err) {
      results.push({
        worker: dualWorkerName(app.name),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
