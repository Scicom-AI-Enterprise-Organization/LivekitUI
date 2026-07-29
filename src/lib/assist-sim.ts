import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { ensureDb } from "./db";
import { getPythonBin } from "./agent-runner";
import { resolveModel, type Provider, type ProviderModel, type ProviderVoice } from "./providers";
import type { DbProvider } from "./db";

/**
 * A simulated two-speaker call.
 *
 * The agent-assist template needs two *humans* in one room, which makes it the
 * one thing in this dashboard that cannot be exercised by opening a page — and
 * the per-speaker metrics timeline it feeds cannot be checked without a call
 * that had two speakers in it. This runs one: `example/agent-assist-sim` joins
 * the room twice as ordinary participants, speaks a scripted conversation
 * through the project's own TTS, and reports what came back on the worker's
 * topics.
 *
 * Everything about the run is resolved here rather than in the script — models,
 * keys, the worker to dispatch — so the script stays a dumb executor and the
 * same provider resolution the workers use decides what it speaks with.
 */

/** Where a run's log and config live; a run is inspectable after it finishes. */
function simDir(): string {
  return path.join(process.cwd(), "data", "sim-runs");
}

export interface SimTurn {
  role: "agent" | "customer";
  text: string;
}

/**
 * A support call with something to coach: the customer arrives with a problem,
 * the agent handles it imperfectly. Short lines on purpose — every turn is a
 * synthesis, a transcription and a turn-detector run, so a long script costs
 * minutes without testing anything the short one misses.
 */
export const DEFAULT_TURNS: SimTurn[] = [
  { role: "agent", text: "Thank you for calling support, my name is Sim. How can I help you?" },
  { role: "customer", text: "My internet has been down since this morning and I work from home." },
  { role: "agent", text: "I see. Let me take a look at that for you." },
  { role: "customer", text: "I already restarted the router twice and it did not help at all." },
  { role: "agent", text: "Understood. Can you tell me the colour of the lights on the router?" },
];

export interface SimRun {
  id: string;
  room: string;
  dispatch: string;
  pid: number;
  startedAt: string;
  log: string;
}

/** Runs of this process, so a caller can poll one it started. */
const runs = new Map<string, SimRun>();

