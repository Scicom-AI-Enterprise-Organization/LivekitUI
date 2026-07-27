"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Loader2, Play, Plug, ShieldCheck } from "lucide-react";
import { isValidToolName, type HttpTool, type McpServer, type ToolKind, type ToolParam } from "@/lib/tools";

/**
 * Trying a tool out before it goes in the library.
 *
 * An HTTP tool is actually called and an MCP server is actually connected to —
 * the point is to find a wrong URL, a missing header or a bad parameter here
 * rather than mid-call. A client tool has nothing to call from the dashboard,
 * so it is checked instead: the definition is validated and the contract the
 * frontend has to implement is spelled out.
 */

interface HttpTestResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  durationMs: number;
  contentType?: string | null;
  requestUrl: string;
  truncated?: boolean;
  body?: string;
  error?: string;
}

interface McpTestResult {
  ok: boolean;
  durationMs: number;
  transport?: string;
  protocolVersion?: string | null;
  server?: string | null;
  tools?: { name: string; description: string }[];
  error?: string;
}

function pretty(body: string, contentType?: string | null): string {
  if (contentType && !contentType.includes("json")) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** What a client tool's definition has to get right to be callable at all. */
function checkClientTool(name: string, params: ToolParam[]): string[] {
  const problems: string[] = [];
  if (!isValidToolName(name.trim())) {
    problems.push("The name must start with a letter or underscore and contain no spaces.");
  }
  const seen = new Set<string>();
  for (const p of params) {
    if (!p.name.trim()) {
      problems.push("Every parameter needs a name.");
      continue;
    }
    if (!isValidToolName(p.name.trim())) {
      problems.push(`"${p.name}" is not a usable parameter name.`);
    }
    if (seen.has(p.name.trim())) {
      problems.push(`"${p.name}" is listed twice.`);
    }
    seen.add(p.name.trim());
    if (!p.description.trim()) {
      problems.push(`"${p.name}" has no description — the model uses it to decide what to pass.`);
    }
  }
  return problems;
}

export function ToolTestPanel({
  kind,
  name,
  config,
}: {
  kind: ToolKind;
  name: string;
  config: HttpTool | McpServer;
}) {
  const [args, setArgs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [http, setHttp] = useState<HttpTestResult | null>(null);
  const [mcp, setMcp] = useState<McpTestResult | null>(null);
  const [checked, setChecked] = useState<string[] | null>(null);

  const params = (config as HttpTool).params ?? [];

  const run = async () => {
    setRunning(true);
    setError(null);
    setHttp(null);
    setMcp(null);
    try {
      const res = await fetch("/api/tools/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, config, args }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Test failed (HTTP ${res.status})`);
        return;
      }
      if (kind === "http") setHttp(data as HttpTestResult);
      else setMcp(data as McpTestResult);
    } catch {
      setError("Could not reach the dashboard API");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-sm font-medium text-foreground">Test</div>
          <p className="text-xs text-muted-foreground">
            {kind === "http"
              ? "Sends the request exactly as the agent will — same method, headers and parameter placement."
              : kind === "mcp"
                ? "Connects to the server and lists what it exposes. Every tool listed becomes available to the agent."
                : "A client tool runs in your frontend, so there is nothing to call from here. This checks the definition and shows what the frontend must implement."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={running}
          onClick={() => {
            if (kind === "client") {
              setChecked(checkClientTool(name, params));
              return;
            }
            void run();
          }}
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : kind === "mcp" ? (
            <Plug className="size-3.5" />
          ) : kind === "client" ? (
            <ShieldCheck className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
          {kind === "http" ? "Send request" : kind === "mcp" ? "Connect" : "Check definition"}
        </Button>
      </div>

      {/* HTTP: sample arguments, one per parameter */}
      {kind === "http" && params.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {params.map((p) => (
            <div key={p.name} className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {p.name}
                {p.required && <span className="ml-1 text-destructive">*</span>}
                <span className="ml-1.5 font-normal text-muted-foreground/70">{p.type}</span>
              </Label>
              <Input
                value={args[p.name] ?? ""}
                onChange={(e) => setArgs((prev) => ({ ...prev, [p.name]: e.target.value }))}
                placeholder={p.description || p.type}
                className="h-8 font-mono text-xs"
                type={p.type === "number" || p.type === "integer" ? "number" : "text"}
              />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* HTTP result */}
      {http && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "font-mono text-[10px]",
                http.ok ? "border-emerald-500/40 text-emerald-500" : "border-destructive/40 text-destructive"
              )}
            >
              {http.status ? `HTTP ${http.status} ${http.statusText ?? ""}`.trim() : "no response"}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground">{http.durationMs} ms</span>
            {http.contentType && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {http.contentType.split(";")[0]}
              </span>
            )}
          </div>
          <div className="break-all font-mono text-[10px] text-muted-foreground">{http.requestUrl}</div>
          {http.error ? (
            <p className="text-xs text-destructive">{http.error}</p>
          ) : (
            <pre className="max-h-56 overflow-auto rounded-md border bg-background p-2 font-mono text-[11px] leading-relaxed text-foreground/80">
              {pretty(http.body ?? "", http.contentType)}
              {http.truncated && "\n… truncated"}
            </pre>
          )}
          {http.ok && (
            <p className="text-xs text-muted-foreground">
              This is what the agent receives as the tool result.
            </p>
          )}
        </div>
      )}

      {/* MCP result */}
      {mcp && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "font-mono text-[10px]",
                mcp.ok ? "border-emerald-500/40 text-emerald-500" : "border-destructive/40 text-destructive"
              )}
            >
              {mcp.ok ? `${mcp.tools?.length ?? 0} tools` : "no connection"}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground">{mcp.durationMs} ms</span>
            {mcp.server && (
              <span className="font-mono text-[10px] text-muted-foreground">{mcp.server}</span>
            )}
            {mcp.transport && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {mcp.transport}
                {mcp.protocolVersion ? ` · ${mcp.protocolVersion}` : ""}
              </span>
            )}
          </div>
          {mcp.error ? (
            <p className="text-xs text-destructive">{mcp.error}</p>
          ) : mcp.tools && mcp.tools.length > 0 ? (
            <div className="max-h-56 space-y-1 overflow-auto rounded-md border bg-background p-2">
              {mcp.tools.map((t) => (
                <div key={t.name} className="text-xs">
                  <span className="font-mono text-foreground">{t.name}</span>
                  {t.description && (
                    <span className="ml-2 text-muted-foreground">{t.description}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-yellow-500">
              The server answered but exposes no tools, so the agent would gain nothing from it.
            </p>
          )}
        </div>
      )}

      {/* Client tool check */}
      {kind === "client" && checked && (
        <div className="space-y-2">
          {checked.length > 0 ? (
            <ul className="space-y-1">
              {checked.map((problem, i) => (
                <li key={i} className="text-xs text-yellow-600 dark:text-yellow-500">
                  {problem}
                </li>
              ))}
            </ul>
          ) : (
            <Badge variant="outline" className="border-emerald-500/40 font-mono text-[10px] text-emerald-500">
              definition looks callable
            </Badge>
          )}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Your frontend must answer this RPC while in the session:
            </p>
            <pre className="overflow-auto rounded-md border bg-background p-2 font-mono text-[11px] leading-relaxed text-foreground/80">
              {`room.localParticipant.registerRpcMethod(
  "${name || "tool_name"}",
  async ({ payload }) => {
    const { ${params.map((p) => p.name).filter(Boolean).join(", ") || "/* no parameters */"} } = JSON.parse(payload);
    // …do the work, return a string the agent can read
    return "done";
  },
);`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
