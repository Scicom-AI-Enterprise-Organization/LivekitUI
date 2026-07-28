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

export interface SimRequest {
  /** Sandbox to test; supplies the room, the worker to dispatch and the voice. */
  sandbox?: string;
  /** Overrides the room. Defaults to the sandbox's own room. */
  room?: string;
  /** Agent whose TTS the speakers borrow. Defaults to the sandbox's source agent. */
  agent?: string;
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
    // The room the sandbox itself uses, so the call lands where its history does.
    room ||= `assist-${app.name}`;
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
      // One voice, two speakers: the STT does not care and a second voice would
      // need a second provider lookup for no test coverage.
      voices: { agent: ttsVoice, customer: ttsVoice },
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

  if (!config.apiKey || !config.apiSecret) {
    throw new Error("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set to join a room.");
  }

  const script = path.join(process.cwd(), "example", "agent-assist-sim", "simulate.py");
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

  if (!request.wait) return run;

  const timeoutMs = request.timeoutMs ?? 240_000;
  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(null);
    }, timeoutMs);
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
