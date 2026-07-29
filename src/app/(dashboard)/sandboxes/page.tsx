"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/livekit/top-bar";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AudioLines,
  Video,
  Headphones,
  Loader2,
  Trash2,
  Code,
  ChevronRight,
  Copy,
  Check,
  ScrollText,
  FlaskConical,
  RefreshCw,
  X,
  RotateCw,
  PhoneCall,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRuntimeConfig } from "@/components/runtime-config-provider";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AssistSettings } from "@/components/livekit/assist-settings";
import { MicRoleField } from "@/components/livekit/dual-mic-role-field";
import { AssistSimDialog } from "@/components/livekit/assist-sim-dialog";
import { CodeBlock } from "@/components/livekit/code-block";
import {
  ASSIST_SOURCE_URL,
  ASSIST_TEMPLATE,
  DEFAULT_ASSIST_CONFIG,
  type AssistWorkerConfig,
} from "@/lib/agent-assist-config";
import {
  ASSIST_DUAL_SOURCE_URL,
  ASSIST_DUAL_TEMPLATE,
  type DualMicRole,
} from "@/lib/agent-assist-dual-config";
import type { Provider } from "@/lib/providers";

const templates = [
  {
    name: "Web Voice Agent",
    description:
      "A starter app for Next.js, featuring a flexible voice AI frontend",
    icon: AudioLines,
    href: "/sandboxes/agent-starter-react",
    template: "agent-starter-react",
  },
  {
    name: "Video conference",
    description:
      "An open source video conferencing app built on LiveKit Components, LiveKit Cloud, and...",
    icon: Video,
    href: "/sandboxes/meet",
    template: "meet",
  },
  {
    name: "Agent assist",
    description:
      "Two people on one call, transcribed live, with real-time suggestions for the one taking it",
    icon: Headphones,
    href: "/sandboxes/agent-assist",
    template: ASSIST_TEMPLATE,
  },
  {
    name: "Agent assist · dual track",
    description:
      "A phone call from one desk: microphone and softphone audio as two tracks, each transcribed on its own",
    icon: PhoneCall,
    href: "/sandboxes/agent-assist-dual",
    template: ASSIST_DUAL_TEMPLATE,
  },
];

interface SandboxApp {
  id: number;
  name: string;
  template: string;
  url: string;
  status: string;
  createdAt: string;
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
      <code className="flex-1 text-xs text-foreground">{command}</code>
      <Button variant="ghost" size="icon-xs" onClick={handleCopy}>
        {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
      </Button>
    </div>
  );
}

interface SandboxSettings {
  agentDispatch?: string; // "" or "__auto__" for auto-dispatch
  /**
   * Either assist template: what its worker runs on.
   *
   * `micRole` is the dual-track template's one extra field, optional here because
   * the per-participant worker has no equivalent and never sets it. Both templates
   * share this key so the dialog below, the delete path and the settings form need
   * no branch for storage — only for which module deploys the result.
   */
  assist?: AssistWorkerConfig & { micRole?: DualMicRole };
  /** Either assist template: the worker this sandbox deployed, if it deployed one. */
  assistWorker?: string;
  capabilities?: {
    camera?: boolean;
    screenShare?: boolean;
    chat?: boolean;
  };
  audioBuffer?: boolean;
  agentName?: string;
  companyName?: string;
  startButtonText?: string;
  pageTitle?: string;
  pageDescription?: string;
  lightAccent?: string;
  darkAccent?: string;
  lightLogo?: string;
  darkLogo?: string;
}

