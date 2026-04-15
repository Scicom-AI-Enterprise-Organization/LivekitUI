"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Copy, Check, Loader2, Eye, EyeOff } from "lucide-react";

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input readOnly value={value} className={mono ? "font-mono text-sm" : "text-sm"} />
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
      </div>
    </div>
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

  useEffect(() => {
    fetch("/api/api-keys")
      .then((r) => r.json())
      .then((data) => {
        setWsUrl(data.wsUrl || "");
        setHttpUrl(data.httpUrl || "");
        setApiKey(data.apiKey || "");
        setApiSecret(data.apiSecret || "");
        setCanSeeSecret(data.canSeeSecret || false);
      })
      .finally(() => setLoading(false));
  }, []);

  const maskedSecret = apiSecret ? apiSecret.slice(0, 6) + "••••••••••••••••••••" : "";

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Keys" breadcrumb={[{ label: "Settings", href: "/settings/project" }]} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">API keys</h2>
          <p className="text-sm text-muted-foreground">
            Use these credentials to connect agents, sandbox apps, and other services to the LiveKit server.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card>
            <CardContent className="space-y-5 pt-6">
              <CopyField label="Websocket URL" value={wsUrl} />
              <CopyField label="HTTP URL" value={httpUrl} />
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

              <div className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground space-y-2">
                <p className="font-medium text-foreground">Usage</p>
                <p>Set these in your agent or sandbox <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.local</code>:</p>
                <pre className="rounded bg-muted p-3 text-xs font-mono overflow-x-auto">
{`LIVEKIT_URL=${wsUrl}
LIVEKIT_API_KEY=${apiKey}
LIVEKIT_API_SECRET=${secretVisible ? apiSecret : "<your-secret>"}`}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
