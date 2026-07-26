"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileJson, Loader2, Plus, Sparkles, Trash2, Pencil, X } from "lucide-react";
import { ListError, ListLoading } from "@/components/livekit/list-state";
import { OpenApiDialog } from "./openapi-dialog";
import {
  TOOL_KINDS,
  emptyToolConfig,
  exampleTool,
  isValidToolName,
  type ClientTool,
  type HttpTool,
  type LibraryTool,
  type McpServer,
  type ToolKind,
  type ToolParam,
} from "@/lib/tools";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const PARAM_TYPES = ["string", "number", "boolean", "object", "array"];

type AnyConfig = HttpTool & ClientTool & McpServer;

/** Editable rows of name/value pairs — used for headers. */
function PairRows({
  rows,
  onChange,
  nameLabel = "Header",
  valueLabel = "Value",
}: {
  rows: { name: string; value: string }[];
  onChange: (rows: { name: string; value: string }[]) => void;
  nameLabel?: string;
  valueLabel?: string;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={row.name}
            placeholder={nameLabel}
            className="text-sm"
            onChange={(e) =>
              onChange(rows.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))
            }
          />
          <Input
            value={row.value}
            placeholder={valueLabel}
            className="text-sm"
            onChange={(e) =>
              onChange(rows.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            aria-label="Remove row"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="gap-1 text-xs"
        onClick={() => onChange([...rows, { name: "", value: "" }])}
      >
        <Plus className="size-3" />
        Add {nameLabel.toLowerCase()}
      </Button>
    </div>
  );
}

function ParamRows({
  params,
  onChange,
}: {
  params: ToolParam[];
  onChange: (params: ToolParam[]) => void;
}) {
  const update = (i: number, patch: Partial<ToolParam>) =>
    onChange(params.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  return (
    <div className="space-y-3">
      {params.map((p, i) => (
        <div key={i} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Input
              value={p.name}
              placeholder="parameter_name"
              className="text-sm font-mono"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <Select value={p.type} onValueChange={(v) => update(i, { type: v })}>
              <SelectTrigger size="sm" className="w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARAM_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onChange(params.filter((_, idx) => idx !== i))}
              aria-label="Remove parameter"
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <Input
            value={p.description}
            placeholder="What this parameter is for — the model reads this"
            className="text-sm"
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={p.required}
              onChange={(e) => update(i, { required: e.target.checked })}
              className="size-3.5 accent-primary"
            />
            Required
          </label>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="gap-1 text-xs"
        onClick={() => onChange([...params, { name: "", type: "string", description: "", required: false }])}
      >
        <Plus className="size-3" />
        Add parameter
      </Button>
    </div>
  );
}

function ToolDialog({
  kind,
  existing,
  onClose,
  onSaved,
}: {
  kind: ToolKind;
  existing: LibraryTool | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [config, setConfig] = useState<AnyConfig>(
    () => ({ ...emptyToolConfig(kind), ...(existing?.config ?? {}) }) as AnyConfig
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<AnyConfig>) => setConfig((prev) => ({ ...prev, ...p }));

  /** Fills the form with a working example so a new tool can be tried at once. */
  const fillExample = () => {
    const sample = exampleTool(kind);
    setName(sample.name);
    setDescription(sample.description);
    setConfig(sample.config as AnyConfig);
    setError(null);
  };

  const save = async () => {
    setError(null);
    if (!isValidToolName(name.trim())) {
      setError("Name must start with a letter or underscore and contain no spaces.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name: name.trim(), description, config }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save the tool");
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const kindLabel = TOOL_KINDS.find((k) => k.kind === kind)!.label.replace(/s$/, "");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <DialogTitle>
                {existing ? "Edit" : "New"} {kindLabel.toLowerCase()}
              </DialogTitle>
              <DialogDescription>
                Saved to the library so any agent can import it. Agents keep their own copy, so
                editing this later will not change agents that already use it.
              </DialogDescription>
            </div>
            {!existing && (
              <Button
                variant="outline"
                size="sm"
                // mr-6 clears DialogContent's own close button, which is
                // absolutely positioned at top-4 right-4.
                className="mr-6 shrink-0 gap-1.5 text-xs"
                onClick={fillExample}
              >
                <Sparkles className="size-3" />
                Example
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "mcp" ? "my_mcp_server" : "get_weather"}
              className="font-mono text-sm"
              disabled={!!existing}
            />
            {existing && (
              <p className="text-xs text-muted-foreground">
                The name identifies the entry and cannot be changed. Delete and recreate to rename.
              </p>
            )}
          </div>

          {kind !== "mcp" && (
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="When the model should reach for this tool"
                className="text-sm"
              />
            </div>
          )}

          {kind === "http" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Endpoint</Label>
                <div className="flex items-center gap-2">
                  <Select value={config.method} onValueChange={(v) => patch({ method: v })}>
                    <SelectTrigger size="sm" className="w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={config.url}
                    onChange={(e) => patch({ url: e.target.value })}
                    placeholder="https://api.example.com/weather"
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Parameters</Label>
                <ParamRows params={config.params ?? []} onChange={(params) => patch({ params })} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Headers</Label>
                <PairRows rows={config.headers ?? []} onChange={(headers) => patch({ headers })} />
              </div>
            </>
          )}

          {kind === "client" && (
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Parameters</Label>
              <ParamRows params={config.params ?? []} onChange={(params) => patch({ params })} />
            </div>
          )}

          {kind === "mcp" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Server URL</Label>
                <Input
                  value={config.url}
                  onChange={(e) => patch({ url: e.target.value })}
                  placeholder="https://mcp.example.com/sse"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Headers</Label>
                <PairRows rows={config.headers ?? []} onChange={(headers) => patch({ headers })} />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save tool
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToolsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tools, setTools] = useState<LibraryTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * The open dialog lives in the URL, so a form can be linked or bookmarked:
   *   ?kind=http&tool=new          the new-HTTP-tool form
   *   ?kind=http&tool=get_weather  that tool's edit form
   *   ?import=openapi              the OpenAPI importer
   */
  const kindParam = searchParams.get("kind") as ToolKind | null;
  const toolParam = searchParams.get("tool");
  const importParam = searchParams.get("import");

  const setQuery = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs ? `/agents/tools?${qs}` : "/agents/tools", { scroll: false });
    },
    [router, searchParams]
  );

  const openNew = (kind: ToolKind) => setQuery({ kind, tool: "new", import: null });
  const openEdit = (tool: LibraryTool) => setQuery({ kind: tool.kind, tool: tool.name, import: null });
  const closeDialog = () => setQuery({ kind: null, tool: null, import: null });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tools");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not load tools");
        return;
      }
      setTools(data.tools || []);
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

  const remove = async (tool: LibraryTool) => {
    const res = await fetch(`/api/tools/${tool.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not delete the tool");
      return;
    }
    await load();
  };

  // Resolve the URL into a dialog. An unknown ?tool= name simply opens nothing,
  // which is the right outcome for a stale link.
  const validKind = TOOL_KINDS.some((k) => k.kind === kindParam) ? kindParam! : null;
  const editingTool =
    validKind && toolParam && toolParam !== "new"
      ? tools.find((t) => t.kind === validKind && t.name === toolParam) ?? null
      : null;
  const dialogOpen = !!validKind && (toolParam === "new" || !!editingTool);

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Tools"
        breadcrumb={[{ label: "Agents", href: "/agents" }]}
        actions={
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setQuery({ import: "openapi", kind: null, tool: null })}>
            <FileJson className="size-3" />
            Import from OpenAPI
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Tool library</h2>
          <p className="text-sm text-muted-foreground">
            Define a tool once and import it into any agent from the builder&apos;s{" "}
            <span className="text-foreground">Actions</span> tab. Agents take their own copy, so an
            agent keeps working even if the entry here changes.
          </p>
        </div>

        {error && <ListError message={error} />}

        {loading ? (
          <ListLoading />
        ) : (
          TOOL_KINDS.map(({ kind, label, blurb }) => {
            const items = tools.filter((t) => t.kind === kind);
            return (
              <Card key={kind}>
                <CardContent className="space-y-4 pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold">{label}</h3>
                      <p className="text-xs text-muted-foreground">{blurb}</p>
                    </div>
                    <Button size="sm" className="gap-1 shrink-0" onClick={() => openNew(kind)}>
                      <Plus className="size-3.5" />
                      Add
                    </Button>
                  </div>

                  {items.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No {label.toLowerCase()} yet.
                    </p>
                  ) : (
                    <div className="divide-y rounded-lg border">
                      {items.map((tool) => {
                        const cfg = tool.config as Partial<AnyConfig>;
                        return (
                          <div key={tool.id} className="flex items-center justify-between gap-4 px-3 py-2.5">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm">{tool.name}</span>
                                {kind === "http" && cfg.method && (
                                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                    {cfg.method}
                                  </Badge>
                                )}
                                {kind !== "mcp" && cfg.params?.length ? (
                                  <span className="text-xs text-muted-foreground">
                                    {cfg.params.length} param{cfg.params.length === 1 ? "" : "s"}
                                  </span>
                                ) : null}
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                {tool.description || cfg.url || "—"}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                                onClick={() => openEdit(tool)}
                                aria-label={`Edit ${tool.name}`}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => remove(tool)}
                                aria-label={`Delete ${tool.name}`}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {dialogOpen && (
        <ToolDialog
          // Remount when the target changes so the form resets cleanly.
          key={`${validKind}:${toolParam}`}
          kind={validKind!}
          existing={editingTool}
          onClose={closeDialog}
          onSaved={load}
        />
      )}

      {importParam === "openapi" && (
        <OpenApiDialog onClose={closeDialog} onImported={load} />
      )}
    </div>
  );
}

// useSearchParams needs a Suspense boundary or the build fails.
export default function ToolsPage() {
  return (
    <Suspense fallback={<ListLoading />}>
      <ToolsPageInner />
    </Suspense>
  );
}
