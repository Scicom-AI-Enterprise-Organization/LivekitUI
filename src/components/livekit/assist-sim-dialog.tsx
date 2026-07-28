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
  transcript?: { role?: string; text?: string }[];
  suggestions?: string[];
  errors?: unknown[];
  metrics?: Record<string, number>;
}

export function AssistSimDialog({
  app,
  onClose,
}: {
  app: { name: string; url: string };
  onClose: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState<SimSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const command = [
    `curl -X POST ${origin}/api/assist-sim \\`,
    `  -H "Authorization: Bearer $TOKEN" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"sandbox": "${app.name}"}'`,
  ].join("\n");

  const run = async () => {
    setRunning(true);
    setElapsed(0);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/assist-sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandbox: app.name }),
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
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Simulate a call on {app.name}</DialogTitle>
          <DialogDescription>
            Two synthetic speakers join the room and talk through this sandbox&apos;s own TTS, so
            the worker can be tested without two people in two browsers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
                : `Takes about a minute. Runs in assist-${app.name}-sim, so it cannot overwrite the sandbox's own call history.`}
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
                          {line.role}
                        </span>{" "}
                        {line.text?.trim()}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-destructive">
                    Nothing was transcribed — no worker in the room, or its STT is failing.
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

              <div className="text-muted-foreground">
                {summary.suggestions?.length
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
              <code>example/agent-assist-sim/README.md</code>.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
