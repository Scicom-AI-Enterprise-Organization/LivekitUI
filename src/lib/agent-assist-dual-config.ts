/**
 * Shape and defaults of the **dual-track assist** worker's configuration.
 *
 * Node-free on purpose: the sandbox pages are client components and import this
 * for their forms, while `agent-assist-dual.ts` (which spawns processes and reads
 * the worker source off disk) imports it too. Same rule as `providers.ts` —
 * nothing from `fs`, `path` or a server-only module may appear here.
 *
 * The config is `AssistWorkerConfig` plus one field. That is deliberate: the two
 * workers are separate Python programs, but the *decisions* — which STT, which
 * coaching model, which turn detector, what the prompt says — are the same
 * decisions, so `AssistSettings` renders both and there is one normalizer to keep
 * honest. What is genuinely new here is how a leg is identified, which the
 * per-participant worker has no equivalent of.
 */

import {
  DEFAULT_ASSIST_CONFIG,
  normalizeAssistConfig,
  type AssistWorkerConfig,
} from "./agent-assist-config";

/** Template directory under `example/`, and the sandbox's `template` column. */
export const ASSIST_DUAL_TEMPLATE = "agent-assist-dual-react";

/** Appended to the sandbox name to get the worker's agent name. */
export const ASSIST_DUAL_WORKER_SUFFIX = "-assist-dual";

/**
 * Where the worker's source lives. Like the per-participant assist worker this
 * one ships in this repo rather than in `livekit-examples`, so the link points at
 * the copy the dashboard actually deploys.
 */
export const ASSIST_DUAL_SOURCE_URL =
  "https://github.com/Scicom-AI-Enterprise-Organization/LivekitUI/tree/main/example/agent-assist-dual-python";

export function dualWorkerName(sandboxName: string): string {
  return `${sandboxName}${ASSIST_DUAL_WORKER_SUFFIX}`;
}

export type DualMicRole = "agent" | "customer";

export interface DualWorkerConfig extends AssistWorkerConfig {
  /**
   * Which role the `Microphone`-source track belongs to, used **only** when the
   * track's name settles nothing.
   *
   * The sandbox names both of its tracks (`agent_audio`, `customer_audio`), so
   * this never fires for a call it publishes. It exists for an external publisher
   * — a laptop app, a SIP bridge — that publishes two unnamed tracks, and it has
   * to be a setting rather than an assumption: on a real desk the microphone is
   * the support agent, but a publisher testing with two audio files has no reason
   * to put the microphone leg on the side a real desk would. Getting it backwards
   * gives a transcript that is right in every respect except who said what, which
   * nobody notices until the coaching starts answering the wrong person.
   */
  micRole: DualMicRole;
}

export const MIC_ROLE_OPTIONS: { id: DualMicRole; label: string; hint: string }[] = [
  {
    id: "agent",
    label: "Microphone is the support agent",
    hint: "A real desk: their headset is the microphone, and the caller arrives as screen-share audio.",
  },
  {
    id: "customer",
    label: "Microphone is the customer",
    hint: "Inverted, as a test publisher streaming two files often is. Only ever read for an unnamed track.",
  },
];

/**
 * Only a starting point. The create dialog replaces either model with the first
 * one the deployment's providers actually offer, so a self-hosted install with no
 * OpenAI key does not default to a model it cannot reach.
 */
export const DEFAULT_DUAL_CONFIG: DualWorkerConfig = {
  ...DEFAULT_ASSIST_CONFIG,
  micRole: "agent",
};

/**
 * Coerces whatever the client sent into a config the worker can run.
 *
 * Delegates the shared fields, so a field added to the assist config is validated
 * here too rather than silently skipped — the failure mode being avoided is a
 * value reaching the worker's environment unchecked, where a bad one is a worker
 * that registers and then dies on the first call.
 */
export function normalizeDualConfig(input: unknown): DualWorkerConfig {
  const raw = (input ?? {}) as Partial<Record<keyof DualWorkerConfig, unknown>>;
  const micRole = typeof raw.micRole === "string" ? raw.micRole.trim() : "";
  return {
    ...normalizeAssistConfig(input),
    micRole: micRole === "customer" ? "customer" : "agent",
  };
}
