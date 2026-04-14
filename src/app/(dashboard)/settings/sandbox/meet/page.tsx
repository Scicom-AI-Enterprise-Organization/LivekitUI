"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/dialog";
import {
  Video,
  ExternalLink,
  FileText,
  Code,
  BookOpen,
  Eye,
  User,
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

export default function MeetTemplatePage() {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [sandboxName, setSandboxName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdName, setCreatedName] = useState("");
  const [createError, setCreateError] = useState("");
  const [sandboxPrefix, setSandboxPrefix] = useState("");

  useEffect(() => {
    fetch("/api/sandbox-config")
      .then((r) => r.json())
      .then((d) => setSandboxPrefix(d.prefix || ""));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar title="meet" />

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
                  {sandboxPrefix}meet
                </div>
              </div>

              {/* Video conference preview */}
              <div className="bg-background p-6">
                <div className="grid grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex aspect-video items-center justify-center rounded-lg bg-muted/50 border border-border"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <User className="size-5 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Controls bar */}
                <div className="mt-4 flex items-center justify-center gap-3">
                  {["Mic", "Camera", "Screen", "Chat"].map((label) => (
                    <div
                      key={label}
                      className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
                    >
                      {label}
                    </div>
                  ))}
                  <div className="rounded-lg bg-red-500/80 px-3 py-2 text-xs text-white">
                    Leave
                  </div>
                </div>
              </div>
            </div>

            {/* LiveKit Meet description */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">
                LiveKit Meet
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Try the demo &middot; LiveKit Components &middot; LiveKit Docs
                &middot; LiveKit Cloud &middot; Blog
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                LiveKit Meet is an open source video conferencing app built on
                LiveKit Components, LiveKit Cloud, and Next.js. It&apos;s been
                completely redesigned from the ground up using our new components
                library.
              </p>
            </div>

            {/* Large video preview */}
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-3 gap-1 bg-background p-2">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex aspect-video items-center justify-center rounded bg-muted/30"
                  >
                    <User className="size-6 text-muted-foreground/50" />
                  </div>
                ))}
              </div>
            </div>

            {/* Tech Stack */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">
                Tech Stack
              </h2>
              <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground">
                <li>
                  This is a{" "}
                  <span className="text-primary cursor-pointer">Next.js</span>{" "}
                  project bootstrapped with{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    create-next-app
                  </code>
                  .
                </li>
                <li>
                  App is built with{" "}
                  <span className="text-primary cursor-pointer">
                    @livekit/components-react
                  </span>{" "}
                  library.
                </li>
              </ul>
            </div>

            {/* Demo */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">Demo</h2>
              <p className="text-sm text-muted-foreground">
                Give it a try at{" "}
                <span className="text-primary cursor-pointer">
                  https://meet.livekit.io
                </span>
              </p>
            </div>

            {/* Dev Setup */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">
                Dev Setup
              </h2>
              <p className="text-sm text-muted-foreground mb-3">
                Steps to get a local dev setup up and running:
              </p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>
                  Run{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    pnpm install
                  </code>{" "}
                  to install all dependencies.
                </li>
                <li>
                  Copy{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    .env.example
                  </code>{" "}
                  in the project root and rename it to{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    .env.local
                  </code>
                  .
                </li>
                <li>
                  Update the missing environment variables in the newly created{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    .env.local
                  </code>{" "}
                  file.
                </li>
                <li>
                  Run{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    pnpm dev
                  </code>{" "}
                  to start the development server and visit{" "}
                  <span className="text-primary cursor-pointer">
                    http://localhost:3000
                  </span>{" "}
                  to see the result.
                </li>
                <li>Start development</li>
              </ol>
            </div>
          </div>

          {/* Right -- Sidebar info */}
          <div className="w-[280px] shrink-0 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-foreground mb-2">
                Video conference
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                An open source video conferencing app built on LiveKit
                Components, LiveKit Cloud, and Next.js.
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
                  href="https://github.com/livekit-examples/meet"
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
                        lk app create --template meet
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
                  <span className="text-foreground">Telepresence</span>
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
        <DialogContent className="max-w-md">
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
                <DialogTitle>Create video conference</DialogTitle>
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

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Sandbox name</Label>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-sm text-muted-foreground">{sandboxPrefix}</span>
                    <Input
                      placeholder="my-app"
                      className="flex-1"
                      value={sandboxName}
                      onChange={(e) => setSandboxName(e.target.value)}
                    />
                  </div>
                  {sandboxName && (
                    <p className="text-xs text-muted-foreground">
                      URL: {sandboxPrefix}{sandboxName}
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  disabled={creating}
                  onClick={async () => {
                    setCreateError("");
                    const name = sandboxName.trim() || `meet-${Math.random().toString(36).slice(2, 8)}`;
                    setCreating(true);
                    try {
                      const res = await fetch("/api/sandbox-apps", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name, template: "meet" }),
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
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
