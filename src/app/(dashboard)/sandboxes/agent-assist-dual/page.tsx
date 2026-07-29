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
import { ChevronDown, Code, Headphones, Info, Loader2, PhoneCall } from "lucide-react";
import { AssistSettings } from "@/components/livekit/assist-settings";
import { MicRoleField } from "@/components/livekit/dual-mic-role-field";
import {
  ASSIST_DUAL_SOURCE_URL,
  ASSIST_DUAL_TEMPLATE,
  ASSIST_DUAL_WORKER_SUFFIX,
  DEFAULT_DUAL_CONFIG,
  dualWorkerName,
  type DualWorkerConfig,
} from "@/lib/agent-assist-dual-config";
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

export default function AgentAssistDualTemplatePage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [sandboxPrefix, setSandboxPrefix] = useState("");
  const [agents, setAgents] = useState<{ agentName: string }[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [sandboxName, setSandboxName] = useState("");
  const [deployWorker, setDeployWorker] = useState(true);
  /** Only read when `deployWorker` is off: an existing agent to dispatch instead. */
  const [reuseWorker, setReuseWorker] = useState(NO_WORKER);
  const [assist, setAssist] = useState<DualWorkerConfig>(DEFAULT_DUAL_CONFIG);
  const [assistDefaults, setAssistDefaults] = useState<DualWorkerConfig>(DEFAULT_DUAL_CONFIG);
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
        const corrected: DualWorkerConfig = {
          ...DEFAULT_DUAL_CONFIG,
          sttModel: firstAvailable(list, "stt", DEFAULT_DUAL_CONFIG.sttModel),
          llmModel: firstAvailable(list, "llm", DEFAULT_DUAL_CONFIG.llmModel),
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
    const name = sandboxName.trim() || `assist-dual-${Math.random().toString(36).slice(2, 8)}`;
    setCreating(true);
    try {
      const res = await fetch("/api/sandbox-apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          template: ASSIST_DUAL_TEMPLATE,
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
        toast.error(`Sandbox created, but the worker did not start: ${workerError}`, {
          duration: Infinity,
          closeButton: true,
        });
      } else if (deployWorker) {
        toast.success(`Created ${name} and deployed ${dualWorkerName(name)}`);
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
      <TopBar
        title="Agent assist · dual track"
        breadcrumb={[{ label: "Sandboxes", href: "/sandboxes" }]}
      />

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
                  {sandboxPrefix}assist-dual
                </div>
              </div>

              <div className="space-y-3 bg-background p-5">
                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider">
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-emerald-400">
                    ● agent_audio · microphone
                  </span>
                  <span className="rounded-full border border-blue-400/40 bg-blue-400/10 px-2 py-0.5 text-blue-400">
                    ● customer_audio · screen-share audio
                  </span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                    one participant
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_16rem]">
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
            </div>

            {/* Overview */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">Overview</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                A phone call, with an AI listening rather than talking — and only{" "}
                <em>one</em> LiveKit participant in the room. The support agent&apos;s browser
                publishes their microphone as one track and the softphone&apos;s audio, captured as a
                shared tab, as a second. The worker transcribes each track separately and writes
                coaching notes from both halves.
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                This is the shape a real call arrives in. A SIP leg reaches the agent&apos;s{" "}
                <em>desk</em>, not the room, so the desk is the only thing that can put both voices
                in front of a transcriber. The sibling{" "}
                <span className="text-foreground">agent assist</span> template assumes one
                participant per person and cannot be used for it.
              </p>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">How a leg is identified</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Both voices share an identity, so the participant cannot say who is speaking — the{" "}
                <em>track</em> does. Its name first: <code>agent_audio</code> or{" "}
                <code>customer_audio</code>, which is what this sandbox publishes. Only for an
                unnamed track does the source decide, and which role the microphone is then taken to
                be is a setting.
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Because of that, an existing publisher works against this unchanged: a laptop app or
                a SIP bridge that publishes two audio tracks with those names needs no other
                agreement, and the sandbox page becomes a monitor for it.
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
                        "This template. One page: join, unmute, share the softphone tab, read the transcript and the coaching. Joining without publishing makes it a monitor instead.",
                      ],
                      [
                        "The worker",
                        "example/agent-assist-dual-python, deployed as an ordinary agent. One AgentSession per track, no LLM and no TTS in either. Logs, restart and stop work from the Agents page.",
                      ],
                      [
                        "Metrics",
                        "STT, end-of-turn and noise-cancellation numbers are tagged per leg, so the console and session history draw a lane for each side rather than merging the call.",
                      ],
                      [
                        "Session history",
                        "Captured calls hold both sides' words in order — but under the publisher's identity, since the customer is not a participant. The role-accurate view is the sandbox's own.",
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
              <h2 className="mb-2 text-lg font-bold text-foreground">Dual track</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                One participant, two audio tracks, two transcripts — the shape a SIP call reaches a
                support desk in.
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
              <AlertTitle>Use a headset</AlertTitle>
              <AlertDescription>
                Browser echo cancellation only cancels what the browser itself plays. The softphone
                is another application, so on speakers the caller leaks into the microphone and both
                legs transcribe the same words.
              </AlertDescription>
            </Alert>

            <Alert>
              <Info className="size-4" />
              <AlertTitle>Tab audio, not the screen</AlertTitle>
              <AlertDescription>
                Share a <strong>tab</strong> and tick &quot;Also share tab audio&quot;. A share
                without audio looks like it worked and transcribes nothing. On Windows &quot;Share
                system audio&quot; also covers a desktop softphone; macOS Chrome can only capture a
                tab.
              </AlertDescription>
            </Alert>

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
                  ["Application", "Telephony, Transcription, Agent assist"],
                  ["Type", "Frontend + worker"],
                  ["Tools", "Next.js, TypeScript, Python"],
                  ["Participants", "One desk, two tracks"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="text-right text-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Source code</h3>
              {/* Not in livekit-examples like the other templates — the worker
                  ships in this repo, and this is the copy that gets deployed. */}
              <a
                href={ASSIST_DUAL_SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <Code className="size-3.5" />
                example/agent-assist-dual-python
              </a>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Works with</h3>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="gap-1 text-xs">
                  <PhoneCall className="size-2.5" />
                  Any softphone in a tab
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs">
                  <Headphones className="size-2.5" />
                  Any STT provider
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
            <DialogTitle>Create dual-track assist</DialogTitle>
            <DialogDescription>
              One page at the desk publishes both legs of the call. The worker joins silently and
              transcribes each track on its own.
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
                  The desk opens {sandboxPrefix}
                  {sandboxName.trim()} · room <code>dual-{sandboxName.trim()}</code>. Add{" "}
                  <code>?room=…</code> to run several desks against one sandbox.
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
                  Deploy a new dual-track worker as{" "}
                  <code>{dualWorkerName(sandboxName.trim() || "<name>")}</code>
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
                          {a.agentName.endsWith(ASSIST_DUAL_WORKER_SUFFIX)
                            ? " · dual-track worker"
                            : " · other agent"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    One dual-track worker can serve any number of these sandboxes — each gets its own
                    room. A <strong>per-participant assist worker</strong> cannot: it binds a session
                    to each participant&apos;s microphone, so it would transcribe the agent&apos;s
                    half and never reach the caller&apos;s track at all. A builder{" "}
                    <strong>voice agent</strong> is worse still — it would answer out loud.
                  </p>
                </div>
              )}
            </div>

            <Collapsible open={workerOpen} onOpenChange={setWorkerOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-semibold text-foreground">
                Worker settings — copy from an agent, or leave the defaults
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${
                    workerOpen ? "rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                {deployWorker ? (
                  <div className="space-y-5">
                    <MicRoleField
                      value={assist.micRole}
                      onChange={(micRole) => setAssist((c) => ({ ...c, micRole }))}
                    />
                    <AssistSettings
                      config={assist}
                      providers={providers}
                      agents={agents}
                      // `micRole` is this template's own field and AssistSettings
                      // knows nothing about it, so carry it across rather than
                      // relying on the form's spread to have kept it.
                      onChange={(next) => setAssist((c) => ({ ...next, micRole: c.micRole }))}
                    />
                  </div>
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
