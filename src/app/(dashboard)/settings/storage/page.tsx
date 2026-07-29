"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, XCircle, HardDrive, Loader2, Cloud, Save, TestTube2 } from "lucide-react";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Where session audio is written.
 *
 * Console recordings default to the dashboard's own disk, which is fine until
 * the dashboard is a container that gets replaced. Pointing this at an
 * S3-compatible bucket makes recordings outlive the deployment — and lets the
 * session history page play them back from anywhere.
 */

interface StorageView {
  provider: "local" | "s3";
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  /** A secret is stored; its value is never sent to the browser. */
  secretConfigured: boolean;
  forcePathStyle: boolean;
  description: string;
}

const EMPTY: StorageView = {
  provider: "local",
  endpoint: "",
  region: "us-east-1",
  bucket: "",
  prefix: "console-recordings",
  accessKeyId: "",
  secretConfigured: false,
  forcePathStyle: true,
  description: "",
};

export default function StorageSettingsPage() {
  const [form, setForm] = useState<StorageView>(EMPTY);
  const [saved, setSaved] = useState<StorageView | null>(null);
  /** Only sent when the operator types one; blank means "keep the stored key". */
  const [secret, setSecret] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const canManage = role === "owner" || role === "admin";
  const isS3 = form.provider === "s3";

  useEffect(() => {
    fetch("/api/storage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.storage) {
          setForm(data.storage as StorageView);
          setSaved(data.storage as StorageView);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setRole(d?.user?.role ?? null))
      .catch(() => {});
  }, []);

  const body = () => ({
    provider: form.provider,
    endpoint: form.endpoint,
    region: form.region,
    bucket: form.bucket,
    prefix: form.prefix,
    accessKeyId: form.accessKeyId,
    // Blank means "unchanged" all the way down to the database.
    secretAccessKey: secret || undefined,
    forcePathStyle: form.forcePathStyle,
  });

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Could not save storage settings", {
          description: data.error || `HTTP ${res.status}`,
        });
        return;
      }
      setForm(data.storage);
      setSaved(data.storage);
      setSecret("");
      toast.success("Storage settings saved", { description: data.storage.description });
    } catch {
      toast.error("Could not reach the dashboard API");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/storage/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body()),
      });
      const data = await res.json().catch(() => ({}));
      const result = {
        ok: !!data.ok,
        message: data.message || data.error || `HTTP ${res.status}`,
      };
      // No toast: the result renders inline under the form, right where the
      // endpoint and credentials being tested are. A toast alongside it says the
      // same thing twice and floats the message away from the fields it is about.
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, message: "Could not reach the dashboard API" });
    } finally {
      setTesting(false);
    }
  };

  const field = (key: keyof StorageView) => ({
    disabled: !canManage,
    value: String(form[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value })),
  });

  return (
    <div className="flex h-full flex-col">
      <TopBar
        title="Storage"
        breadcrumb={[{ label: "Settings", href: "/settings/project" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void test()}
              disabled={!canManage || testing || loading}
            >
              {testing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <TestTube2 className="size-3.5" />
              )}
              Test connection
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={!canManage || saving || loading}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save changes
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto bg-background p-6">
        {!canManage && role !== null && (
          <div className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            You have view-only access. An owner or admin can change where recordings are stored.
          </div>
        )}

        {/* Configuration takes the width it can use; the explainer sits beside
            it rather than under a column of half-empty inputs. */}
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card>
            <CardHeader>
              <CardTitle>Session audio storage</CardTitle>
              <CardDescription>
                Where console recordings are written. Existing recordings are read back from
                wherever they were written, so switching backends never orphans old audio — it only
                changes where the next session goes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    {
                      value: "local",
                      title: "Local disk",
                      hint: "data/console-recordings on the dashboard host",
                      icon: HardDrive,
                    },
                    {
                      value: "s3",
                      title: "S3-compatible",
                      hint: "AWS S3, MinIO, Ceph, R2, Wasabi…",
                      icon: Cloud,
                    },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setForm((prev) => ({ ...prev, provider: option.value }))}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      form.provider === option.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent/40",
                      !canManage && "cursor-not-allowed opacity-70"
                    )}
                  >
                    <option.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {option.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">{option.hint}</span>
                    </span>
                  </button>
                ))}
              </div>

              {saved && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                  <span className="font-mono uppercase tracking-wide text-muted-foreground">
                    In use
                  </span>
                  <span className="font-mono text-foreground/80">{saved.description}</span>
                  {saved.provider !== form.provider && (
                    <Badge variant="outline" className="text-[10px] uppercase text-yellow-500">
                      unsaved change
                    </Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {isS3 && (
            <Card>
              <CardHeader>
                <CardTitle>Bucket</CardTitle>
                <CardDescription>
                  Credentials are stored encrypted and used only by the dashboard, which streams
                  audio to the browser — the bucket never needs to be public.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Bucket</Label>
                    <Input placeholder="livekit-recordings" {...field("bucket")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Region</Label>
                    <Input placeholder="us-east-1" {...field("region")} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Endpoint{" "}
                    <span className="font-normal text-muted-foreground">
                      (blank for AWS S3)
                    </span>
                  </Label>
                  <Input
                    placeholder="http://localhost:9000"
                    className="font-mono text-sm"
                    {...field("endpoint")}
                  />
                  <p className="text-xs text-muted-foreground">
                    The S3 API URL of your provider. MinIO on this host is usually{" "}
                    <code className="font-mono">http://localhost:9000</code>.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Key prefix{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    placeholder="console-recordings"
                    className="font-mono text-sm"
                    {...field("prefix")}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Access key ID</Label>
                    <Input className="font-mono text-sm" {...field("accessKeyId")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Secret access key</Label>
                    <Input
                      type="password"
                      autoComplete="off"
                      disabled={!canManage}
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder={
                        form.secretConfigured ? "•••••••• (unchanged)" : "required for S3"
                      }
                      className="font-mono text-sm"
                    />
                    {form.secretConfigured && !secret && (
                      <p className="text-xs text-muted-foreground">
                        A key is stored. Leave this blank to keep it.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="path-style">Force path-style addressing</Label>
                    <p className="text-xs text-muted-foreground">
                      Requests go to <code className="font-mono">endpoint/bucket/key</code> rather
                      than <code className="font-mono">bucket.endpoint/key</code>. Required by MinIO
                      and most self-hosted gateways; turn it off for AWS S3.
                    </p>
                  </div>
                  <Switch
                    id="path-style"
                    checked={form.forcePathStyle}
                    disabled={!canManage}
                    onCheckedChange={(checked) =>
                      setForm((prev) => ({ ...prev, forcePathStyle: checked }))
                    }
                  />
                </div>

                {testResult && (
                  <div
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                      testResult.ok
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-destructive/30 bg-destructive/10 text-destructive"
                    )}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0" />
                    )}
                    <span className="min-w-0 break-words">{testResult.message}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>What this affects</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Console sessions are recorded in the browser and uploaded when the session ends —
                  the agent&apos;s own audio, your side, and the mix. They are played back from{" "}
                  <Link href="/sessions/history" className="text-foreground underline-offset-4 hover:underline">
                    Sessions → History
                  </Link>{" "}
                  alongside the transcript, the event timeline and the metrics of the same call.
                </p>
                <p>
                  Each recording remembers which backend holds it, so switching here changes only
                  where the next session is written. Older audio keeps playing from where it is.
                </p>
                <p>
                  LiveKit&apos;s own egress recordings are configured separately in{" "}
                  <code className="font-mono">livekit.yaml</code>; this setting does not touch them.
                </p>
              </CardContent>
            </Card>

            {isS3 && (
              <Card>
                <CardHeader>
                  <CardTitle>Minimum bucket policy</CardTitle>
                  <CardDescription>
                    The dashboard only ever reads, writes and deletes objects under its own prefix.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
{`s3:PutObject
s3:GetObject
s3:DeleteObject

arn:aws:s3:::${form.bucket || "<bucket>"}/${form.prefix ? `${form.prefix}/` : ""}*`}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
