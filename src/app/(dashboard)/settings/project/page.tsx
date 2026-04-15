"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

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


export default function ProjectSettingsPage() {
  const [projectName, setProjectName] = useState("husein");
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
        breadcrumb={[{ label: "Settings", href: "/settings/project" }]}
        actions={
          <Button size="sm">
            Save changes
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
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

            <CopyField
              label="Project URL"
              value={process.env.NEXT_PUBLIC_SANDBOX_DOMAIN || "http://localhost:3000"}
            />
            <CopyField
              label="SIP URI"
              value="sip.5frc2GqvR1.sip.livekit.cloud"
            />
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
      </div>
    </div>
  );
}
