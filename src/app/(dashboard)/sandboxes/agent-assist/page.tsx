"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown, Code, Headphones, Info, Loader2, Sparkles } from "lucide-react";
import { AssistSettings } from "@/components/livekit/assist-settings";
import {
  ASSIST_TEMPLATE,
  ASSIST_WORKER_SUFFIX,
  DEFAULT_ASSIST_CONFIG,
  assistWorkerName,
  type AssistWorkerConfig,
} from "@/lib/agent-assist-config";
import { listModels, type ModelKind, type Provider } from "@/lib/providers";

/**
 * `preferred` if this deployment can actually run it, else the first model that
 * it can.
 *
 * "Can run" means the provider's API-key secret exists — `/api/providers` reports
 * that as `secretMissing`. Without the check, a self-hosted install defaults to
 * OpenAI Whisper (which *is* in the seeded provider list) and the worker deploys
 * happily, then 401s on the first utterance with nothing on screen to explain it.
 */
function firstAvailable(providers: Provider[], kind: ModelKind, preferred: string): string {
  const options = listModels(providers, kind);
  const usable = (p: Provider) => !(p as Provider & { secretMissing?: boolean }).secretMissing;

  if (options.some((o) => o.ref === preferred && usable(o.provider))) return preferred;
  return options.find((o) => usable(o.provider))?.ref || options[0]?.ref || preferred;
}

/** Sentinel for the reuse dropdown — a Select item may not have an empty value. */
const NO_WORKER = "__none__";

