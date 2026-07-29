"use client";

import { useEffect, useState } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CodeBlock } from "@/components/livekit/code-block";
import Link from "next/link";

/**
 * Runs a simulated two-speaker call against an assist sandbox.
 *
 * The template needs two humans on one link, so there is no way to try it from
 * one browser — which made it the one sandbox you could deploy and not be able to
 * test. This is the button that does it: two synthetic speakers join, talk through
 * the sandbox's own TTS, and the run reports whether the worker transcribed both,
 * detected turns, and coached.
 *
 * It reports **per speaker**, because that is the thing most likely to be wrong
 * and invisible: a call where only one side was transcribed looks fine until you
 * read the counts.
 */

interface SimSummary {
  room?: string;
  /** assist: one line per speaker turn. */
  transcript?: { role?: string; text?: string; from?: string }[];
  suggestions?: string[];
  errors?: unknown[];
  metrics?: Record<string, number>;
  /** voice: whether an agent ever joined, and whether each turn was answered. */
  agentJoined?: boolean;
  replies?: string[];
}

/**
 * Which call this is. An assist room has two humans and a worker that only
 * listens; a voice room has one caller and an agent that answers — different
 * endpoints, and different things worth reporting back.
 */
export type SimMode = "assist" | "voice";

export function AssistSimDialog({
  app,
  mode,
  onClose,
}: {
  app: { name: string; url: string };
  mode: SimMode;
  onClose: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState<SimSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<{ name: string; hasVoice: boolean }[]>([]);
  // Empty means "whatever the sandbox already points at", resolved server-side.
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");

  // Asked of the endpoint that will run the call, not of `/api/agents`: it knows
  // which agents can lend a voice, and it leaves out the ephemeral `agent-AJ_…`
  // job identities that are not a choice anyone can make.
  useEffect(() => {
    fetch(mode === "voice" ? "/api/voice-sim" : "/api/assist-sim")
      .then((res) => res.json())
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => {});
  }, [mode]);

  // A run is a real call: the speakers wait for the worker to load its models,
  // talk, and then wait for the transcripts to catch up. Saying how long it has
  // been running is the difference between "working" and "hung".
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const origin = (() => {
    try {
      return new URL(app.url).origin;
    } catch {
      return "";
    }
  })();

  const endpoint = mode === "voice" ? "/api/voice-sim" : "/api/assist-sim";
  const sides =
    mode === "voice"
      ? {
          left: { label: "Caller", hint: "whose voice the synthetic caller speaks with" },
          right: { label: "Agent under test", hint: "dispatched into the room to answer" },
        }
      : {
          left: { label: "Support agent", hint: "whose voice this speaker uses" },
          right: { label: "Customer", hint: "whose voice this speaker uses" },
        };
  const room = mode === "voice" ? `sim-${app.name}` : `assist-${app.name}-sim`;

  // Mirrors the dropdowns, so the copied command runs the call on screen.
  const body: Record<string, string> = { sandbox: app.name };
  if (mode === "voice") {
    if (left) body.callerAgent = left;
    if (right) body.agent = right;
  } else {
    if (left) body.agentVoice = left;
    if (right) body.customerVoice = right;
  }
  const command = [
    `curl -X POST ${origin}${endpoint} \\`,
    `  -H "Authorization: Bearer $TOKEN" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${JSON.stringify(body)}'`,
  ].join("\n");

  const run = async () => {
    setRunning(true);
    setElapsed(0);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandbox: app.name,
          ...(mode === "voice"
            ? { callerAgent: left || undefined, agent: right || undefined }
            : { agentVoice: left || undefined, customerVoice: right || undefined }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `The run failed (HTTP ${res.status}).`);
      } else {
        setSummary((data.run?.summary as SimSummary) ?? null);
        if (!data.run?.summary) {
          setError("The call ran but reported nothing — check the worker's logs.");
        }
      }
    } catch {
      setError("Could not reach the dashboard API.");
    } finally {
      setRunning(false);
    }
  };

  const metrics = Object.entries(summary?.metrics ?? {});

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/*
        `[&>*]:min-w-0` is load-bearing. DialogContent is a grid, and a grid item
        defaults to `min-width: auto` — it refuses to shrink below its content, so
        the curl block's longest line (which grows once both agents are chosen,
        adding `"callerAgent":…,"agent":…`) widened the column past the dialog.
        Because `overflow-y-auto` forces `overflow-x` to `auto` as well, the whole
        dialog scrolled sideways and clipped the header, the selects and the hint
        text — while the CodeBlock's own `overflow-x-auto` never engaged, its
        containing block having already been stretched to fit. Letting the item
        shrink puts the scrolling back inside the CodeBlock, where it belongs.
      */}
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Simulate a call on {app.name}</DialogTitle>
          <DialogDescription>
            {mode === "voice"
              ? "A synthetic caller joins and talks to the agent, taking turns like a person — so the timeline has the whole chain in it: speech recognised, turn ended, model answered, voice synthesised."
              : "Two synthetic speakers join the room and talk through this sandbox's own TTS, so the worker can be tested without two people in two browsers."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            {([
              ["left", left, setLeft, sides.left, true],
              ["right", right, setRight, sides.right, mode !== "voice"],
            ] as const).map(([key, value, set, side, voiceOnly]) => (
              <div key={key} className="space-y-1">
                <label
                  htmlFor={`sim-${key}`}
                  className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  {side.label}
                </label>
                <select
                  id={`sim-${key}`}
                  value={value}
                  disabled={running}
                  onChange={(e) => set(e.target.value)}
                  className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
                >
                  <option value="">Sandbox default</option>
                  {agents
                    .filter((a) => !voiceOnly || a.hasVoice)
                    .map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name}
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-muted-foreground">{side.hint}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={run} disabled={running} className="gap-1.5">
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PlayCircle className="size-3.5" />
              )}
              {running ? `Calling… ${elapsed}s` : "Run simulated call"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {running
                ? "Speaking a five-line support call; about a minute."
                : `Takes about a minute. Runs in ${room}, so it cannot overwrite the sandbox's own call history.`}
            </span>
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {summary && (
            <div className="space-y-3 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs">
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  Heard
                </div>
                {summary.transcript?.length ? (
                  <ul className="space-y-0.5">
                    {summary.transcript.map((line, i) => (
                      <li key={i} className="text-foreground/90">
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          {line.role ?? (line.from?.startsWith("sim-") ? "caller" : "agent")}
                        </span>{" "}
                        {line.text?.trim()}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-destructive">
                    {mode === "voice"
                      ? "Nothing was transcribed — no agent in the room, or its STT is failing."
                      : "Nothing was transcribed — no worker in the room, or its STT is failing."}
                  </p>
                )}
              </div>

              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  Metrics per speaker
                </div>
                {metrics.length ? (
                  <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                    {metrics.map(([key, count]) => (
                      <span key={key} className="rounded border px-1.5 py-0.5 text-muted-foreground">
                        {key.replace("_metrics", "").replace("_inference", "")} · {count}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    None published. The timeline for this call will be empty.
                  </p>
                )}
              </div>

              {mode === "voice" && summary.agentJoined === false && (
                <p className="text-destructive">
                  No agent ever joined. A sandbox on auto-dispatch never matches an agent
                  deployed from the Builder — set Dispatch to agent.
                </p>
              )}

              {mode === "voice" && summary.replies?.some((r) => r !== "replied") && (
                <p className="text-destructive">
                  {summary.replies.filter((r) => r !== "replied").length} turn(s) went
                  unanswered — the agent never spoke before the wait ran out.
                </p>
              )}

              <div className="text-muted-foreground">
                {mode === "voice" ? (
                  `${summary.replies?.filter((r) => r === "replied").length ?? 0} of ${summary.replies?.length ?? 0} turns answered.`
                ) : summary.suggestions?.length
                  ? `${summary.suggestions.length} coaching note${summary.suggestions.length === 1 ? "" : "s"} written.`
                  : "No coaching notes — the model answered nothing, or none was configured."}
                {Array.isArray(summary.errors) && summary.errors.length > 0 && (
                  <span className="text-destructive">
                    {" "}
                    {summary.errors.length} error{summary.errors.length === 1 ? "" : "s"} reported.
                  </span>
                )}
              </div>

              <p className="text-muted-foreground">
                Room <code>{summary.room}</code> — replay it in{" "}
                <Link href="/sessions/history" className="text-primary hover:underline">
                  Sessions → History
                </Link>{" "}
                with its audio, transcript and timeline.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Or from a terminal
            </div>
            <CodeBlock code={command} />
            <p className="text-xs text-muted-foreground">
              <code>$TOKEN</code> comes from{" "}
              <Link href="/settings/access-tokens" className="text-primary hover:underline">
                Settings → Access tokens
              </Link>
              . Pass <code>turns</code> to say your own lines; see{" "}
              <code>
                example/{mode === "voice" ? "agent-voice-sim" : "agent-assist-sim"}/README.md
              </code>
              .
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
