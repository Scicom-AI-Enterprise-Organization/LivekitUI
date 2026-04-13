"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
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
  DialogClose,
} from "@/components/ui/dialog";
import {
  AudioLines,
  ExternalLink,
  FileText,
  Code,
  BookOpen,
  Eye,
  ChevronDown,
  Copy,
  Check,
  Loader2,
} from "lucide-react";

function CopyBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
      <code className="flex-1 text-xs text-foreground whitespace-pre-wrap">{command}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => {
          navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
      </Button>
    </div>
  );
}

export default function AgentStarterReactPage() {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [lightAccent, setLightAccent] = useState("#002cf2");
  const [darkAccent, setDarkAccent] = useState("#1fd5f9");
  const [sandboxName, setSandboxName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdName, setCreatedName] = useState("");
  const [createError, setCreateError] = useState("");
  const [isLocal, setIsLocal] = useState(true);
  const [domain, setDomain] = useState("");

  useEffect(() => {
    fetch("/api/sandbox-config")
      .then((r) => r.json())
      .then((d) => { setIsLocal(d.isLocal); setDomain(d.domain); });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Agent-starter-react" />

      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-8 p-6">
          {/* Left -- Main content */}
          <div className="flex-1 min-w-0 space-y-8">
            {/* Preview area */}
            <div className="overflow-hidden rounded-lg border border-border">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
                </div>
                <div className="ml-3 flex-1 rounded bg-muted px-3 py-1 text-xs text-muted-foreground">
                  https://agent-starter-react.{process.env.NEXT_PUBLIC_SANDBOX_DOMAIN || "sandbox.example.com"}
                </div>
              </div>

              {/* App preview */}
              <div className="flex flex-col items-center justify-center bg-background py-20 px-8">
                <div className="mb-2 text-xs text-muted-foreground tracking-widest uppercase">
                  Lk
                </div>
                <p className="text-sm text-muted-foreground mb-8">
                  BUILT WITH LIVEKIT AGENTS
                </p>
                {/* Audio wave visualization */}
                <div className="flex items-end gap-1 mb-8">
                  {[24, 40, 32, 48, 36, 44, 28, 40, 32, 48, 36, 44, 24].map(
                    (h, i) => (
                      <div
                        key={i}
                        className="w-2 rounded-full bg-foreground/70"
                        style={{ height: `${h}px` }}
                      />
                    )
                  )}
                </div>
                {/* Controls */}
                <div className="flex items-center gap-4 text-muted-foreground">
                  <button className="rounded-full border border-border p-2.5 hover:bg-muted">
                    <AudioLines className="size-4" />
                  </button>
                  <button className="rounded-full border border-border p-2.5 hover:bg-muted">
                    <Code className="size-4" />
                  </button>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <span className="size-2 rounded-full bg-red-500" />
                  <span className="text-xs text-muted-foreground">
                    1:44 Alive
                  </span>
                </div>
              </div>
            </div>

            {/* Overview */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">
                Overview
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A Next.js frontend for a simple AI voice assistant using
                LiveKit&apos;s official JavaScript SDK and React Components. The
                application implements its own token server, and supports voice,
                transcription, and virtual avatars.
              </p>
            </div>
          </div>

          {/* Right -- Sidebar info */}
          <div className="w-[280px] shrink-0 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-foreground mb-2">
                Web Voice Agent
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A starter app for Next.js, featuring a flexible voice AI
                frontend.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setSandboxName("");
                  setCreatedName("");
                  setCreateError("");
                  setDialogOpen(true);
                }}
              >
                Create sandbox
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <a
                  href="https://github.com/livekit-examples/agent-starter-react"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Code className="size-3" />
                  Code
                </a>
              </Button>
            </div>

            {/* Bootstrap this template */}
            <Collapsible open={bootstrapOpen} onOpenChange={setBootstrapOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-semibold text-foreground">
                Bootstrap this template
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${
                    bootstrapOpen ? "rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3">
                <Card className="bg-muted/50">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <code className="text-xs text-foreground">
                        lk app create --template agent-starter-react
                      </code>
                      <button className="text-muted-foreground hover:text-foreground">
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Once you&apos;ve set up the sandbox app locally, launch it to
                  begin testing and interacting with the application.
                </p>
              </CollapsibleContent>
            </Collapsible>

            {/* About template */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                About template
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Application</span>
                  <span className="text-foreground">VoiceAI, Agents</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="text-foreground">Frontend</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tools</span>
                  <span className="text-foreground">Next.js, TypeScript</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">License</span>
                  <span className="text-foreground">Apache 2.0</span>
                </div>
              </div>
            </div>

            {/* Works with */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                Works with
              </h3>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-xs gap-1">
                  Python Voice Agent
                  <ExternalLink className="size-2.5" />
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  Python multi-agent workflow
                  <ExternalLink className="size-2.5" />
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  Node.js Voice Agent
                  <ExternalLink className="size-2.5" />
                </Badge>
              </div>
            </div>

            {/* Additional information */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                Additional information
              </h3>
              <div className="space-y-1.5">
                <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                  <BookOpen className="size-3.5" />
                  About templates
                </button>
                <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                  <FileText className="size-3.5" />
                  View README
                </button>
                <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                  <Eye className="size-3.5" />
                  View source
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create sandbox dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {createdName ? (
            <>
              <DialogHeader>
                <DialogTitle>Sandbox created</DialogTitle>
                <DialogDescription>{createdName}</DialogDescription>
              </DialogHeader>
              <div className="space-y-5 py-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="size-5 flex items-center justify-center rounded-full border text-xs">⟳</span>
                  Finish setting up your sandbox app
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">1. Install the CLI</p>
                  <CopyBlock command="brew install livekit-cli" />
                  <p className="text-xs text-muted-foreground">
                    View full instructions in our{" "}
                    <a href="https://docs.livekit.io/deploy/admin/sandbox/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">documentation</a>
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">2. Bootstrap an app from template</p>
                  <CopyBlock command={`lk app create \\\n  --sandbox ${createdName}`} />
                  <p className="text-xs text-muted-foreground">
                    Once you&apos;ve set up the sandbox app locally, launch it to begin testing and interacting with the application.
                  </p>
                </div>
              </div>
              <DialogFooter className="flex items-center justify-between sm:justify-between">
                <a
                  href="https://docs.livekit.io/deploy/admin/sandbox/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Learn more in the docs
                </a>
                <Button onClick={() => setDialogOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
          <DialogHeader>
            <DialogTitle>Create web voice agent</DialogTitle>
            <DialogDescription>
              Rapidly prototype your apps and share them with others, cutting out
              the boilerplate.{" "}
              <a href="https://docs.livekit.io/deploy/admin/sandbox/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Learn more about Sandboxes</a>
            </DialogDescription>
          </DialogHeader>

          {createError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {createError}
            </div>
          )}

          <div className="space-y-6 py-2">
            {/* Sandbox name */}
            <div className="space-y-2">
              <Label>Sandbox name</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="enter-generated-name"
                  className="flex-1"
                  value={sandboxName}
                  onChange={(e) => setSandboxName(e.target.value)}
                />
                {!isLocal && domain && (
                  <span className="shrink-0 text-sm text-muted-foreground">
                    .{domain}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {isLocal
                  ? "A random port will be assigned automatically on localhost."
                  : "If you do not provide a name we will generate one for you."}
              </p>
            </div>

            {/* Enable capabilities */}
            <div className="space-y-3">
              <Label>Enable capabilities</Label>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Checkbox id="cap-camera" defaultChecked />
                  <Label htmlFor="cap-camera" className="font-normal text-sm">
                    Camera
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="cap-screen" defaultChecked />
                  <Label htmlFor="cap-screen" className="font-normal text-sm">
                    Screen share
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="cap-chat" defaultChecked />
                  <Label htmlFor="cap-chat" className="font-normal text-sm">
                    Chat
                  </Label>
                </div>
              </div>
            </div>

            {/* Audio buffer */}
            <div className="flex items-start gap-2">
              <Checkbox id="audio-buffer" className="mt-0.5" />
              <Label htmlFor="audio-buffer" className="font-normal text-sm leading-snug">
                Speed up apparent connection time by buffering local audio for
                the agent
              </Label>
            </div>

            {/* Optional configuration */}
            <Collapsible open={optionalOpen} onOpenChange={setOptionalOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-semibold text-foreground">
                Optional configuration
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${
                    optionalOpen ? "rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-4">
                <p className="text-xs text-muted-foreground">
                  Change the default behavior and capabilities of your sandbox
                  app.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Agent name</Label>
                    <Input placeholder="my-agent" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Company name</Label>
                    <Input placeholder="LiveKit" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Start button text</Label>
                    <Input placeholder="Start call" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Page title</Label>
                    <Input placeholder="LiveKit Voice Agent" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Page description</Label>
                    <Input placeholder="A voice agent built with LiveKit" />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Appearance configuration */}
            <Collapsible
              open={appearanceOpen}
              onOpenChange={setAppearanceOpen}
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-semibold text-foreground">
                Appearance
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${
                    appearanceOpen ? "rotate-180" : ""
                  }`}
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
                      <Label className="text-xs">Accent color</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={lightAccent}
                          onChange={(e) => setLightAccent(e.target.value)}
                          className="flex-1"
                        />
                        <div
                          className="size-8 shrink-0 rounded border border-border"
                          style={{ backgroundColor: lightAccent }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Logo URL</Label>
                      <Input placeholder="https://..." />
                    </div>
                  </div>

                  {/* Dark mode */}
                  <div className="space-y-3">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Dark mode
                    </span>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Accent color</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={darkAccent}
                          onChange={(e) => setDarkAccent(e.target.value)}
                          className="flex-1"
                        />
                        <div
                          className="size-8 shrink-0 rounded border border-border"
                          style={{ backgroundColor: darkAccent }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Logo URL</Label>
                      <Input placeholder="https://..." />
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              disabled={creating}
              onClick={async () => {
                setCreateError("");
                const name = sandboxName.trim() || `agent-starter-${Math.random().toString(36).slice(2, 8)}`;
                setCreating(true);
                try {
                  const res = await fetch("/api/sandbox-apps", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, template: "agent-starter-react" }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setCreateError(data.error || "Failed to create sandbox");
                    return;
                  }
                  setDialogOpen(false);
                  router.push("/settings/sandbox");
                } catch {
                  setCreateError("Something went wrong");
                } finally {
                  setCreating(false);
                }
              }}
            >
              {creating && <Loader2 className="size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
