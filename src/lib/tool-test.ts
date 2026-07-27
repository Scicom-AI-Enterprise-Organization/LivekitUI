/**
 * Trying a tool definition out before it is saved.
 *
 * Kept out of the route so the request-building rules can be exercised
 * directly: an HTTP tool has to be sent exactly the way the generated agent
 * sends it, or a green test would mean nothing.
 */

import type { HttpTool, McpServer, ToolParam } from "./tools";

/** Long enough for a slow API, short enough that the dialog stays responsive. */
export const TOOL_TEST_TIMEOUT_MS = 10_000;
/** Responses are for eyeballing, not archiving. */
const MAX_BODY_CHARS = 8_000;

export interface HttpTestResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  durationMs: number;
  contentType?: string | null;
  requestUrl: string;
  sentBody?: Record<string, unknown> | null;
  truncated?: boolean;
  body?: string;
  error?: string;
}

export interface McpTestResult {
  ok: boolean;
  durationMs: number;
  transport?: "streamable-http" | "http+sse";
  protocolVersion?: string | null;
  server?: string | null;
  tools?: { name: string; description: string }[];
  error?: string;
}

/** Raised for input the caller should fix, rather than a failed attempt. */
export class ToolTestInputError extends Error {}

/** Only http(s) — anything else would be a request the agent could never make. */
function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function coerce(param: ToolParam | undefined, value: unknown): unknown {
  if (value === "" || value === undefined || value === null) return undefined;
  switch (param?.type) {
    case "number":
    case "integer": {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case "boolean":
      return value === true || value === "true";
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------
// HTTP tools
// ---------------------------------------------------------------------------

export async function runHttpToolTest(
  config: HttpTool,
  rawArgs: Record<string, unknown>
): Promise<HttpTestResult> {
  if (!config?.url?.trim()) {
    throw new ToolTestInputError("Set an endpoint URL first");
  }
  const url = parseUrl(config.url.trim());
  if (!url) {
    throw new ToolTestInputError("The endpoint must be an absolute http:// or https:// URL");
  }

  const method = (config.method || "GET").toUpperCase();
  const params = config.params ?? [];

  const missing = params
    .filter((p) => p.required)
    .map((p) => p.name)
    .filter((name) => {
      const value = rawArgs[name];
      return value === undefined || value === null || value === "";
    });
  if (missing.length > 0) {
    throw new ToolTestInputError(`Fill the required parameters first: ${missing.join(", ")}`);
  }

  // The agent drops null arguments before sending, so the test does too.
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawArgs)) {
    const coerced = coerce(params.find((p) => p.name === key), value);
    if (coerced !== undefined) payload[key] = coerced;
  }

  const headers: Record<string, string> = {};
  for (const h of config.headers ?? []) {
    if (h.name.trim()) headers[h.name.trim()] = h.value;
  }

  const sendsBody = method !== "GET" && method !== "DELETE";
  if (sendsBody && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }
  if (!sendsBody) {
    for (const [key, value] of Object.entries(payload)) {
      url.searchParams.set(key, String(value));
    }
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: sendsBody ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(TOOL_TEST_TIMEOUT_MS),
      redirect: "follow",
    });

    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      durationMs: Date.now() - startedAt,
      contentType: res.headers.get("content-type"),
      requestUrl: url.toString(),
      sentBody: sendsBody ? payload : null,
      truncated: text.length > MAX_BODY_CHARS,
      body: text.slice(0, MAX_BODY_CHARS),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      requestUrl: url.toString(),
      error: timedOut ? `No response within ${TOOL_TEST_TIMEOUT_MS / 1000}s` : message,
    };
  }
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
  id?: number | string;
  result?: { tools?: { name: string; description?: string }[]; serverInfo?: { name?: string; version?: string }; protocolVersion?: string };
  error?: { message?: string };
}

const MCP_CLIENT_INFO = { name: "livekit-dashboard", version: "1.0" };
const MCP_PROTOCOL = "2024-11-05";

/**
 * Lists what a server exposes, which is the only test that means anything for
 * MCP: the agent gets every tool the server advertises.
 *
 * Two transports are in the wild — Streamable HTTP (one POST, JSON or SSE back)
 * and the older HTTP+SSE pair (GET opens a stream that names a POST endpoint).
 * A `/sse` URL is the latter by convention; anything else is tried as the former
 * and falls back.
 */
