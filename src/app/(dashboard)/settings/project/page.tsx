"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { Copy, Info, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-foreground/70">{label}</Label>
      <div className="flex items-center gap-2">
        <Input type="text" readOnly value={value} />
        <Button
          variant="outline"
          size="icon"
          onClick={() => navigator.clipboard.writeText(value)}
          className="shrink-0"
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

const codecs = [
  { name: "None", checked: false },
  { name: "Audio RED (Redundant encoding)", checked: true },
  { name: "H.264", checked: false },
  { name: "VP8", checked: false },
  { name: "VP9", checked: false },
  { name: "AV1", checked: false },
];

const quotas = [
  { type: "Concurrent participants", limit: "100", peak: "-" },
  { type: "Concurrent Egress requests", limit: "2", peak: "0" },
  { type: "Concurrent Ingress requests", limit: "2", peak: "0" },
  { type: "Concurrent agent sessions", limit: "6", peak: "0" },
  { type: "Agents deployed to LiveKit Cloud", limit: "4", peak: "1" },
  { type: "Concurrent SIT", limit: "-", peak: "-" },
  { type: "Concurrent TTS", limit: "5", peak: "-" },
  { type: "LLM requests per minute", limit: "100", peak: "-" },
  { type: "LLM tokens per minute", limit: "900,000", peak: "0" },
];

export default function ProjectSettingsPage() {
  const [projectName, setProjectName] = useState("husein");
  const [autoCreate, setAutoCreate] = useState(true);
  const [editorsControl, setEditorsControl] = useState(false);
  const [allowPausing, setAllowPausing] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [tokenServer, setTokenServer] = useState("");
  const [codecState, setCodecState] = useState(
    codecs.map((c) => ({ ...c }))
  );

  function toggleCodec(index: number) {
    setCodecState((prev) =>
      prev.map((c, i) => (i === index ? { ...c, checked: !c.checked } : c))
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Project"
        breadcrumb={["husein", "Settings"]}
        actions={
          <Button size="sm">
            Save changes
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Info banner */}
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Token server</AlertTitle>
          <AlertDescription>
            A new home for token server: access or configure your token server
            URL below.
          </AlertDescription>
        </Alert>

        {/* Project settings */}
        <Card>
          <CardHeader>
            <CardTitle>Project settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <h3 className="text-sm font-semibold text-foreground/70">
              General
            </h3>

            <div className="space-y-1.5">
              <Label className="text-foreground/70">
                Project name
              </Label>
              <Input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>

            <CopyField label="Project ID" value="p_bfkVDpsdR" />
            <CopyField
              label="Project URL"
              value="husein-sqlbeqg.livekit.cloud"
            />
            <CopyField
              label="SIP URI"
              value="sip.5frc2GqvR1.sip.livekit.cloud"
            />
          </CardContent>
        </Card>

        {/* Options */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground/70">
              Options
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Rooms and participants */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">
                Rooms and participants
              </h4>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="autoCreate"
                  checked={autoCreate}
                  onCheckedChange={() => setAutoCreate(!autoCreate)}
                />
                <Label htmlFor="autoCreate" className="text-foreground/70 cursor-pointer">
                  Automatically create rooms on participant join
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="editorsControl"
                  checked={editorsControl}
                  onCheckedChange={() => setEditorsControl(!editorsControl)}
                />
                <Label htmlFor="editorsControl" className="text-foreground/70 cursor-pointer">
                  Editors can remotely control tracks
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="allowPausing"
                  checked={allowPausing}
                  onCheckedChange={() => setAllowPausing(!allowPausing)}
                />
                <Label htmlFor="allowPausing" className="text-foreground/70 cursor-pointer">
                  Allow pausing codecs when subscribers are congested
                </Label>
              </div>
            </div>

            {/* Dashboard */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">Dashboard</h4>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="showOnboarding"
                  checked={showOnboarding}
                  onCheckedChange={() => setShowOnboarding(!showOnboarding)}
                />
                <Label htmlFor="showOnboarding" className="text-foreground/70 cursor-pointer">
                  Show onboarding instructions on dashboard
                </Label>
              </div>
            </div>

            {/* Token server */}
            <div className="space-y-1.5">
              <Label className="text-foreground/70">
                Token server
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={tokenServer}
                  onChange={(e) => setTokenServer(e.target.value)}
                  placeholder="https://"
                />
                <Button variant="outline" size="sm">
                  Set
                </Button>
              </div>
            </div>

            {/* Agent observability */}
            <div className="space-y-1.5">
              <h4 className="text-sm font-medium text-foreground">
                Agent observability
              </h4>
              <p className="text-sm text-muted-foreground">
                Configure observability settings for your agents.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Enabled codecs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground/70">
              Enabled codecs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {codecState.map((codec, i) => (
              <div key={codec.name} className="flex items-center gap-3">
                <Checkbox
                  id={`codec-${i}`}
                  checked={codec.checked}
                  onCheckedChange={() => toggleCodec(i)}
                />
                <Label htmlFor={`codec-${i}`} className="text-foreground/70 cursor-pointer">
                  {codec.name}
                </Label>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Plan quotas */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground/70">
              Plan quotas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Limit</th>
                    <th className="px-4 py-2.5 font-medium">
                      Peak Usage (Past 7 Days)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quotas.map((q) => (
                    <tr
                      key={q.type}
                      className="border-b last:border-0"
                    >
                      <td className="px-4 py-2.5 text-foreground/70">
                        {q.type}
                      </td>
                      <td className="px-4 py-2.5 text-foreground">{q.limit}</td>
                      <td className="px-4 py-2.5 text-foreground">{q.peak}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-destructive">
              Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Delete project
                </p>
                <p className="text-sm text-muted-foreground">
                  Permanently delete this project and all associated data.
                </p>
              </div>
              <Button variant="destructive" size="sm">
                <Trash2 className="size-3.5" />
                Delete project
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
