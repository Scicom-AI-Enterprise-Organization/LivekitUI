"use client";

import { useMemo, useState } from "react";
import { Check, Copy, KeyRound, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ENDPOINTS, GROUPS, type Endpoint, type Method } from "./endpoints";

function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("opacity-50 hover:opacity-100", className)}
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={copied ? "Copied" : "Copy"}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  );
}

function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="relative rounded-md border bg-muted/50 p-3">
      {label && (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      )}
      <pre className="overflow-x-auto pr-8 font-mono text-xs leading-relaxed text-foreground/90">
        {children}
      </pre>
      <CopyBtn text={children} className="absolute right-1.5 top-1.5" />
    </div>
  );
}

const METHOD_COLOURS: Record<Method, string> = {
  GET: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  POST: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  PUT: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  PATCH: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  DELETE: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
};

function MethodBadge({ method, size = "sm" }: { method: Method; size?: "sm" | "xs" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded font-mono font-semibold tracking-wider",
        size === "xs" ? "h-4 px-1 text-[9px]" : "h-5 px-1.5 text-[10px]",
        METHOD_COLOURS[method]
      )}
    >
      {method}
    </span>
  );
}

function RoleBadge({ role }: { role?: Endpoint["role"] }) {
  if (!role) return null;
  const isPublic = role === "public";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        isPublic
          ? "border-muted-foreground/30 text-muted-foreground"
          : "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-300"
      )}
    >
      {isPublic ? "no auth required" : "owner / admin only"}
    </span>
  );
}

function EndpointSection({ endpoint }: { endpoint: Endpoint }) {
  return (
    <section id={endpoint.id} className="scroll-mt-6 border-b pb-8 last:border-0">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <MethodBadge method={endpoint.method} />
            <code className="font-mono text-sm text-foreground">{endpoint.path}</code>
            <RoleBadge role={endpoint.role} />
          </div>
          <h3 className="text-base font-semibold">{endpoint.title}</h3>
          <p className="text-sm text-muted-foreground">{endpoint.description}</p>

          {endpoint.params && endpoint.params.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Parameters
              </p>
              <div className="space-y-2">
                {endpoint.params.map((p) => (
                  <div key={p.name} className="text-sm">
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <code className="font-mono text-xs font-medium text-foreground">{p.name}</code>
                      <span className="text-xs text-muted-foreground">{p.type}</span>
                      <span className="text-[10px] uppercase text-muted-foreground/70">{p.in}</span>
                      {p.required && <span className="text-[10px] text-destructive">required</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{p.doc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {endpoint.request && <CodeBlock label="Request">{endpoint.request}</CodeBlock>}
          {endpoint.response && <CodeBlock label="Response 200">{endpoint.response}</CodeBlock>}
        </div>
      </div>
    </section>
  );
}

export function ApiDocs({ baseUrl }: { baseUrl: string }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ENDPOINTS;
    return ENDPOINTS.filter(
      (e) =>
        e.path.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.method.toLowerCase() === q
    );
  }, [query]);

  const grouped = useMemo(
    () => GROUPS.map((g) => ({ group: g, items: filtered.filter((e) => e.group === g.id) })).filter((x) => x.items.length),
    [filtered]
  );

  const setupSample = `# 1. Create a token in Settings > Access tokens, then:
export BASE=${baseUrl}
export TOKEN=lkui_your_token_here

# 2. Every endpoint takes it as a Bearer header
curl $BASE/api/auth/me -H "Authorization: Bearer $TOKEN"`;

  return (
    <div className="flex h-full">
      {/* Endpoint nav */}
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r p-4 lg:block">
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search endpoints"
            className="h-8 pl-8 text-xs"
          />
        </div>

        {grouped.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">No endpoint matches “{query}”.</p>
        )}

        <nav className="space-y-4">
          {grouped.map(({ group, items }) => (
            <div key={group.id}>
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </p>
              <ul className="space-y-0.5">
                {items.map((e) => (
                  <li key={e.id}>
                    <a
                      href={`#${e.id}`}
                      className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <MethodBadge method={e.method} size="xs" />
                      <span className="truncate">{e.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Reference */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-10 p-6">
          <header className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold">API reference</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Every dashboard feature is reachable over REST. {ENDPOINTS.length} endpoints, all
                accepting either the browser session cookie or a Bearer token.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Authentication</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Create a token under{" "}
                  <a href="/settings/access-tokens" className="text-primary hover:underline">
                    Settings → Access tokens
                  </a>
                  . A token carries the role of whoever created it, and revoking one takes effect on
                  its next request. Endpoints marked <em>owner / admin only</em> reject members with
                  403; unauthenticated calls get a JSON 401.
                </p>
                <p className="text-sm text-muted-foreground">
                  These are separate from the LiveKit keys under Settings → API keys: a token here
                  calls this dashboard, a LiveKit key connects to the media server.
                </p>
              </div>
              <CodeBlock label="Getting started">{setupSample}</CodeBlock>
            </div>
          </header>

          {grouped.map(({ group, items }) => (
            <div key={group.id} className="space-y-6">
              <div className="border-b pb-3">
                <h2 className="text-lg font-semibold">{group.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{group.blurb}</p>
              </div>
              <div className="space-y-8">
                {items.map((e) => (
                  <EndpointSection key={e.id} endpoint={e} />
                ))}
              </div>
            </div>
          ))}

          {grouped.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing matches “{query}”. Clear the search to see all {ENDPOINTS.length} endpoints.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
