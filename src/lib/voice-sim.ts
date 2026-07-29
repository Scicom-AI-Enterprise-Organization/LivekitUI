import path from "path";
import { ensureDb } from "./db";
import { runSimulator, ttsFromAgent, type SimResult, type SimRun } from "./assist-sim";

/**
 * A simulated caller for a voice-agent sandbox.
 *
 * The voice agent's timeline is the only one that has the whole chain in it —
 * speech recognised, turn ended, model answered, voice synthesised — and every
 * link needs somebody to talk to the agent. `example/agent-voice-sim` is that
 * somebody: it joins as an ordinary participant and takes turns.
 *
 * The caller publishes **no metrics of its own**, so everything on the room's
 * metric topic came from the agent and the timeline reads exactly as it would for
 * a human caller. That is the difference between a useful test and a plot with
 * two agents' numbers mixed into it.
 *
 * Separate from `assist-sim.ts` because the two calls are not the same shape: an
 * assist room has two humans and no agent speech, a voice room has one human and
 * an agent that answers, and its pacing has to wait for that answer. They share
 * the spawn, the voice lookup and the run log.
 */

/** A caller with a problem, phrased so a support agent has something to answer. */
export const DEFAULT_TURNS = [
  "Hi, can you hear me?",
  "My internet has been down since this morning and I work from home.",
  "I already restarted the router twice and it did not help.",
  "What should I try next?",
];

export interface VoiceSimRequest {
  /** Sandbox to test; supplies the agent to dispatch and the voice. */
  sandbox?: string;
  room?: string;
  /** The agent under test — the one dispatched into the room. */
  agent?: string;
  /**
   * Whose voice the *caller* speaks with. Defaults to the agent under test,
   * which makes both sides sound identical in the recording — pick a different
   * one and the two are told apart by ear.
   */
  callerAgent?: string;
  turns?: string[];
  gapMs?: number;
  replyTimeoutMs?: number;
  drainMs?: number;
  wait?: boolean;
  timeoutMs?: number;
}

export async function runVoiceSim(request: VoiceSimRequest): Promise<SimRun | SimResult> {
  const db = await ensureDb();

  let room = request.room?.trim() || "";
  let agentName = request.agent?.trim() || "";
  let dispatch = agentName;

  if (request.sandbox) {
    const app = (await db.getAllSandboxApps()).find((a) => a.name === request.sandbox);
    if (!app) throw new Error(`No sandbox named "${request.sandbox}".`);
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(app.settings || "{}");
    } catch {}
    const configured =
      typeof settings.agentDispatch === "string" && settings.agentDispatch !== "__auto__"
        ? settings.agentDispatch
        : "";
    // A sandbox on auto-dispatch names no agent, but a voice still has to come
    // from one — so the caller may have to say which.
    dispatch = dispatch || configured;
    agentName = agentName || configured;
    // Its own room, never the app's: history keeps one row per room name, and a
    // simulated call must not replace the record of a real one.
    room ||= `sim-${app.name}`;
  }

  if (!room) throw new Error("A room is required (pass `room` or `sandbox`).");
  if (!agentName) {
    throw new Error(
      "No agent to borrow a voice from. Pass `agent`, or set the sandbox's " +
        "Dispatch to agent instead of auto-dispatch."
    );
  }

  const tts = await ttsFromAgent(request.callerAgent?.trim() || agentName);

  const config = {
    url: process.env.LIVEKIT_URL || "ws://localhost:7880",
    apiKey: process.env.LIVEKIT_API_KEY || "",
    apiSecret: process.env.LIVEKIT_API_SECRET || "",
    room,
    dispatch,
    callerName: "Sim Caller",
    tts,
    turns: request.turns?.length ? request.turns : DEFAULT_TURNS,
    // Shorter than the assist simulator's: nobody is waiting on a turn detector
    // to decide the caller stopped — the agent's own endpointing does that.
    gapMs: request.gapMs ?? 800,
    // A reply is a model call and a synthesis, and a cold endpoint makes both
    // slow; too short a wait and the next line lands on a talking agent.
    replyTimeoutMs: request.replyTimeoutMs ?? 25_000,
    drainMs: request.drainMs ?? 4000,
  };

  return runSimulator({
    script: path.join(process.cwd(), "example", "agent-voice-sim", "simulate.py"),
    config,
    room,
    dispatch,
    wait: request.wait,
    timeoutMs: request.timeoutMs,
  });
}