function toProvider(row: DbProvider): Provider {
  const parse = <T>(raw: string, fallback: T): T => {
    try {
      return (JSON.parse(raw) ?? fallback) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    plugin: row.plugin,
    baseUrl: row.base_url,
    apiKeySecret: row.api_key_secret,
    audioFormat: row.audio_format,
    models: parse<ProviderModel[]>(row.models, []),
    voices: parse<ProviderVoice[]>(row.voices, []),
    builtin: !!row.builtin,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Providers in the shape `resolveModel` wants, from the database. */
export async function loadProviders(): Promise<Provider[]> {
  const db = await ensureDb();
  return (await db.getAllProviders()).map(toProvider);
}

/** Secret values by name, for turning a provider's `apiKeySecret` into a key. */
export async function loadSecrets(): Promise<Record<string, string>> {
  const db = await ensureDb();
  const secrets: Record<string, string> = {};
  for (const s of await db.getAllSecrets()) secrets[s.name] = s.value;
  return secrets;
}

/**
 * The TTS an agent speaks with, resolved for a *simulated* speaker to borrow.
 * There is nothing else to borrow from: a voice is configured on agents, not on
 * sandboxes, and an assist worker has none at all.
 */
export async function ttsFromAgent(
  agentName: string
): Promise<{ plugin: string; model: string; baseUrl: string; apiKey: string; format: string; voice: string }> {
  const db = await ensureDb();
  const row = await db.findAgentByName(agentName);
  if (!row) throw new Error(`No agent named "${agentName}".`);

  let ttsModel = "";
  let ttsVoice = "";
  try {
    const config = JSON.parse(row.config || "{}") as Record<string, unknown>;
    ttsModel = typeof config.ttsModel === "string" ? config.ttsModel : "";
    ttsVoice = typeof config.ttsVoice === "string" ? config.ttsVoice : "";
  } catch {}
  if (!ttsModel) {
    throw new Error(`"${agentName}" has no TTS configured, so there is no voice to speak with.`);
  }

  const tts = resolveModel(ttsModel, await loadProviders());
  const secrets = await loadSecrets();
  return {
    plugin: tts.plugin,
    model: tts.model,
    baseUrl: tts.baseUrl || "",
    apiKey: tts.apiKeySecret ? secrets[tts.apiKeySecret] || "" : "",
    format: tts.audioFormat || "",
    voice: ttsVoice,
  };
}

/**
 * The agents a simulation can use, and which of them can lend a voice.
 *
 * Read from the `agents` table rather than from live workers, so the list is the
 * things you can name — `/api/agents` also reports ephemeral job identities like
 * `agent-AJ_…`, which are useless as a choice. `hasVoice` is false for an assist
 * worker: it is an agent with the speaking half removed, so there is no TTS in it
 * to borrow.
 */
export async function listSimAgents(): Promise<{ name: string; hasVoice: boolean }[]> {
  const db = await ensureDb();
  return (await db.getAllAgents())
    .map((row) => {
      let ttsModel = "";
      try {
        ttsModel = (JSON.parse(row.config || "{}") as { ttsModel?: string }).ttsModel ?? "";
      } catch {}
      return { name: row.name, hasVoice: Boolean(ttsModel) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SimRequest {
  /** Sandbox to test; supplies the room, the worker to dispatch and the voice. */
  sandbox?: string;
  /** Overrides the room. Defaults to the sandbox's own room. */
  room?: string;
  /** Agent whose TTS the speakers borrow. Defaults to the sandbox's source agent. */
  agent?: string;
  /**
   * Per-speaker voices, each naming an agent to borrow one from. Two speakers in
   * one voice is hard to follow in the recording, and telling them apart by ear is
   * half of reviewing an assist call.
   */
  agentVoice?: string;
  customerVoice?: string;
  turns?: SimTurn[];
  gapMs?: number;
  warmupMs?: number;
  drainMs?: number;
}

interface ResolvedSim {
  config: Record<string, unknown>;
  room: string;
  dispatch: string;
}

/**
 * Turns a request into the config the script runs on.
 *
 * The voice comes from an *agent* rather than from the assist config, because an
 * assist worker has no TTS at all — it is an agent with the speaking half removed
 * — so there is nothing in it to speak with. The sandbox's `sourceAgent` is the
 * natural donor: it is already the place its models live.
 */
export async function resolveSim(request: SimRequest): Promise<ResolvedSim> {
  const db = await ensureDb();

  let room = request.room?.trim() || "";
  let dispatch = "";
  let agentName = request.agent?.trim() || "";

  if (request.sandbox) {
    const app = (await db.getAllSandboxApps()).find((a) => a.name === request.sandbox);
    if (!app) throw new Error(`No sandbox named "${request.sandbox}".`);
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(app.settings || "{}");
    } catch {}
    // A room of its own, *not* the sandbox's (`assist-<name>`). History keeps one
    // row per room name, so a simulated call in the sandbox's own room would
    // replace the record of the last real call made there. Pass `room` explicitly
    // to aim at it anyway.
    room ||= `assist-${app.name}-sim`;
    dispatch =
      (typeof settings.agentName === "string" && settings.agentName) ||
      (typeof settings.agentDispatch === "string" && settings.agentDispatch) ||
      "";
    const assist = (settings.assist ?? {}) as Record<string, unknown>;
    if (!agentName && typeof assist.sourceAgent === "string") agentName = assist.sourceAgent;
  }

  if (!room) throw new Error("A room is required (pass `room` or `sandbox`).");

  const providers = (await db.getAllProviders()).map(toProvider);

  // Any deployed agent will do for a voice; the caller only has to name one when
  // the sandbox references none.
  const agentRow = agentName ? await db.findAgentByName(agentName) : null;
  if (agentName && !agentRow) throw new Error(`No agent named "${agentName}".`);
  let ttsModel = "";
  let ttsVoice = "";
  if (agentRow) {
    try {
      const config = JSON.parse(agentRow.config || "{}") as Record<string, unknown>;
      ttsModel = typeof config.ttsModel === "string" ? config.ttsModel : "";
      ttsVoice = typeof config.ttsVoice === "string" ? config.ttsVoice : "";
    } catch {}
  }
  if (!ttsModel) {
    throw new Error(
      "No TTS to speak with. Pass `agent` naming an agent that has one, or point " +
        "the sandbox at a source agent."
    );
  }

  const tts = resolveModel(ttsModel, providers);
  const secrets: Record<string, string> = {};
  for (const s of await db.getAllSecrets()) secrets[s.name] = s.value;

  // Only the voice *string* is taken per speaker, not a whole spec: both speakers
  // share one TTS client in the script, so two agents on different providers
  // would need a second one. Same provider, two voices is the case worth having.
  const voiceOf = async (name?: string) => {
    if (!name) return ttsVoice;
    try {
      return (await ttsFromAgent(name)).voice || ttsVoice;
    } catch {
      return ttsVoice;
    }
  };
  const voices = {
    agent: await voiceOf(request.agentVoice),
    customer: await voiceOf(request.customerVoice),
  };

  const config = {
    url: process.env.LIVEKIT_URL || "ws://localhost:7880",
    apiKey: process.env.LIVEKIT_API_KEY || "",
    apiSecret: process.env.LIVEKIT_API_SECRET || "",
    room,
    dispatch,
    agentName: "Sim Agent",
    customerName: "Sim Customer",
    tts: {
      plugin: tts.plugin,
      model: tts.model,
      baseUrl: tts.baseUrl || "",
      apiKey: tts.apiKeySecret ? secrets[tts.apiKeySecret] || "" : "",
      format: tts.audioFormat || "",
      voices,
    },
    turns: request.turns?.length ? request.turns : DEFAULT_TURNS,
    gapMs: request.gapMs ?? 1500,
    warmupMs: request.warmupMs ?? 6000,
    drainMs: request.drainMs ?? 8000,
  };

  return { config, room, dispatch };
}

export interface SimResult extends SimRun {
  exitCode: number | null;
  /** The script's own summary — transcript, suggestions, metrics per speaker. */
  summary: unknown;
  output: string;
}

/**
 * Starts a run. With `wait` it resolves when the call is over, which is what
 * makes this usable from one curl: a run reports whether the worker transcribed
 * both speakers and what the timeline will draw.
 */
export async function runSim(
  request: SimRequest & { wait?: boolean; timeoutMs?: number }
): Promise<SimRun | SimResult> {
  const { config, room, dispatch } = await resolveSim(request);
  return runSimulator({
    script: path.join(process.cwd(), "example", "agent-assist-sim", "simulate.py"),
    config,
    room,
    dispatch,
    wait: request.wait,
    timeoutMs: request.timeoutMs,
  });
}

/**
 * Runs a simulator script against a config, and reports what it left behind.
 *
 * Shared with the voice-agent simulator (`voice-sim.ts`): the two speak to
 * different things, but starting a detached Python child, keeping its log where a
 * finished run can still be inspected, and reading its summary back are the same
 * job either way.
 */
export async function runSimulator({
  script,
  config,
  room,
  dispatch,
  wait,
  timeoutMs,
}: {
  script: string;
  config: Record<string, unknown>;
  room: string;
  dispatch: string;
  wait?: boolean;
  timeoutMs?: number;
}): Promise<SimRun | SimResult> {
  if (!config.apiKey || !config.apiSecret) {
    throw new Error("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set to join a room.");
  }

  if (!fs.existsSync(script)) throw new Error(`Simulator not found at ${script}`);

  fs.mkdirSync(simDir(), { recursive: true });
  const id = `sim-${Date.now().toString(36)}`;
  const configFile = path.join(simDir(), `${id}.json`);
  const logFile = path.join(simDir(), `${id}.log`);
  const resultFile = path.join(simDir(), `${id}.result.json`);
  fs.writeFileSync(configFile, JSON.stringify({ ...config, resultFile }, null, 2));

  const child = spawn(getPythonBin(), [script, configFile], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const append = (chunk: Buffer) => {
    output += chunk.toString();
    fs.appendFileSync(logFile, chunk);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const run: SimRun = {
    id,
    room,
    dispatch,
    pid: child.pid ?? 0,
    startedAt: new Date().toISOString(),
    log: logFile,
  };
  runs.set(id, run);

  if (!wait) return run;

  const limit = timeoutMs ?? 240_000;
  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(null);
    }, limit);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  return { ...run, exitCode, summary: readSummary(resultFile), output };
}

/**
 * The run's own summary. The script writes it to a file rather than leaving it
 * as the last thing on stdout: the LiveKit SDK logs from its own threads, so
 * whatever raced to the end of the output is not reliably the summary.
 */
function readSummary(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function getSimRun(id: string): (SimRun & { output: string }) | null {
  const run = runs.get(id);
  const logFile = run?.log ?? path.join(simDir(), `${id}.log`);
  if (!fs.existsSync(logFile)) return null;
  const output = fs.readFileSync(logFile, "utf8");
  return {
    id,
    room: run?.room ?? "",
    dispatch: run?.dispatch ?? "",
    pid: run?.pid ?? 0,
    startedAt: run?.startedAt ?? "",
    log: logFile,
    output,
  };
}
