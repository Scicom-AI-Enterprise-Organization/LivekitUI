"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Loader2 } from "lucide-react";
import type { HttpTool } from "@/lib/tools";

interface ParsedSpec {
  title: string;
  version: string;
  baseUrl: string;
  tools: HttpTool[];
  skipped: { operation: string; reason: string }[];
}

const SAMPLE_SPEC_URL = "https://petstore3.swagger.io/api/v3/openapi.json";

/**
 * Reads an OpenAPI document and turns its operations into HTTP tools. Parsing
 * happens server-side so specs on hosts without CORS headers still work.
 */
export function OpenApiDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [mode, setMode] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("");
  const [spec, setSpec] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSpec | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const parse = async () => {
    setError(null);
    setParsing(true);
    setParsed(null);
    try {
      const res = await fetch("/api/tools/openapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "url" ? { url } : { spec }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not read the spec");
        return;
      }
      setParsed(data);
      // Everything is selected by default — deselecting a few is the common case.
      setSelected(new Set(data.tools.map((t: HttpTool) => t.name)));
    } catch {
      setError("Could not reach the dashboard API");
    } finally {
      setParsing(false);
    }
  };

  const importSelected = async () => {
    if (!parsed) return;
    setSaving(true);
    setError(null);
    const chosen = parsed.tools.filter((t) => selected.has(t.name));
    const failures: string[] = [];

    for (const tool of chosen) {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "http",
          name: tool.name,
          description: tool.description,
          config: tool,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        failures.push(`${tool.name}: ${data.error || res.status}`);
      }
    }

    setSaving(false);
    if (failures.length) {
      setError(`${failures.length} of ${chosen.length} could not be saved — ${failures[0]}`);
      onImported();
      return;
    }
    onImported();
    onClose();
  };

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const allSelected = !!parsed && selected.size === parsed.tools.length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from OpenAPI</DialogTitle>
          <DialogDescription>
            Every operation becomes an HTTP tool: path and query parameters and top-level request
            body fields turn into tool parameters, and header parameters become headers for you to
            fill in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex gap-1 rounded-lg border p-1 w-fit">
            {(["url", "paste"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={[
                  "rounded-md px-3 py-1 text-xs transition-colors",
                  mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {m === "url" ? "From URL" : "Paste spec"}
              </button>
            ))}
          </div>

          {mode === "url" ? (
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Spec URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com/openapi.json"
                className="font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && url.trim() && !parsing) parse();
                }}
              />
              <button
                onClick={() => setUrl(SAMPLE_SPEC_URL)}
                className="text-xs text-primary hover:underline"
              >
                Use the Swagger Petstore spec
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Spec (JSON or YAML)</Label>
              <textarea
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                rows={8}
                placeholder={"openapi: 3.0.0\ninfo:\n  title: My API\npaths:\n  /things:\n    get: …"}
                className="w-full resize-y rounded-lg border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-primary"
              />
            </div>
          )}

          <Button
            onClick={parse}
            disabled={parsing || (mode === "url" ? !url.trim() : !spec.trim())}
            size="sm"
          >
            {parsing && <Loader2 className="size-4 animate-spin" />}
            Read spec
          </Button>

          {parsed && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {parsed.title}
                    {parsed.version && (
                      <span className="ml-1.5 text-xs text-muted-foreground">v{parsed.version}</span>
                    )}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {parsed.baseUrl || "no server URL in the spec — set it per tool after importing"}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setSelected(allSelected ? new Set() : new Set(parsed.tools.map((t) => t.name)))
                  }
                  className="text-xs text-primary hover:underline"
                >
                  {allSelected ? "Deselect all" : `Select all ${parsed.tools.length}`}
                </button>
              </div>

              <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                {parsed.tools.map((tool) => {
                  const isSelected = selected.has(tool.name);
                  return (
                    <button
                      key={tool.name}
                      onClick={() => toggle(tool.name)}
                      className={[
                        "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/50",
                        isSelected ? "bg-accent/60" : "",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                            {tool.method}
                          </Badge>
                          <span className="truncate font-mono text-xs">{tool.name}</span>
                          {tool.params.length > 0 && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {tool.params.length} param{tool.params.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
                      </div>
                      {isSelected && <Check className="size-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>

              {parsed.skipped.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Skipped {parsed.skipped.length}: {parsed.skipped.slice(0, 3).map((s) => `${s.operation} (${s.reason})`).join(", ")}
                  {parsed.skipped.length > 3 ? "…" : ""}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={importSelected} disabled={!parsed || selected.size === 0 || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Import {selected.size > 0 ? `${selected.size} tool${selected.size === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
