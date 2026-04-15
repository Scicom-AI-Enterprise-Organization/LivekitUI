"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/livekit/top-bar";
import Link from "next/link";
import {
  Download,
  Info,
  AudioLines,
  Video,
  Loader2,
  Trash2,
  ExternalLink,
  Code,
  ChevronRight,
  Copy,
  Check,
  ScrollText,
  RefreshCw,
  X,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
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

const templates = [
  {
    name: "Web Voice Agent",
    description:
      "A starter app for Next.js, featuring a flexible voice AI frontend",
    icon: AudioLines,
    href: "/sandbox/agent-starter-react",
    template: "agent-starter-react",
  },
  {
    name: "Video conference",
    description:
      "An open source video conferencing app built on LiveKit Components, LiveKit Cloud, and...",
    icon: Video,
    href: "/sandbox/meet",
    template: "meet",
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

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

  const save = async () => {
    setSaving(true);
    await fetch(`/api/sandbox-apps/${app.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    setSaving(false);
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

  const title = app.template === "meet" ? `Edit video conference` : `Edit web voice agent`;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
                Choose a specific agent or leave as auto-dispatch.
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
  const [apps, setApps] = useState<SandboxApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsApp, setLogsApp] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
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

  const handleRestart = async (id: number, name: string) => {
    await fetch("/api/sandbox-apps/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });
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

  const domain = process.env.NEXT_PUBLIC_SANDBOX_DOMAIN || "sandbox.example.com";

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Sandbox" />

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Get started */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Get started</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((t) => (
              <Link key={t.name} href={t.href}>
                <Card className="group relative hover:border-primary/40 transition-colors cursor-pointer">
                  <CardContent className="p-5">
                    <div className="mb-4 flex h-20 items-center justify-center rounded-md bg-muted">
                      <t.icon className="size-10 text-muted-foreground" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">
                      {t.name}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t.description}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-3 right-3"
                    >
                      <Download className="size-4" />
                    </Button>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Info banner */}
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Sandbox</AlertTitle>
          <AlertDescription>
            Create sandbox apps from templates to quickly prototype and test your agents. Each sandbox runs locally and is accessible through the dashboard proxy.
          </AlertDescription>
        </Alert>

        {/* Sandbox apps */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Sandbox apps
            </h2>
          </div>

          {/* Complete your local setup */}
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group">
              <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
              Complete your local setup
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 space-y-2">
                <CopyCommand command="lk app create --template <template-name>" />
                <p className="text-xs text-muted-foreground">
                  Once you&apos;ve set up the sandbox app locally, launch it to begin testing and interacting with the application.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

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
                      onClick={() => setEditApp(app)}
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
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            title="Launch"
                            asChild
                          >
                            <a href={app.url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="size-4" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            title="Logs"
                            onClick={() => setLogsApp(app.name)}
                          >
                            <ScrollText className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            title="Source code"
                            asChild
                          >
                            <a
                              href={`https://github.com/livekit-examples/${app.template}`}
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
                            onClick={() => handleRestart(app.id, app.name)}
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

      {/* Edit sandbox dialog */}
      {editApp && (
        <EditSandboxDialog
          app={editApp}
          onClose={() => setEditApp(null)}
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
    </div>
  );
}
