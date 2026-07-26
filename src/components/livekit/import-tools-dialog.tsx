"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
import { TOOL_KINDS, type LibraryTool, type ToolKind } from "@/lib/tools";

/**
 * Picks entries out of the Tools library and hands back copies.
 *
 * Copies, not references: the agent stores the tool in its own config, so
 * editing or deleting the library entry later can't break a running agent.
 */
export function ImportToolsDialog<T>({
  kind,
  existingNames,
  onImport,
  onClose,
}: {
  kind: ToolKind;
  /** Names already on the agent — those are shown as added and can't be picked twice. */
  existingNames: string[];
  onImport: (configs: T[]) => void;
  onClose: () => void;
}) {
  const [tools, setTools] = useState<LibraryTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch(`/api/tools?kind=${kind}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load the library");
        setTools(data.tools || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [kind]);

  const label = TOOL_KINDS.find((k) => k.kind === kind)!.label.toLowerCase();

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const importSelected = () => {
    const picked = tools.filter((t) => selected.has(t.id));
    // Deep copy so later edits to the agent don't mutate the fetched objects.
    onImport(picked.map((t) => JSON.parse(JSON.stringify(t.config)) as T));
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from library</DialogTitle>
          <DialogDescription>
            Adds a copy of each selected entry to this agent. Later changes in the library will not
            affect the copy.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : tools.length === 0 ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">No {label} in the library yet.</p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/agents/tools">Open the Tools page</Link>
            </Button>
          </div>
        ) : (
          <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {tools.map((tool) => {
              const already = existingNames.includes(tool.name);
              const isSelected = selected.has(tool.id);
              const cfg = tool.config as { url?: string; method?: string };
              return (
                <button
                  key={tool.id}
                  disabled={already}
                  onClick={() => toggle(tool.id)}
                  className={[
                    "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors",
                    already ? "opacity-50" : "hover:bg-accent/50",
                    isSelected ? "bg-accent/60" : "",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{tool.name}</span>
                      {cfg.method && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {cfg.method}
                        </Badge>
                      )}
                      {already && <span className="text-[10px] text-muted-foreground">already added</span>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {tool.description || cfg.url || "—"}
                    </p>
                  </div>
                  {isSelected && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={importSelected} disabled={selected.size === 0}>
            Import {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
