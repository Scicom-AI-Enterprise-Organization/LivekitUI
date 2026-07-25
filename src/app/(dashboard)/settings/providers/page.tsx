"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/livekit/top-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  Loader2,
  Pencil,
  Server,
  AlertTriangle,
  PlugZap,
  Check,
  X,
} from "lucide-react";
import {
  MODEL_KINDS,
  PROVIDER_PLUGINS,
  TTS_AUDIO_FORMATS,
  effectiveBaseUrl,
  slugify,
  type ModelKind,
  type Provider,
} from "@/lib/providers";

type ApiProvider = Provider & { secretMissing?: boolean };

interface ModelRow {
  id: string;
  label: string;
  kind: ModelKind;
}

interface TestResult {
  /** Connection settings this result belongs to — invalidated when they change. */
  key: string;
  ok: boolean;
  endpoint?: string;
  keySource?: string;
  error?: string;
  warning?: string;
  models: string[];
}

const pluginLabel: Record<string, string> = Object.fromEntries(PROVIDER_PLUGINS.map((p) => [p.id, p.label]));

/* ────────────────────────────────────
   Add / edit provider dialog
   ──────────────────────────────────── */
function ProviderDialog({
  provider,
  secretNames,
  onClose,
  onSaved,
}: {
  /** null = creating a new provider. */
  provider: ApiProvider | null;
  secretNames: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Mounted with a key per target provider, so plain initial state is enough.
  const [name, setName] = useState(provider?.name ?? "");
  const [slug, setSlug] = useState(provider?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!provider);
  const [plugin, setPlugin] = useState(provider?.plugin ?? "openai");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [apiKeySecret, setApiKeySecret] = useState(provider?.apiKeySecret ?? "");
  const [audioFormat, setAudioFormat] = useState(provider?.audioFormat ?? "");
  const [models, setModels] = useState<ModelRow[]>(
    provider?.models.map((m) => ({ id: m.id, label: m.label || "", kind: m.kind })) ?? []
  );
  const [voices, setVoices] = useState(
    provider?.voices.map((v) => (v.label && v.label !== v.id ? `${v.id}:${v.label}` : v.id)).join(", ") ?? ""
  );
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [discoveredKind, setDiscoveredKind] = useState<ModelKind>("llm");

  const effectiveSlug = slugTouched ? slugify(slug) : slugify(name);
  const endpoint = effectiveBaseUrl(plugin, baseUrl);
  const pluginKinds = useMemo(
    () => PROVIDER_PLUGINS.find((p) => p.id === plugin)?.kinds ?? (MODEL_KINDS.map((k) => k.id) as ModelKind[]),
    [plugin]
  );

  // Only the connection settings decide whether a test result is still valid.
  const connectionKey = `${plugin}|${baseUrl.trim().replace(/\/+$/, "")}|${apiKeySecret}`;
  const savedConnectionKey = provider
    ? `${provider.plugin}|${(provider.baseUrl ?? "").replace(/\/+$/, "")}|${provider.apiKeySecret ?? ""}`
    : null;
  const testPassed = !!test && test.ok && test.key === connectionKey;
  const testFailed = !!test && !test.ok && test.key === connectionKey;
  // An untouched connection on an existing provider was already verified.
  const connectionUnchanged = savedConnectionKey !== null && connectionKey === savedConnectionKey;
  const canSave = testPassed || connectionUnchanged;

  const addModelRow = () =>
    setModels((prev) => [...prev, { id: "", label: "", kind: pluginKinds[0] || "llm" }]);
  const updateModelRow = (i: number, patch: Partial<ModelRow>) =>
    setModels((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const removeModelRow = (i: number) => setModels((prev) => prev.filter((_, idx) => idx !== i));

  const runTest = async () => {
    setTesting(true);
    setSelectedModels(new Set());
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plugin, baseUrl, apiKeySecret: apiKeySecret || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTest({ key: connectionKey, ok: false, error: data.error || "Test failed", models: [] });
        return;
      }
      const found: string[] = Array.isArray(data.models) ? data.models : [];
      setTest({
        key: connectionKey,
        ok: !!data.ok,
        endpoint: data.endpoint,
        keySource: data.keySource,
        error: data.error,
        warning: data.warning,
        models: found,
      });
      // Preselect everything not already listed, ready to import.
      const existing = new Set(models.map((m) => m.id));
      setSelectedModels(new Set(found.filter((id) => !existing.has(id))));
    } finally {
      setTesting(false);
    }
  };

  const addSelectedModels = () => {
    const existing = new Set(models.map((m) => m.id));
    const rows: ModelRow[] = [...selectedModels]
      .filter((id) => !existing.has(id))
      .map((id) => ({ id, label: "", kind: discoveredKind }));
    setModels((prev) => [...prev, ...rows]);
    setSelectedModels(new Set());
    setTest((prev) => (prev ? { ...prev, models: [] } : prev));
  };

  const save = async () => {
    setFormError("");
    if (!name.trim()) return setFormError("Name is required");
    if (!effectiveSlug) return setFormError("Slug must contain at least one letter or digit");

    const cleanModels = models
      .map((m) => ({ id: m.id.trim(), label: m.label.trim() || undefined, kind: m.kind }))
      .filter((m) => m.id);
    if (cleanModels.length === 0) {
      return setFormError("Add at least one model — these are the options shown in the agent builder");
    }

    const cleanVoices = voices
      .split(",")
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((raw) => {
        const [id, ...rest] = raw.split(":");
        const label = rest.join(":").trim();
        return { id: id.trim(), label: label || undefined };
      })
      .filter((v) => v.id);

    setSaving(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: provider?.id,
          name: name.trim(),
          slug: effectiveSlug,
          plugin,
          baseUrl,
          apiKeySecret,
          audioFormat,
          models: cleanModels,
          voices: cleanVoices,
          enabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || "Failed to save provider");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{provider ? "Edit provider" : "Add provider"}</DialogTitle>
          <DialogDescription>
            Models listed here become the options in the agent builder, referenced as{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{effectiveSlug || "slug"}/model-id</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Internal vLLM" />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input
                value={slugTouched ? slug : effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="internal-vllm"
                className="font-mono text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Plugin</Label>
            <Select value={plugin} onValueChange={setPlugin}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_PLUGINS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The LiveKit Python plugin used in the generated agent —{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{plugin}.LLM(...)</code>. Pick
              &quot;OpenAI-compatible&quot; for any server that speaks the OpenAI API.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>
              Base URL <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:8000/v1"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use the plugin&apos;s own default endpoint
              {endpoint && !baseUrl.trim() && (
                <>
                  {" "}
                  (<code className="rounded bg-muted px-1 py-0.5 text-xs">{endpoint}</code>)
                </>
              )}
              .
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>
              API key secret <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Select value={apiKeySecret || "__none__"} onValueChange={(v) => setApiKeySecret(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Use plugin default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Use plugin default</SelectItem>
                {secretNames.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
                {apiKeySecret && !secretNames.includes(apiKeySecret) && (
                  <SelectItem value={apiKeySecret}>{apiKeySecret} (missing)</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Generated agents read it as{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                os.getenv(&quot;{apiKeySecret || "SECRET_NAME"}&quot;)
              </code>
              .{" "}
              <Link href="/settings/secrets" className="text-primary hover:underline">
                Manage secrets
              </Link>
            </p>
          </div>

          {/* Connection test — gates saving */}
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Connection</Label>
                <p className="text-xs text-muted-foreground">
                  Check the endpoint and credential before saving.
                </p>
              </div>
              <Button variant="outline" size="sm" className="text-xs gap-1 shrink-0" onClick={runTest} disabled={testing}>
                {testing ? <Loader2 className="size-3 animate-spin" /> : <PlugZap className="size-3" />}
                Test connection
              </Button>
            </div>

            {testPassed && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
                <p className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-500">
                  <Check className="size-3.5" />
                  Connected to {test!.endpoint}
                </p>
                <p className="text-muted-foreground mt-0.5">
                  {test!.keySource && test!.keySource !== "none"
                    ? `Authenticated using ${test!.keySource}.`
                    : "No API key was sent — the endpoint accepted an unauthenticated request."}
                  {test!.models.length > 0 && ` ${test!.models.length} models reported.`}
                </p>
                {test!.warning && <p className="text-yellow-600 dark:text-yellow-500 mt-0.5">{test!.warning}</p>}
              </div>
            )}

            {testFailed && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <p className="flex items-center gap-1.5 font-medium">
                  <X className="size-3.5" />
                  Connection failed
                </p>
                <p className="mt-0.5 break-words">{test!.error}</p>
              </div>
            )}

            {!testPassed && !testFailed && !testing && (
              <p className="text-xs text-muted-foreground">
                {connectionUnchanged
                  ? "These settings were already saved. Test again if you want to re-check them."
                  : `Not tested yet — ${endpoint || "no endpoint"} will be checked.`}
              </p>
            )}
          </div>

          {/* Models discovered by the test */}
          {test?.models && test.models.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs">{test.models.length} models reported by the endpoint</Label>
                <Select value={discoveredKind} onValueChange={(v) => setDiscoveredKind(v as ModelKind)}>
                  <SelectTrigger className="h-7 w-28 text-xs ml-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_KINDS.filter((k) => pluginKinds.includes(k.id)).map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={addSelectedModels}
                  disabled={selectedModels.size === 0}
                >
                  Add {selectedModels.size}
                </Button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {test.models.map((id) => {
                  const already = models.some((m) => m.id === id);
                  return (
                    <label
                      key={id}
                      className={`flex items-center gap-2 text-xs ${already ? "opacity-50" : "cursor-pointer"}`}
                    >
                      <Checkbox
                        checked={selectedModels.has(id)}
                        disabled={already}
                        onCheckedChange={(v) =>
                          setSelectedModels((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(id);
                            else next.delete(id);
                            return next;
                          })
                        }
                      />
                      <span className="font-mono break-all">{id}</span>
                      {already && <span className="text-muted-foreground">already added</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Models */}
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label>Models</Label>

            {models.length > 0 && (
              <div className="space-y-2">
                <div className="grid grid-cols-[100px_1fr_1fr_32px] gap-2 text-xs text-muted-foreground">
                  <span>Type</span>
                  <span>Model id</span>
                  <span>Display name</span>
                  <span />
                </div>
                {models.map((m, i) => (
                  <div key={i} className="grid grid-cols-[100px_1fr_1fr_32px] gap-2 items-center">
                    <Select value={m.kind} onValueChange={(v) => updateModelRow(i, { kind: v as ModelKind })}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODEL_KINDS.map((k) => (
                          <SelectItem key={k.id} value={k.id}>
                            {k.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <input
                      value={m.id}
                      onChange={(e) => updateModelRow(i, { id: e.target.value })}
                      placeholder="Qwen3-32B"
                      className="h-8 rounded-md border border-border bg-card px-2 font-mono text-xs outline-none focus:border-primary"
                    />
                    <input
                      value={m.label}
                      onChange={(e) => updateModelRow(i, { label: e.target.value })}
                      placeholder="Qwen 3 32B"
                      className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => removeModelRow(i)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {models.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                No models yet. Test the connection to pull the list, or add them by hand.
              </p>
            )}

            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={addModelRow}>
              <Plus className="size-3" />
              Add model
            </Button>
          </div>

          {models.some((m) => m.kind === "tts") && (
            <div className="space-y-1.5">
              <Label>
                TTS audio format <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Select
                value={audioFormat || "__default__"}
                onValueChange={(v) => setAudioFormat(v === "__default__" ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Plugin default (mp3)</SelectItem>
                  {TTS_AUDIO_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Sent as <code className="rounded bg-muted px-1 py-0.5 text-xs">response_format</code>. Self-hosted TTS
                servers often accept only <code className="rounded bg-muted px-1 py-0.5 text-xs">wav</code> or{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">pcm</code> and reject the mp3 default with an
                HTTP 422.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              Voices <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input value={voices} onChange={(e) => setVoices(e.target.value)} placeholder="coral, alloy, ash:Ash" />
            <p className="text-xs text-muted-foreground">
              Comma separated, used for this provider&apos;s TTS and realtime models. Use{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">id:Display name</code> to label one. Leave empty to
              type the voice by hand in the builder.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={enabled} onCheckedChange={(v) => setEnabled(!!v)} />
            <span>Enabled — offer these models in the agent builder</span>
          </label>
        </div>

        <DialogFooter className="items-center">
          {!canSave && (
            <p className="text-xs text-muted-foreground mr-auto">
              Test the connection before {provider ? "saving" : "adding this provider"}.
            </p>
          )}
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={save}
            disabled={saving || !canSave}
            title={canSave ? undefined : "Run Test connection first"}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {provider ? "Save provider" : "Add provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────
   Page
   ──────────────────────────────────── */
export default function ProvidersPage() {
  return (
    <Suspense fallback={null}>
      <ProvidersContent />
    </Suspense>
  );
}

function ProvidersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The open dialog lives in the URL: ?provider=new or ?provider=<slug>
  const providerParam = searchParams.get("provider");

  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [secretNames, setSecretNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiProvider | null>(null);

  const fetchProviders = useCallback(
    () =>
      fetch("/api/providers")
        .then((r) => r.json())
        .then((d) => setProviders(d.providers ?? []))
        .catch(() => {})
        .finally(() => setLoading(false)),
    []
  );

  const fetchSecretNames = useCallback(
    () =>
      fetch("/api/secrets")
        .then((r) => r.json())
        .then((d) => setSecretNames((d.secrets ?? []).map((s: { name: string }) => s.name)))
        .catch(() => {}),
    []
  );

  useEffect(() => {
    fetchProviders();
    fetchSecretNames();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setRole(d?.user?.role ?? null))
      .catch(() => {});
  }, [fetchProviders, fetchSecretNames]);

  const canManage = role === "owner" || role === "admin";

  const setProviderParam = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (value) params.set("provider", value);
      else params.delete("provider");
      const qs = params.toString();
      router.replace(qs ? `/settings/providers?${qs}` : "/settings/providers", { scroll: false });
    },
    [router]
  );

  const openAdd = () => {
    // Secrets may have been added on the other page since this one loaded.
    fetchSecretNames();
    setProviderParam("new");
  };
  const openEdit = (p: ApiProvider) => {
    fetchSecretNames();
    setProviderParam(p.slug);
  };
  const closeDialog = () => setProviderParam(null);

  // Resolve the URL into the provider being edited. Keyed by the param below,
  // so the dialog mounts fresh — no effects needed to seed the form.
  const dialogTarget = providerParam === "new" ? "new" : providers.find((p) => p.slug === providerParam);

  const toggleEnabled = async (p: ApiProvider, next: boolean) => {
    setProviders((prev) => prev.map((x) => (x.id === p.id ? { ...x, enabled: next } : x)));
    await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: p.id,
        name: p.name,
        slug: p.slug,
        plugin: p.plugin,
        baseUrl: p.baseUrl || "",
        apiKeySecret: p.apiKeySecret || "",
        audioFormat: p.audioFormat || "",
        models: p.models,
        voices: p.voices,
        enabled: next,
      }),
    }).catch(() => {});
    fetchProviders();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await fetch("/api/providers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deleteTarget.id }),
    });
    setDeleteTarget(null);
    fetchProviders();
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Providers" breadcrumb={[{ label: "Settings", href: "/settings/project" }]} />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Providers"
        breadcrumb={[{ label: "Settings", href: "/settings/project" }]}
        actions={
          canManage ? (
            <Button size="sm" onClick={openAdd}>
              <Plus className="size-4" />
              Add provider
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Model providers</h2>
          <p className="text-sm text-muted-foreground">
            Inference endpoints available to your agents. Point a provider at any OpenAI-compatible server (vLLM,
            Ollama, LiteLLM, Together, OpenRouter, …) and its models appear in the{" "}
            <Link href="/agents/builder?setting=models" className="text-primary hover:underline">
              agent builder
            </Link>
            . API keys come from{" "}
            <Link href="/settings/secrets" className="text-primary hover:underline">
              Secrets
            </Link>
            .
          </p>
        </div>

        {providers.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center text-center p-10 space-y-4">
              <div className="flex items-center justify-center size-16 rounded-full border bg-card">
                <Server className="size-7 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No providers</h3>
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                Add a provider to give the agent builder a model list. Without one, the Models &amp; Voice tab has
                nothing to offer.
              </p>
              {canManage && (
                <Button onClick={openAdd}>
                  <Plus className="size-4" />
                  Add provider
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Provider</th>
                    <th className="px-4 py-2.5 font-medium">Plugin</th>
                    <th className="px-4 py-2.5 font-medium">Endpoint</th>
                    <th className="px-4 py-2.5 font-medium">API key</th>
                    <th className="px-4 py-2.5 font-medium">Models</th>
                    <th className="px-4 py-2.5 font-medium">Enabled</th>
                    <th className="px-4 py-2.5 font-medium w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p) => {
                    const counts = MODEL_KINDS.map((k) => ({
                      kind: k,
                      n: p.models.filter((m) => m.kind === k.id).length,
                    })).filter((c) => c.n > 0);
                    return (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{p.name}</span>
                            {p.builtin && (
                              <Badge variant="secondary" className="text-[10px]">
                                Built-in
                              </Badge>
                            )}
                          </div>
                          <span className="font-mono text-xs text-muted-foreground">{p.slug}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline">{pluginLabel[p.plugin] || p.plugin}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs break-all max-w-[220px]">
                          {p.baseUrl || "plugin default"}
                        </td>
                        <td className="px-4 py-2.5">
                          {p.apiKeySecret ? (
                            <span className="flex items-center gap-1.5 font-mono text-xs">
                              {p.apiKeySecret}
                              {p.secretMissing && (
                                <span
                                  className="text-yellow-500"
                                  title="No secret or environment variable with this name"
                                >
                                  <AlertTriangle className="size-3.5" />
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">plugin default</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {counts.length === 0 ? (
                              <span className="text-muted-foreground text-xs">none</span>
                            ) : (
                              counts.map((c) => (
                                <Badge key={c.kind.id} variant="secondary" className="text-[10px]">
                                  {c.n} {c.kind.label}
                                </Badge>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <Switch
                            checked={p.enabled}
                            disabled={!canManage}
                            onCheckedChange={(v) => toggleEnabled(p, !!v)}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          {canManage && (
                            <div className="flex items-center gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => openEdit(p)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteTarget(p)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {canManage && dialogTarget && (
        <ProviderDialog
          key={providerParam}
          provider={dialogTarget === "new" ? null : dialogTarget}
          secretNames={secretNames}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            fetchProviders();
          }}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete provider</DialogTitle>
            <DialogDescription>
              Delete <span className="font-medium">{deleteTarget?.name}</span>? Its models disappear from the agent
              builder. Agents already configured with them keep the saved value until you pick a new model.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
