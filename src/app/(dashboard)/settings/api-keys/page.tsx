"use client";

import { useCallback, useEffect, useState } from "react";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Check, Loader2, Eye, EyeOff, Plus, Trash2, TriangleAlert } from "lucide-react";

interface IssuedKey {
  id: number;
  description: string;
  apiKey: string;
  owner: string;
  createdAt: string;
  revokedAt: string | null;
}

interface GeneratedKey {
  description: string;
  apiKey: string;
  apiSecret: string;
  wsUrl: string;
  gatewayConfigured: boolean;
}

function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="icon"
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
    </Button>
  );
}

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input readOnly value={value} className={mono ? "font-mono text-sm" : "text-sm"} />
        <CopyButton value={value} />
      </div>
    </div>
  );
}

/** Mirrors LiveKit Cloud: the secret is shown here once and never again. */
function GeneratedKeyDialog({
  generated,
  onClose,
}: {
  generated: GeneratedKey | null;
  onClose: () => void;
}) {
  if (!generated) return null;
  const envBlock = `LIVEKIT_URL=${generated.wsUrl}
LIVEKIT_API_KEY=${generated.apiKey}
LIVEKIT_API_SECRET=${generated.apiSecret}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generated API key</DialogTitle>
          <DialogDescription>
            Copy the secret now — it is not stored in a readable form and cannot be shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <CopyField label="Websocket URL" value={generated.wsUrl} />
          <CopyField label="API key" value={generated.apiKey} mono />
          <CopyField label="API secret" value={generated.apiSecret} mono />

          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">Environment variables</Label>
            <div className="flex items-start gap-2">
              {/* Wrap rather than scroll: the secret line is long enough to sit
                  flush against the edge, and a hidden overflow reads as clipped. */}
              <pre className="min-w-0 flex-1 rounded-lg border bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                {envBlock}
              </pre>
              <CopyButton value={envBlock} />
            </div>
          </div>

          {!generated.gatewayConfigured && (
            <div className="flex gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs">
              <TriangleAlert className="size-4 shrink-0 text-yellow-500" />
              <div className="space-y-1 text-muted-foreground">
                <p className="font-medium text-foreground">Gateway URL not configured</p>
                <p>
                  Issued keys only work through the gateway. Set{" "}
                  <code className="rounded bg-muted px-1 py-0.5">
                    LIVEKIT_GATEWAY_PUBLIC_URL
                  </code>{" "}
                  and run <code className="rounded bg-muted px-1 py-0.5">npm run gateway</code>, or
                  this key will be rejected.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ApiKeysPage() {
  const [loading, setLoading] = useState(true);
  const [wsUrl, setWsUrl] = useState("");
  const [httpUrl, setHttpUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [secretVisible, setSecretVisible] = useState(false);
  const [canSeeSecret, setCanSeeSecret] = useState(false);

  const [keys, setKeys] = useState<IssuedKey[]>([]);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [gatewayConfigured, setGatewayConfigured] = useState(false);

  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedKey | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/api-keys");
    if (!res.ok) return;
    const data = await res.json();
    setWsUrl(data.wsUrl || "");
    setHttpUrl(data.httpUrl || "");
    setApiKey(data.apiKey || "");
    setApiSecret(data.apiSecret || "");
    setCanSeeSecret(data.canSeeSecret || false);
    setKeys(data.keys || []);
    setGatewayUrl(data.gatewayUrl || "");
    setGatewayConfigured(!!data.gatewayConfigured);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const generate = async () => {
    setError("");
    setGenerating(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not generate key");
        return;
      }
      setGenerated(data);
      setDescription("");
      await load();
    } catch {
      setError("Could not generate key");
    } finally {
      setGenerating(false);
    }
  };

  const revoke = async (key: IssuedKey) => {
    setError("");
    const res = await fetch(`/api/api-keys/${key.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not revoke key");
      return;
    }
    await load();
  };

  const maskedSecret = apiSecret ? apiSecret.slice(0, 6) + "••••••••••••••••••••" : "";

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Keys" breadcrumb={[{ label: "Settings", href: "/settings/project" }]} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* ── Issued keys ── */}
            <div>
              <h2 className="text-xl font-semibold">API keys</h2>
              <p className="text-sm text-muted-foreground">
                Generate a key per agent, sandbox, or service. Each one is validated by the gateway
                and can be revoked immediately without restarting the LiveKit server.
              </p>
            </div>

            {!gatewayConfigured && (
              <div className="flex gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
                <TriangleAlert className="size-4 shrink-0 text-yellow-500" />
                <div className="space-y-1 text-muted-foreground">
                  <p className="font-medium text-foreground">Gateway not configured</p>
                  <p>
                    Set <code className="rounded bg-muted px-1 py-0.5 text-xs">LIVEKIT_GATEWAY_PUBLIC_URL</code>{" "}
                    (e.g. <code className="rounded bg-muted px-1 py-0.5 text-xs">ws://localhost:7885</code>) and
                    run <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run gateway</code>. Until then,
                    issued keys are handed out with the direct server URL and will be rejected.
                  </p>
                </div>
              </div>
            )}

            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-sm text-muted-foreground">Description</Label>
                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="e.g. voice-agent-prod"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && description.trim() && !generating) generate();
                      }}
                    />
                  </div>
                  <Button onClick={generate} disabled={!description.trim() || generating}>
                    {generating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    Generate key
                  </Button>
                </div>

                {keys.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No API keys yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 font-medium">Description</th>
                          <th className="pb-2 font-medium">Key</th>
                          <th className="pb-2 font-medium">Owner</th>
                          <th className="pb-2 font-medium">Created</th>
                          <th className="pb-2 font-medium">Status</th>
                          <th className="pb-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {keys.map((k) => (
                          <tr key={k.id} className="border-b last:border-0">
                            <td className="py-2.5">{k.description}</td>
                            <td className="py-2.5 font-mono text-xs">{k.apiKey}</td>
                            <td className="py-2.5 text-muted-foreground">{k.owner}</td>
                            <td className="py-2.5 text-muted-foreground">
                              {new Date(k.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-2.5">
                              {k.revokedAt ? (
                                <Badge variant="outline" className="text-muted-foreground">
                                  Revoked
                                </Badge>
                              ) : (
                                <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                                  Active
                                </Badge>
                              )}
                            </td>
                            <td className="py-2.5 text-right">
                              {!k.revokedAt && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => revoke(k)}
                                  aria-label={`Revoke ${k.apiKey}`}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── The server's own key pair ── */}
            <div>
              <h2 className="text-xl font-semibold">Server key</h2>
              <p className="text-sm text-muted-foreground">
                The key pair from <code className="rounded bg-muted px-1 py-0.5 text-xs">.env</code>, held by
                the LiveKit server itself. The gateway re-signs issued keys with it — keep it internal
                and hand out generated keys instead.
              </p>
            </div>

            <Card>
              <CardContent className="space-y-5 pt-6">
                <CopyField label="Websocket URL" value={wsUrl} />
                <CopyField label="HTTP URL" value={httpUrl} />
                {gatewayUrl && gatewayConfigured && (
                  <CopyField label="Gateway URL (for issued keys)" value={gatewayUrl} />
                )}
                <CopyField label="API Key" value={apiKey} mono />

                {canSeeSecret ? (
                  <div className="space-y-1.5">
                    <Label className="text-sm text-muted-foreground">API Secret</Label>
                    {secretVisible ? (
                      <div className="space-y-2">
                        <CopyField label="" value={apiSecret} mono />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => setSecretVisible(false)}
                        >
                          <EyeOff className="size-3" />
                          Hide secret
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Input readOnly value={maskedSecret} className="font-mono text-sm" />
                        <Button
                          variant="default"
                          className="w-full"
                          onClick={() => setSecretVisible(true)}
                        >
                          <Eye className="size-4" />
                          Reveal secret
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-sm text-muted-foreground">API Secret</Label>
                    <p className="text-sm text-muted-foreground">
                      Only admins can view the API secret.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <GeneratedKeyDialog generated={generated} onClose={() => setGenerated(null)} />
    </div>
  );
}