export async function runMcpServerTest(config: McpServer): Promise<McpTestResult> {
  if (!config?.url?.trim()) {
    throw new ToolTestInputError("Set the server URL first");
  }
  const url = parseUrl(config.url.trim());
  if (!url) {
    throw new ToolTestInputError("The server URL must be an absolute http:// or https:// URL");
  }

  const headers: Record<string, string> = {};
  for (const h of config.headers ?? []) {
    if (h.name.trim()) headers[h.name.trim()] = h.value;
  }

  const startedAt = Date.now();
  const sseFirst = url.pathname.endsWith("/sse");

  try {
    const result = sseFirst
      ? await mcpOverSse(url, headers)
      : await mcpOverStreamableHttp(url, headers).catch(() => mcpOverSse(url, headers));

    return {
      ok: true,
      durationMs: Date.now() - startedAt,
      transport: result.transport,
      protocolVersion: result.protocolVersion ?? null,
      server: result.serverName ?? null,
      tools: result.tools,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, durationMs: Date.now() - startedAt, error: message };
  }
}

interface McpProbe {
  transport: "streamable-http" | "http+sse";
  protocolVersion?: string;
  serverName?: string;
  tools: { name: string; description: string }[];
}

/** Reads a JSON-RPC reply out of either a JSON body or an SSE frame. */
async function readRpc(res: Response): Promise<JsonRpcResponse> {
  const text = await res.text();
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        try {
          return JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
        } catch {}
      }
    }
    throw new Error("The server's event stream carried no JSON-RPC reply");
  }
  return JSON.parse(text) as JsonRpcResponse;
}

async function mcpOverStreamableHttp(url: URL, headers: Record<string, string>): Promise<McpProbe> {
  const base = {
    ...headers,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  const initRes = await fetch(url, {
    method: "POST",
    headers: base,
    signal: AbortSignal.timeout(TOOL_TEST_TIMEOUT_MS),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: MCP_CLIENT_INFO },
    }),
  });
  if (!initRes.ok) throw new Error(`initialize failed — HTTP ${initRes.status}`);

  const session = initRes.headers.get("mcp-session-id");
  const init = await readRpc(initRes);
  if (init.error) throw new Error(init.error.message || "initialize was rejected");

  const withSession = session ? { ...base, "Mcp-Session-Id": session } : base;

  await fetch(url, {
    method: "POST",
    headers: withSession,
    signal: AbortSignal.timeout(TOOL_TEST_TIMEOUT_MS),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => {});

  const listRes = await fetch(url, {
    method: "POST",
    headers: withSession,
    signal: AbortSignal.timeout(TOOL_TEST_TIMEOUT_MS),
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  if (!listRes.ok) throw new Error(`tools/list failed — HTTP ${listRes.status}`);

  const list = await readRpc(listRes);
  if (list.error) throw new Error(list.error.message || "tools/list was rejected");

  return {
    transport: "streamable-http",
    protocolVersion: init.result?.protocolVersion,
    serverName: init.result?.serverInfo?.name,
    tools: (list.result?.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
    })),
  };
}

/**
 * The 2024-11-05 transport: GET opens an event stream whose first event names
 * the POST endpoint, and every reply comes back over that stream.
 */
async function mcpOverSse(url: URL, headers: Record<string, string>): Promise<McpProbe> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TOOL_TEST_TIMEOUT_MS);

  try {
    const stream = await fetch(url, {
      headers: { ...headers, Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!stream.ok || !stream.body) {
      throw new Error(`could not open the event stream — HTTP ${stream.status}`);
    }

    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let endpoint: string | null = null;
    const replies = new Map<number, JsonRpcResponse>();

    /** Pulls frames until `want` has arrived, or the deadline aborts us. */
    const pump = async (want: () => boolean) => {
      while (!want()) {
        const { done, value } = await reader.read();
        if (done) throw new Error("the server closed the event stream");
        buffered += decoder.decode(value, { stream: true });

        const frames = buffered.split(/\r?\n\r?\n/);
        buffered = frames.pop() ?? "";
        for (const frame of frames) {
          const event = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
          const data = frame
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
          if (!data) continue;

          if (event === "endpoint") {
            endpoint = data;
            continue;
          }
          try {
            const parsed = JSON.parse(data) as JsonRpcResponse;
            if (typeof parsed.id === "number") replies.set(parsed.id, parsed);
          } catch {}
        }
      }
    };

    await pump(() => endpoint !== null);
    const post = new URL(endpoint!, url);

    const send = (payload: unknown) =>
      fetch(post, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: MCP_CLIENT_INFO },
    });
    await pump(() => replies.has(1));
    const init = replies.get(1)!;
    if (init.error) throw new Error(init.error.message || "initialize was rejected");

    await send({ jsonrpc: "2.0", method: "notifications/initialized" });

    await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await pump(() => replies.has(2));
    const list = replies.get(2)!;
    if (list.error) throw new Error(list.error.message || "tools/list was rejected");

    void reader.cancel().catch(() => {});

    return {
      transport: "http+sse",
      protocolVersion: init.result?.protocolVersion,
      serverName: init.result?.serverInfo?.name,
      tools: (list.result?.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? "",
      })),
    };
  } finally {
    clearTimeout(deadline);
    controller.abort();
  }
}
