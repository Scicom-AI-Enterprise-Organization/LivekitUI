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
import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { ListError, ListLoading } from "@/components/livekit/list-state";

interface AccessToken {
  id: number;
  name: string;
  prefix: string;
  owner: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="icon"
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

export default function AccessTokensPage() {
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/access-tokens");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not load tokens");
        return;
      }
      setTokens(data.tokens || []);
      setError(null);
    } catch {
      setError("Could not reach the dashboard API");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/access-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not create token");
        return;
      }
      setCreated({ name: data.name, token: data.token });
      setName("");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (token: AccessToken) => {
    const res = await fetch(`/api/access-tokens/${token.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not revoke token");
      return;
    }
    await load();
  };

  const curlSample = created
    ? `curl http://localhost:3010/api/agents \\\n  -H "Authorization: Bearer ${created.token}"`
    : "";

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Access tokens" breadcrumb={[{ label: "Settings", href: "/settings/project" }]} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Access tokens</h2>
          <p className="text-sm text-muted-foreground">
            Bearer tokens for this dashboard&apos;s REST API — see{" "}
            <a href="/api-docs" className="text-primary hover:underline">API docs</a>. These are
            separate from LiveKit API keys: a token here calls the dashboard, a LiveKit key connects
            to the media server. A token carries the role of whoever created it.
          </p>
        </div>

        {error && <ListError message={error} />}

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label className="text-sm text-muted-foreground">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. ci-bot"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim() && !creating) create();
                  }}
                />
              </div>
              <Button onClick={create} disabled={!name.trim() || creating}>
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Create token
              </Button>
            </div>

            {loading ? (
              <ListLoading />
            ) : tokens.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No access tokens yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Name</th>
                      <th className="pb-2 font-medium">Token</th>
                      <th className="pb-2 font-medium">Owner</th>
                      <th className="pb-2 font-medium">Created</th>
                      <th className="pb-2 font-medium">Last used</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((t) => (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="py-2.5">{t.name}</td>
                        <td className="py-2.5 font-mono text-xs">{t.prefix}…</td>
                        <td className="py-2.5 text-muted-foreground">{t.owner}</td>
                        <td className="py-2.5 text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 text-muted-foreground">
                          {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}
                        </td>
                        <td className="py-2.5">
                          {t.revokedAt ? (
                            <Badge variant="outline" className="text-muted-foreground">Revoked</Badge>
                          ) : (
                            <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                              Active
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          {!t.revokedAt && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => revoke(t)}
                              aria-label={`Revoke ${t.name}`}
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
      </div>

      <Dialog open={!!created} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Access token created</DialogTitle>
            <DialogDescription>
              Copy it now — only a hash is stored, so it cannot be shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Token</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={created?.token || ""} className="font-mono text-sm" />
                <CopyButton value={created?.token || ""} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Example request</Label>
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 rounded-lg border bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                  {curlSample}
                </pre>
                <CopyButton value={curlSample} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
