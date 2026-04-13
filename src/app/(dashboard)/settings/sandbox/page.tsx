"use client";

import { TopBar } from "@/components/livekit/top-bar";
import Link from "next/link";
import {
  Download,
  Info,
  MoreHorizontal,
  AudioLines,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

const templates = [
  {
    name: "Web Voice Agent",
    description:
      "A starter app for Next.js, featuring a flexible voice AI frontend",
    icon: AudioLines,
    href: "/settings/sandbox/agent-starter-react",
  },
  {
    name: "Video conference",
    description:
      "An open source video conferencing app built on LiveKit Components, LiveKit Cloud, and...",
    icon: Video,
    href: "/settings/sandbox/meet",
  },
];

const sandboxApps = [
  { name: "husein-test-27jc8" },
  { name: "demo-husein-pqbfds" },
];

export default function SandboxPage() {
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
              <Card
                className="group relative hover:border-primary/40 transition-colors cursor-pointer"
              >
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
          <AlertTitle>Sandbox apps</AlertTitle>
          <AlertDescription>
            Sandbox apps are temporary environments for testing and development.
            They may be automatically cleaned up after a period of inactivity.
          </AlertDescription>
        </Alert>

        {/* Sandbox apps */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Sandbox apps
            </h2>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto] gap-4 px-4 text-xs text-muted-foreground">
            <div className="grid grid-cols-5 gap-4">
              <span>Name</span>
              <span>Started Built</span>
              <span>Agent</span>
              <span>Started</span>
              <span>Forked Time</span>
            </div>
            <div className="w-32" />
          </div>

          {/* App cards */}
          <div className="space-y-2">
            {sandboxApps.map((app) => (
              <Card key={app.name}>
                <CardContent className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-foreground">
                      {app.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm">
                      Launch
                    </Button>
                    <Button variant="outline" size="sm">
                      Code
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
