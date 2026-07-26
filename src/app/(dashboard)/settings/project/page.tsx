"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { Copy, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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


interface CaptureSettings {
  enabled: boolean;
  audio: boolean;
  maxMinutes: number;
  configured: boolean;
  limits: { minMinutes: number; maxMinutes: number };
  observing: { room: string; startedAt: string }[];
}

/**
 * Recording sessions that no browser tab hosted — an inbound phone call, a
 * sandbox app. Off by default: with it on, the dashboard joins every room the
 * server reports and writes its audio to storage, which is the operator's call
 * to make. Saves on change rather than waiting for a Save button, so the state
 * on screen is always the state in the database.
 */
function SessionCaptureCard() {
  const [capture, setCapture] = useState<CaptureSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/sessions/capture")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setCapture(data?.capture ?? null))
      .catch(() => {});
  }, []);

  const save = useCallback(
    async (patch: Partial<Pick<CaptureSettings, "enabled" | "audio" | "maxMinutes">>) => {
      setSaving(true);
      try {
        const res = await fetch("/api/sessions/capture", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          toast.error("Could not change session capture", {
            description:
              data.error === "Insufficient permissions"
                ? "Only an admin or owner can change this."
                : data.error || `HTTP ${res.status}`,
          });
          return;
        }

        setCapture((prev) => (prev ? { ...prev, ...data.capture } : prev));
        if (patch.enabled === true) {
          toast.success("Session capture is on", {
            description: "Rooms that start from now on are recorded to Sessions → History.",
          });
        } else if (patch.enabled === false) {
          toast.success("Session capture is off", {
            description: "Calls already being recorded finish; no new room is joined.",
          });
        }
      } catch {
        toast.error("Could not reach the dashboard API");
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session capture</CardTitle>
        <CardDescription>
          The console records the sessions it hosts. Turn this on and the dashboard also
          records the ones it does not — inbound SIP calls, sandbox apps, anything holding
          a token — by joining each room as a hidden participant and writing the
          transcript, event log and audio to Sessions → History.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!capture ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-1">
                <Label htmlFor="capture-enabled" className="cursor-pointer">
                  Record sessions without a browser
                </Label>
                <p className="text-xs text-muted-foreground">
                  Off by default. Applies to rooms that start after the change; a call
                  already being recorded is left alone.
                </p>
              </div>
              <Switch
                id="capture-enabled"
                checked={capture.enabled}
                disabled={saving || !capture.configured}
                onCheckedChange={(enabled) => void save({ enabled })}
              />
            </div>

            <div className="flex items-start justify-between gap-6">
              <div className="space-y-1">
                <Label htmlFor="capture-audio" className="cursor-pointer">
                  Store the audio
                </Label>
                <p className="text-xs text-muted-foreground">
                  Mixes every track into one WAV in whichever backend Settings → Storage
                  points at. Turn it off to keep only the transcript and the event log.
                </p>
              </div>
              <Switch
                id="capture-audio"
                checked={capture.audio}
                disabled={saving || !capture.enabled}
                onCheckedChange={(audio) => void save({ audio })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="capture-minutes" className="text-foreground/70">
                Stop recording a session after
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="capture-minutes"
                  type="number"
                  min={capture.limits.minMinutes}
                  max={capture.limits.maxMinutes}
                  value={capture.maxMinutes}
                  disabled={saving || !capture.enabled}
                  className="w-28"
                  onChange={(e) =>
                    setCapture((prev) =>
                      prev ? { ...prev, maxMinutes: Number(e.target.value) } : prev
                    )
                  }
                  onBlur={(e) => void save({ maxMinutes: Number(e.target.value) })}
                />
                <span className="text-sm text-muted-foreground">minutes</span>
                {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
              </div>
              <p className="text-xs text-muted-foreground">
                A hard stop, so one room left open cannot fill the disk.
              </p>
            </div>

            {!capture.configured && (
              <p className="text-xs text-yellow-500">
                LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not configured, so the dashboard
                cannot join a room to record it.
              </p>
            )}

            {capture.enabled && (
              <p className="text-xs text-muted-foreground">
                {capture.observing.length === 0
                  ? "No room is being recorded right now."
                  : `Recording now: ${capture.observing.map((o) => o.room).join(", ")}`}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Capture needs the webhook receiver: `webhook.urls` in `livekit.yaml` has to
              point at this dashboard, since a room starting is how it finds out.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

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

        <SessionCaptureCard />

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
