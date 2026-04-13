"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/livekit/top-bar";
import Link from "next/link";
import {
  Download,
  Info,
  MoreHorizontal,
  AudioLines,
  Video,
  Loader2,
  Trash2,
  ExternalLink,
  Code,
  ChevronRight,
  Copy,
  Check,
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const templates = [
  {
    name: "Web Voice Agent",
    description:
      "A starter app for Next.js, featuring a flexible voice AI frontend",
    icon: AudioLines,
    href: "/settings/sandbox/agent-starter-react",
    template: "agent-starter-react",
  },
  {
    name: "Video conference",
    description:
      "An open source video conferencing app built on LiveKit Components, LiveKit Cloud, and...",
    icon: Video,
    href: "/settings/sandbox/meet",
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

export default function SandboxPage() {
  const [apps, setApps] = useState<SandboxApp[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApps = () => {
    fetch("/api/sandbox-apps")
      .then((res) => res.json())
      .then((data) => setApps(data.apps ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchApps();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this sandbox app?")) return;
    await fetch("/api/sandbox-apps", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchApps();
  };

  const domain = process.env.NEXT_PUBLIC_SANDBOX_DOMAIN || "sandbox.example.com";

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Sandbox" breadcrumb={["husein", "Settings"]} />

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
            A new home for sandbox: find your existing agent deployment links below and access your token server URL in Project settings. To test your agent, you can also access deployment preview links directly from your agents in the dashboard.
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

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-4 px-4 text-xs text-muted-foreground">
            <span>Name</span>
            <span>Template</span>
            <span>URL</span>
            <span>Created</span>
            <span className="w-28"></span>
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
            <div className="space-y-2">
              {apps.map((app) => (
                <Card key={app.id} className="py-0">
                  <CardContent className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-4 px-4 py-3">
                    <span className="text-sm font-medium text-foreground truncate">
                      {app.name}
                    </span>
                    <Badge variant="outline" className="w-fit text-xs">
                      {app.template}
                    </Badge>
                    <span className="text-xs text-muted-foreground truncate">
                      {app.url}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(app.createdAt).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" className="h-7 text-xs" asChild>
                        <a href={app.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="size-3" />
                          Launch
                        </a>
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                        <a
                          href={`https://github.com/livekit-examples/${app.template}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Code className="size-3" />
                          Code
                        </a>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-xs">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDelete(app.id)}
                          >
                            <Trash2 className="size-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
