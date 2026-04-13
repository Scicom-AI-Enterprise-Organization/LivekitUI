"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AudioLines,
  ExternalLink,
  FileText,
  Code,
  BookOpen,
  Eye,
} from "lucide-react";

export default function AgentStarterReactPage() {
  return (
    <div className="flex h-full flex-col">
      <TopBar
        title="Agent-starter-react"
        breadcrumb={["husein", "Settings", "Sandbox", "Templates"]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-8 p-6">
          {/* Left — Main content */}
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
                  https://agent-starter-react.sandbox.livekit.io
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
                  <span className="text-xs text-muted-foreground">1:44 Alive</span>
                </div>
              </div>
            </div>

            {/* Overview */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">Overview</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A Next.js frontend for a simple AI voice assistant using LiveKit&apos;s official JavaScript SDK and React Components. The application implements its own token server, and supports voice, transcription, and virtual avatars.
              </p>
            </div>
          </div>

          {/* Right — Sidebar info */}
          <div className="w-[280px] shrink-0 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-foreground mb-2">
                Web Voice Agent
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A starter app for Next.js, featuring a flexible voice AI frontend.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button size="sm" className="gap-1.5">
                Create sandbox
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Code className="size-3" />
                Code
              </Button>
            </div>

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
              <h3 className="text-sm font-semibold text-foreground">Works with</h3>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-xs gap-1">
                  Python multi-agent workflow
                  <ExternalLink className="size-2.5" />
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  Node.js Voice Agent
                  <ExternalLink className="size-2.5" />
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  Python Voice Agent
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
    </div>
  );
}