function EditSandboxDialog({
  app,
  onClose,
  onSaved,
}: {
  app: SandboxApp;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<SandboxSettings>({
    agentDispatch: "__auto__",
    capabilities: {
      camera: true,
      screenShare: true,
      chat: true,
    },
    audioBuffer: false,
    agentName: "",
    companyName: "",
    startButtonText: "",
    pageTitle: "",
    pageDescription: "",
    lightAccent: "#002cf2",
    darkAccent: "#1fd5f9",
    lightLogo: "",
    darkLogo: "",
  });
  const [agents, setAgents] = useState<{ agentName: string }[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  const isDual = app.template === ASSIST_DUAL_TEMPLATE;
  const isAssist = app.template === ASSIST_TEMPLATE || isDual;
  // Each template names its room after itself, so two sandboxes with the same name
  // could not collide in one deployment.
  const roomName = `${isDual ? "dual" : "assist"}-${app.name}`;
  // The dashboard's own origin, taken from the sandbox's URL rather than from
  // `window`: reading that during render is a hydration mismatch waiting to
  // happen, and this string is already absolute and correct for a deployment.
  const simulationCommand = [
    `curl -X POST ${(() => {
      try {
        return new URL(app.url).origin;
      } catch {
        return "";
      }
    })()}/api/assist-sim \\`,
    `  -H "Authorization: Bearer $TOKEN" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"sandbox": "${app.name}"}'`,
  ].join("\n");
  // A worker the sandbox dispatches but did not deploy — one assist worker can
  // serve many of these sandboxes, each in its own room.
  const dispatch = settings.agentDispatch === "__auto__" ? "" : settings.agentDispatch || "";
  const sharedWorker = isAssist && !settings.assistWorker ? dispatch : "";

  useEffect(() => {
    fetch(`/api/sandbox-apps/${app.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.app?.settings) {
          setSettings((prev) => ({ ...prev, ...data.app.settings }));
        }
      })
      .finally(() => setLoading(false));

    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => {});
  }, [app.id]);

  useEffect(() => {
    if (!isAssist) return;
    fetch("/api/providers")
      .then((res) => res.json())
      .then((data) => setProviders(data.providers ?? []))
      .catch(() => {});
  }, [isAssist]);

  const save = async () => {
    setSaving(true);
    const res = await fetch(`/api/sandbox-apps/${app.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      toast.error(data.error || "Could not save the sandbox");
    } else if (data.workerWarning) {
      // Settings are saved; the worker itself failed to come back up. Keeping
      // this on screen matters — the sandbox now points at a worker that is not
      // running, which looks identical to a silent call.
      toast.error(`Saved, but the assist worker did not restart: ${data.workerWarning}`, {
        duration: Infinity,
        closeButton: true,
      });
    } else if (isAssist && settings.assistWorker) {
      toast.success(`Saved — redeployed ${settings.assistWorker}`);
    } else {
      toast.success("Sandbox saved");
    }

    onSaved();
    onClose();
  };

  const toggleCap = (key: "camera" | "screenShare" | "chat") => {
    setSettings((s) => ({
      ...s,
      capabilities: {
        ...s.capabilities,
        [key]: !s.capabilities?.[key],
      },
    }));
  };

  const title = isDual
    ? `Edit agent assist · dual track`
    : isAssist
      ? `Edit agent assist`
      : app.template === "meet"
        ? `Edit video conference`
        : `Edit web voice agent`;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* `[&>*]:min-w-0` — same grid-item overflow as the simulate dialog; see
          assist-sim-dialog.tsx. Without it the CodeBlock below stretches the
          column and the whole dialog scrolls sideways instead of the code. */}
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Configure your sandbox.{" "}
            <a href="https://docs.livekit.io/deploy/admin/sandbox/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Learn more about Sandboxes</a>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 py-2">
            {isAssist ? (
              <>
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {isDual ? "The support agent opens " : "Both people open "}
                  <a
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {app.url}
                  </a>{" "}
                  {isDual
                    ? "and publishes both legs from that one tab — microphone, plus the softphone's audio as a shared tab."
                    : "and take a seat."}{" "}
                  Room: <code>{roomName}</code>.
                  <br />
                  {settings.assistWorker ? (
                    <>
                      Worker: <code>{settings.assistWorker}</code> — this sandbox owns it, so saving
                      here redeploys it and deleting the sandbox deletes it.
                    </>
                  ) : sharedWorker ? (
                    <>
                      Dispatching <code>{sharedWorker}</code>, which this sandbox does not own.
                      Changes below are stored but <strong>not</strong> applied — edit that worker
                      where it was created, or it keeps running its own settings.
                    </>
                  ) : (
                    <>
                      No worker is attached to this sandbox, so nothing transcribes the call.
                      Recreate it with a worker.
                    </>
                  )}
                </div>
                {isDual ? (
                  /* No simulator for this one. `/api/assist-sim` joins as two
                     participants carrying `assistRole` attributes, which is exactly
                     the shape this worker does *not* read — both of their
                     microphones would resolve to the same leg. One browser is
                     enough here anyway, which is the point of the template. */
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <p>
                      <strong className="text-foreground">Testing it takes one browser.</strong> Open
                      the link, unmute, and share a tab that is playing anything with speech in it —
                      that tab becomes the customer. The composer also sends a typed turn{" "}
                      <em>as either side</em>, so one line typed as the customer exercises the whole
                      chain (turn → coaching model → note) with no audio at all.
                    </p>
                    <p className="mt-2">
                      The simulator on{" "}
                      <Link href="/sandboxes" className="text-primary hover:underline">
                        agent assist
                      </Link>{" "}
                      does not apply: it joins as two participants with roles in their attributes,
                      and this worker resolves a leg from the track, not the participant.
                    </p>
                  </div>
                ) : (
                  /* Testing that template otherwise means two people in two
                     browsers, which is why the simulator exists at all. */
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <p className="mb-2">
                      Or run a <strong className="text-foreground">simulated call</strong>: two
                      synthetic speakers join and talk through this sandbox&apos;s own TTS, so the
                      transcript, the coaching notes and the per-speaker metrics can be checked
                      without two browsers. It answers when the call is over, and lands in{" "}
                      <Link href="/sessions/history" className="text-primary hover:underline">
                        Sessions → History
                      </Link>{" "}
                      like any other call.
                    </p>
                    <CodeBlock code={simulationCommand} />
                    <p className="mt-2">
                      <code>$TOKEN</code> comes from{" "}
                      <Link
                        href="/settings/access-tokens"
                        className="text-primary hover:underline"
                      >
                        Settings → Access tokens
                      </Link>
                      . Pass <code>turns</code> to say your own lines.
                    </p>
                  </div>
                )}
                {isDual && (
                  <MicRoleField
                    value={settings.assist?.micRole ?? "agent"}
                    onChange={(micRole) =>
                      setSettings((s) => ({
                        ...s,
                        assist: { ...(s.assist ?? DEFAULT_ASSIST_CONFIG), micRole },
                      }))
                    }
                  />
                )}
                <AssistSettings
                  config={settings.assist ?? DEFAULT_ASSIST_CONFIG}
                  providers={providers}
                  agents={agents}
                  onChange={(assist) =>
                    setSettings((s) => ({
                      ...s,
                      // `micRole` is the dual template's own field and
                      // `AssistSettings` knows nothing about it — its onChange hands
                      // back an `AssistWorkerConfig`. Carried across explicitly
                      // rather than trusting the form's spread to have kept it: if
                      // it were dropped, the server's normalizer would quietly
                      // default it back to `agent` and re-point the legs.
                      assist: isDual
                        ? { ...assist, micRole: s.assist?.micRole ?? "agent" }
                        : assist,
                    }))
                  }
                />
              </>
            ) : (
              <>
            {/* Dispatch to agent */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Dispatch to agent</label>
              <select
                value={settings.agentDispatch || "__auto__"}
                onChange={(e) => setSettings({ ...settings, agentDispatch: e.target.value })}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              >
                <option value="__auto__">Auto-dispatch (any available agent)</option>
                {agents.map((a) => (
                  <option key={a.agentName} value={a.agentName}>
                    {a.agentName}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Pick the agent by name. Agents deployed from the builder register for explicit dispatch, so
                auto-dispatch never matches them — the sandbox connects but no agent joins, leaving the send
                button disabled and no transcription.
              </p>
            </div>

            {/* Enable capabilities */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">Enable capabilities</label>
              <div className="flex items-center gap-6">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.capabilities?.camera || false}
                    onChange={() => toggleCap("camera")}
                    className="size-4"
                  />
                  <span className="text-sm text-foreground">Camera</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.capabilities?.screenShare || false}
                    onChange={() => toggleCap("screenShare")}
                    className="size-4"
                  />
                  <span className="text-sm text-foreground">Screen share</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.capabilities?.chat || false}
                    onChange={() => toggleCap("chat")}
                    className="size-4"
                  />
                  <span className="text-sm text-foreground">Chat</span>
                </label>
              </div>
            </div>

            {/* Audio buffer */}
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={settings.audioBuffer || false}
                onChange={(e) => setSettings({ ...settings, audioBuffer: e.target.checked })}
                className="mt-0.5 size-4"
              />
              <span className="text-sm leading-snug text-foreground">
                Speed up apparent connection time by buffering local audio for the agent
              </span>
            </label>

            {/* Optional configuration */}
            <Collapsible open={optionalOpen} onOpenChange={setOptionalOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-semibold text-foreground">
                Optional configuration
                <ChevronRight
                  className={`size-4 text-muted-foreground transition-transform ${optionalOpen ? "rotate-90" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-4">
                <p className="text-xs text-muted-foreground">
                  Change the default behavior and capabilities of your sandbox app.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Agent name</label>
                    <input
                      value={settings.agentName || ""}
                      onChange={(e) => setSettings({ ...settings, agentName: e.target.value })}
                      placeholder="my-agent"
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Company name</label>
                    <input
                      value={settings.companyName || ""}
                      onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
                      placeholder="LiveKit"
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Start button text</label>
                    <input
                      value={settings.startButtonText || ""}
                      onChange={(e) => setSettings({ ...settings, startButtonText: e.target.value })}
                      placeholder="Start call"
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Page title</label>
                    <input
                      value={settings.pageTitle || ""}
                      onChange={(e) => setSettings({ ...settings, pageTitle: e.target.value })}
                      placeholder="LiveKit Voice Agent"
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Page description</label>
                    <input
                      value={settings.pageDescription || ""}
                      onChange={(e) => setSettings({ ...settings, pageDescription: e.target.value })}
                      placeholder="A voice agent built with LiveKit"
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Appearance */}
            <Collapsible open={appearanceOpen} onOpenChange={setAppearanceOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-semibold text-foreground">
                Appearance
                <ChevronRight
                  className={`size-4 text-muted-foreground transition-transform ${appearanceOpen ? "rotate-90" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <div className="grid grid-cols-2 gap-4">
                  {/* Light mode */}
                  <div className="space-y-3">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Light mode
                    </span>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Accent color</label>
                      <div className="flex items-center gap-2">
                        <input
                          value={settings.lightAccent || ""}
                          onChange={(e) => setSettings({ ...settings, lightAccent: e.target.value })}
                          className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                        <div
                          className="size-8 shrink-0 rounded border border-border"
                          style={{ backgroundColor: settings.lightAccent }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Logo URL</label>
                      <input
                        value={settings.lightLogo || ""}
                        onChange={(e) => setSettings({ ...settings, lightLogo: e.target.value })}
                        placeholder="https://..."
                        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  {/* Dark mode */}
                  <div className="space-y-3">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Dark mode
                    </span>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Accent color</label>
                      <div className="flex items-center gap-2">
                        <input
                          value={settings.darkAccent || ""}
                          onChange={(e) => setSettings({ ...settings, darkAccent: e.target.value })}
                          className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                        <div
                          className="size-8 shrink-0 rounded border border-border"
                          style={{ backgroundColor: settings.darkAccent }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Logo URL</label>
                      <input
                        value={settings.darkLogo || ""}
                        onChange={(e) => setSettings({ ...settings, darkLogo: e.target.value })}
                        placeholder="https://..."
                        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="size-4 animate-spin mr-1" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogViewer({ name, onClose }: { name: string; onClose: () => void }) {
  const [logs, setLogs] = useState("");
  const [fetching, setFetching] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = () => {
    setFetching(true);
    fetch(`/api/sandbox-apps/logs?name=${encodeURIComponent(name)}&tail=300`)
      .then((res) => res.json())
      .then((data) => setLogs(data.logs || "No logs yet."))
      .finally(() => setFetching(false));
  };

  useEffect(() => {
    fetchLogs();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [name, autoRefresh]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex h-[80vh] w-[80vw] max-w-4xl flex-col rounded-lg border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <ScrollText className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              Logs: {name}
            </h3>
            {autoRefresh && (
              <Badge variant="outline" className="text-xs gap-1">
                <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                Live
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? "Pause" : "Resume"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={fetchLogs}
              disabled={fetching}
            >
              <RefreshCw className={`size-3 ${fetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        </div>
        {/* Log content */}
        <div className="flex-1 overflow-auto bg-[#0d1117] p-4">
          <pre className="text-xs font-mono leading-5 text-[#e6edf3] whitespace-pre-wrap break-all">
            {logs}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function SandboxPage() {
  // /sandboxes/[name] renders this same view with that app's edit dialog open.
  // A Next.js page cannot take props, so the name is read from the route.
  const routeParams = useParams<{ name?: string }>();
  const autoEditName = routeParams?.name ? decodeURIComponent(routeParams.name) : undefined;

  const [apps, setApps] = useState<SandboxApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsApp, setLogsApp] = useState<string | null>(null);
  const [simApp, setSimApp] = useState<SandboxApp | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [restartTarget, setRestartTarget] = useState<{ id: number; name: string } | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [editApp, setEditApp] = useState<SandboxApp | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchApps = () => {
    fetch("/api/sandbox-apps")
      .then((res) => res.json())
      .then((data) => setApps(data.apps ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchApps();
  }, []);

  // Open whichever dialog the URL asks for: `/sandboxes/emery` edits that sandbox,
  // `?simulate=emery` runs a simulated call on it. Read from the URL rather than
  // only from a click, so either link survives a reload or a paste to a colleague.
  // One effect for both, and `window.location` rather than `useSearchParams`,
  // which would need a Suspense boundary around this whole page.
  useEffect(() => {
    if (apps.length === 0) return;
    const byName = (name: string) =>
      apps.find((a) => a.name.toLowerCase() === name.toLowerCase());

    if (autoEditName) {
      const match = byName(autoEditName);
      if (match) setEditApp(match);
    }

    const simulate = new URLSearchParams(window.location.search).get("simulate");
    if (simulate) {
      const match = byName(simulate);
      if (match) setSimApp(match);
    }
  }, [autoEditName, apps]);

  // Update URL without triggering Next.js navigation (no remount/re-fetch)
  const openEdit = (app: SandboxApp) => {
    setEditApp(app);
    window.history.replaceState(null, "", `/sandboxes/${encodeURIComponent(app.name)}`);
  };
  const closeEdit = () => {
    setEditApp(null);
    window.history.replaceState(null, "", "/sandboxes");
  };

  const openSim = (app: SandboxApp) => {
    setSimApp(app);
    window.history.replaceState(null, "", `/sandboxes?simulate=${encodeURIComponent(app.name)}`);
  };
  const closeSim = () => {
    setSimApp(null);
    window.history.replaceState(null, "", "/sandboxes");
  };

  const confirmRestart = async () => {
    if (!restartTarget) return;
    setRestarting(true);
    await fetch("/api/sandbox-apps/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: restartTarget.id, name: restartTarget.name }),
    });
    setRestartTarget(null);
    setRestarting(false);
    fetchApps();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    await fetch("/api/sandbox-apps", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deleteTarget.id, name: deleteTarget.name }),
    });
    setDeleteTarget(null);
    setDeleting(false);
    fetchApps();
  };

  const { sandboxDomain: domain } = useRuntimeConfig();

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Sandboxes" />

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Get started */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Get started</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((t) => (
              <Link key={t.name} href={t.href} className="block h-full">
                {/* `h-full` on both, or a row is only as tall as each card's own
                    text: the Link is the grid item and stretches to the row, the
                    Card inside it does not, so two templates whose descriptions
                    wrap to a different number of lines drew mismatched cards. */}
                <Card className="group relative h-full hover:border-primary/40 transition-colors cursor-pointer">
                  <CardContent className="p-5">
                    <div className="mb-4 flex h-20 items-center justify-center rounded-md">
                      <t.icon className="size-10 text-muted-foreground" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">
                      {t.name}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Sandbox apps */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Sandbox apps
            </h2>
          </div>

          {/* App list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : apps.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No sandbox apps yet. Create one from a template above.
            </div>
          ) : (
            <Card className="py-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Template</th>
                    <th className="px-4 py-2.5 font-medium">URL</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5 font-medium w-auto"></th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app) => (
                    <tr
                      key={app.id}
                      className="border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => openEdit(app)}
                    >
                      <td className="px-4 py-2.5 font-medium">{app.name}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="text-xs">{app.template}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <a
                          href={app.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {app.url}
                        </a>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {new Date(app.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {app.status === "running" ? (
                            <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 gap-1.5 uppercase tracking-wider text-[10px]">
                              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              ONLINE
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground gap-1.5 uppercase tracking-wider text-[10px]">
                              <span className="size-1.5 rounded-full bg-muted-foreground" />
                              OFFLINE
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            title="Logs"
                            onClick={() => setLogsApp(app.name)}
                          >
                            <ScrollText className="size-4" />
                          </Button>
                          {/* Assist needs two people on one link; a voice agent
                              needs somebody to talk to it before its timeline has
                              anything in it. Both get a synthetic caller.
                              Deliberately not the dual-track template: the
                              simulator joins as two participants carrying roles in
                              their attributes, which that worker does not read —
                              both of their microphones would land on one leg. It
                              needs only one browser anyway. */}
                          {(app.template === ASSIST_TEMPLATE ||
                            app.template === "agent-starter-react") && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              title="Simulate a call"
                              onClick={() => openSim(app)}
                            >
                              <FlaskConical className="size-4" />
                            </Button>
                          )}
                          {/* Neither assist template is in livekit-examples — both
                              ship in this repo, so these point at the worker the
                              dashboard actually deploys. */}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            title="Source code"
                            asChild
                          >
                            <a
                              href={
                                app.template === ASSIST_TEMPLATE
                                  ? ASSIST_SOURCE_URL
                                  : app.template === ASSIST_DUAL_TEMPLATE
                                    ? ASSIST_DUAL_SOURCE_URL
                                    : `https://github.com/livekit-examples/${app.template}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Code className="size-4" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            title="Restart"
                            onClick={() => setRestartTarget({ id: app.id, name: app.name })}
                          >
                            <RotateCw className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            title="Delete"
                            onClick={() => setDeleteTarget({ id: app.id, name: app.name })}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>

      {/* Log viewer overlay */}
      {logsApp && <LogViewer name={logsApp} onClose={() => setLogsApp(null)} />}
      {simApp && (
        <AssistSimDialog
          app={simApp}
          mode={simApp.template === ASSIST_TEMPLATE ? "assist" : "voice"}
          onClose={closeSim}
        />
      )}

      {/* Edit sandbox dialog */}
      {editApp && (
        <EditSandboxDialog
          app={editApp}
          onClose={closeEdit}
          onSaved={fetchApps}
        />
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete sandbox app</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-medium text-foreground">{deleteTarget?.name}</span>? This will stop the running process and remove it from the list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-3 animate-spin mr-1" /> : <Trash2 className="size-3 mr-1" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restart confirmation dialog */}
      <Dialog open={!!restartTarget} onOpenChange={(open) => { if (!open) setRestartTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Restart sandbox app</DialogTitle>
            <DialogDescription>
              Are you sure you want to restart <span className="font-medium text-foreground">{restartTarget?.name}</span>? This will stop the running process and start it again with the latest settings. Active connections will be dropped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3">
            <Button variant="outline" size="sm" onClick={() => setRestartTarget(null)} disabled={restarting}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmRestart} disabled={restarting}>
              {restarting ? <Loader2 className="size-3 animate-spin mr-1" /> : <RotateCw className="size-3 mr-1" />}
              Restart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