export default function AgentAssistTemplatePage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [sandboxPrefix, setSandboxPrefix] = useState("");

  const [agents, setAgents] = useState<{ agentName: string }[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [sandboxName, setSandboxName] = useState("");
  const [deployWorker, setDeployWorker] = useState(true);
  /** Only read when `deployWorker` is off: an existing agent to dispatch instead. */
  const [reuseWorker, setReuseWorker] = useState(NO_WORKER);
  const [assist, setAssist] = useState<AssistWorkerConfig>(DEFAULT_ASSIST_CONFIG);
  const [assistDefaults, setAssistDefaults] = useState<AssistWorkerConfig>(DEFAULT_ASSIST_CONFIG);
  const [workerOpen, setWorkerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    fetch("/api/sandbox-config")
      .then((r) => r.json())
      .then((d) => setSandboxPrefix(d.prefix || ""))
      .catch(() => {});
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => {
        const list: Provider[] = d.providers ?? [];
        setProviders(list);
        // The hardcoded defaults name OpenAI models, which a self-hosted install
        // has no key for. Fall back to whatever this deployment actually offers,
        // and keep it as *the* default so reopening the dialog does not undo it.
        const corrected: AssistWorkerConfig = {
          ...DEFAULT_ASSIST_CONFIG,
          sttModel: firstAvailable(list, "stt", DEFAULT_ASSIST_CONFIG.sttModel),
          llmModel: firstAvailable(list, "llm", DEFAULT_ASSIST_CONFIG.llmModel),
        };
        setAssistDefaults(corrected);
        setAssist(corrected);
      })
      .catch(() => {});
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []))
      .catch(() => {});
  }, []);

  const create = async () => {
    setCreateError("");
    const name = sandboxName.trim() || `agent-assist-${Math.random().toString(36).slice(2, 8)}`;
    setCreating(true);
    try {
      const res = await fetch("/api/sandbox-apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          template: ASSIST_TEMPLATE,
          deployAssist: deployWorker,
          agentName: deployWorker || reuseWorker === NO_WORKER ? "" : reuseWorker,
          assist,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || "Failed to create sandbox");
        return;
      }

      const workerError = data.assistWorker?.error as string | undefined;
      if (workerError) {
        // The sandbox is up; only the Python worker failed. That is nearly always
        // a missing venv, and it is fixable without recreating anything.
        toast.error(`Sandbox created, but the assist worker did not start: ${workerError}`, {
          duration: Infinity,
          closeButton: true,
        });
      } else if (deployWorker) {
        toast.success(`Created ${name} and deployed ${assistWorkerName(name)}`);
      } else if (reuseWorker !== NO_WORKER) {
        toast.success(`Created ${name}, dispatching ${reuseWorker}`);
      } else {
        toast.success(`Created ${name} — no worker, so calls are not transcribed`);
      }

      setDialogOpen(false);
      router.push("/sandboxes");
    } catch {
      setCreateError("Something went wrong");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Agent assist" breadcrumb={[{ label: "Sandboxes", href: "/sandboxes" }]} />

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-8 p-6 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-8">
            {/* Preview */}
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
                <div className="flex gap-1.5">
                  <div className="size-2.5 rounded-full bg-red-500/60" />
                  <div className="size-2.5 rounded-full bg-yellow-500/60" />
                  <div className="size-2.5 rounded-full bg-green-500/60" />
                </div>
                <div className="ml-3 flex-1 rounded bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {sandboxPrefix}agent-assist
                </div>
              </div>

              <div className="grid gap-3 bg-background p-5 md:grid-cols-[1fr_16rem]">
                <div className="space-y-3 rounded-md border border-border p-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Call transcript
                  </div>
                  {[
                    ["Customer", "My invoice is double what it was last month."],
                    ["Support agent", "Let me pull that up for you."],
                    ["Customer", "It says a setup fee, but I've been with you two years."],
                  ].map(([who, line], i) => (
                    <div key={i} className="flex gap-2">
                      <div
                        className={`w-0.5 shrink-0 rounded ${
                          who === "Customer" ? "bg-blue-400" : "bg-emerald-400"
                        }`}
                      />
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {who}
                        </div>
                        <div className="text-sm text-foreground">{line}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-3 rounded-md border border-border p-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Live coaching
                  </div>
                  <div className="rounded-md border border-l-2 border-primary bg-muted/40 p-3 text-sm">
                    Check the billing history before answering — a setup fee on a two-year account
                    is usually a re-provision. Ask which product line it names.
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                    Confirm the amount out loud so they know you have the right line.
                  </div>
                </div>
              </div>
            </div>

            {/* Overview */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">Overview</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                A call between two <em>people</em>, with an AI listening rather than talking. Both
                open the same link, take a seat — support agent or customer — and the worker joins
                silently: it transcribes each of them on their own stream and writes coaching notes
                that only the support agent sees.
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Each side gets its own transcription session, so noise cancellation and end-of-turn
                detection are per person. That is what makes the notes land on finished thoughts
                instead of on every pause for breath.
              </p>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">What runs where</h2>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      [
                        "The sandbox app",
                        "This template. Serves the join screen, the lobby and the two live views, and mints tokens that carry each person's role.",
                      ],
                      [
                        "The assist worker",
                        "example/agent-assist-python, deployed as an ordinary agent. Logs, restart and stop work from the Agents page.",
                      ],
                      [
                        "Session history",
                        "Both sides' transcripts ride on the standard lk.transcription topic, so a captured call replays with them — if capture is on in Settings → Project.",
                      ],
                    ].map(([what, detail]) => (
                      <tr key={what} className="border-b last:border-0">
                        <td className="w-44 px-4 py-3 align-top font-medium text-foreground">
                          {what}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-full shrink-0 space-y-6 lg:w-[280px]">
            <div>
              <h2 className="mb-2 text-lg font-bold text-foreground">Agent assist</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Two humans on a call, transcribed live, with real-time suggestions for the one
                taking it.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setSandboxName("");
                  setCreateError("");
                  setAssist(assistDefaults);
                  setDeployWorker(true);
                  setDialogOpen(true);
                }}
              >
                Create sandbox
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <a href="/api-docs" rel="noopener noreferrer">
                  <Code className="size-3" />
                  API
                </a>
              </Button>
            </div>

            <Alert>
              <Info className="size-4" />
              <AlertTitle>Needs a Python venv</AlertTitle>
              <AlertDescription>
                The worker runs on the same interpreter as builder agents. Without it the sandbox
                still comes up, but nothing transcribes — the deploy error tells you the exact
                commands.
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">About template</h3>
              <div className="space-y-2 text-sm">
                {[
                  ["Application", "Transcription, Agent assist"],
                  ["Type", "Frontend + worker"],
                  ["Tools", "Next.js, TypeScript, Python"],
                  ["Participants", "Two humans, one link"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="text-right text-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Works with</h3>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="gap-1 text-xs">
                  <Headphones className="size-2.5" />
                  Any STT provider
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs">
                  <Sparkles className="size-2.5" />
                  GTCRN + turn detector
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create agent assist</DialogTitle>
            <DialogDescription>
              One link for both people. The worker joins the room silently and coaches the support
              agent while the customer talks.
            </DialogDescription>
          </DialogHeader>

          {createError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {createError}
            </div>
          )}

          <div className="space-y-6 py-2">
            <div className="space-y-2">
              <Label>Sandbox name</Label>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-sm text-muted-foreground">{sandboxPrefix}</span>
                <Input
                  placeholder="support-desk"
                  className="flex-1"
                  value={sandboxName}
                  onChange={(e) => setSandboxName(e.target.value)}
                />
              </div>
              {sandboxName.trim() && (
                <p className="text-xs text-muted-foreground">
                  Both people open {sandboxPrefix}
                  {sandboxName.trim()} · room{" "}
                  <code>assist-{sandboxName.trim()}</code>
                </p>
              )}
            </div>

            <div className="space-y-3">
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  className="mt-0.5"
                  checked={deployWorker}
                  onCheckedChange={(v) => setDeployWorker(v === true)}
                />
                <span className="text-sm leading-snug text-foreground">
                  Deploy a new assist worker as{" "}
                  <code>{assistWorkerName(sandboxName.trim() || "<name>")}</code>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Deleting this sandbox later deletes that worker with it.
                  </span>
                </span>
              </label>

              {!deployWorker && (
                <div className="space-y-1.5 pl-6">
                  <Label className="text-xs">Or dispatch an existing agent</Label>
                  <Select value={reuseWorker} onValueChange={setReuseWorker}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_WORKER}>None — do not transcribe</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.agentName} value={a.agentName}>
                          {a.agentName}
                          {a.agentName.endsWith(ASSIST_WORKER_SUFFIX)
                            ? " · assist worker"
                            : " · voice agent"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    One assist worker can serve any number of these sandboxes — each gets its own
                    room. A <strong>voice agent</strong> from the builder cannot: it binds to
                    whichever human joins first, ignores the other, and replies out loud, so the two
                    people hear a third voice and neither panel here fills in.
                  </p>
                </div>
              )}
            </div>

            <Collapsible open={workerOpen} onOpenChange={setWorkerOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-semibold text-foreground">
                Worker models — copy from an agent, or leave the defaults
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${
                    workerOpen ? "rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                {deployWorker ? (
                  <AssistSettings
                    config={assist}
                    providers={providers}
                    agents={agents}
                    onChange={setAssist}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Enable the worker above to configure it.
                  </p>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={create} disabled={creating}>
              {creating && <Loader2 className="size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
