/**
 * A minimal MCP server, for trying the MCP tool support end to end.
 *
 * Speaks the HTTP+SSE transport (protocol 2024-11-05), which is what the
 * LiveKit agents MCP plugin connects to:
 *
 *   GET  /sse       opens the event stream; the first event names the POST
 *                   endpoint the client should send JSON-RPC to
 *   POST /messages  JSON-RPC requests; replies are pushed back over the stream
 *
 * No dependencies — the protocol is small enough to implement directly, and
 * this stays runnable in any checkout.
 *
 *   npm run mcp:example
 *   then add an MCP server in Tools pointing at http://localhost:7900/sse
 */

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.MCP_PORT || 7900);
const PROTOCOL_VERSION = "2024-11-05";

/** sessionId -> the SSE response we write events to. */
const sessions = new Map();

// ── The tools this server exposes ──

const TOOLS = [
  {
    name: "get_current_time",
    description: "Get the current date and time, optionally for a specific IANA timezone.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: 'IANA timezone, e.g. "Asia/Kuala_Lumpur". Defaults to the server timezone.',
        },
      },
    },
    handler: ({ timezone }) => {
      try {
        const formatted = new Date().toLocaleString("en-GB", timezone ? { timeZone: timezone } : {});
        return `The current time${timezone ? ` in ${timezone}` : ""} is ${formatted}.`;
      } catch {
        return `"${timezone}" is not a timezone I recognise.`;
      }
    },
  },
  {
    name: "roll_dice",
    description: "Roll one or more dice and return the results.",
    inputSchema: {
      type: "object",
      properties: {
        sides: { type: "number", description: "Number of sides on each die. Default 6." },
        count: { type: "number", description: "How many dice to roll. Default 1." },
      },
    },
    handler: ({ sides = 6, count = 1 }) => {
      const n = Math.min(Math.max(Math.floor(count) || 1, 1), 20);
      const faces = Math.min(Math.max(Math.floor(sides) || 6, 2), 1000);
      const rolls = Array.from({ length: n }, () => crypto.randomInt(1, faces + 1));
      const total = rolls.reduce((a, b) => a + b, 0);
      return n === 1
        ? `Rolled a ${rolls[0]} on a ${faces}-sided die.`
        : `Rolled ${rolls.join(", ")} on ${n} ${faces}-sided dice. Total: ${total}.`;
    },
  },
  {
    name: "echo",
    description: "Repeat back whatever text is given. Useful for checking the connection.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to repeat." } },
      required: ["text"],
    },
    handler: ({ text }) => `Echo: ${text}`,
  },
];

// ── JSON-RPC ──

function handleRpc(message) {
  const { id, method, params } = message;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, msg) => ({ jsonrpc: "2.0", id, error: { code, message: msg } });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "livekitui-example-mcp", version: "1.0.0" },
      });

    case "tools/list":
      return reply({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });

    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
      try {
        const text = tool.handler(params.arguments || {});
        return reply({ content: [{ type: "text", text }], isError: false });
      } catch (err) {
        // Tool failures are a result, not a protocol error — the model should
        // see them and be able to react.
        return reply({
          content: [{ type: "text", text: `Tool failed: ${err.message}` }],
          isError: true,
        });
      }
    }

    case "ping":
      return reply({});

    default:
      // Notifications carry no id and expect no reply.
      if (id === undefined) return null;
      return fail(-32601, `Method not found: ${method}`);
  }
}

// ── Transport ──

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Browsers and some clients preflight the POST.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/sse") {
    const sessionId = crypto.randomUUID();
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    sessions.set(sessionId, res);

    // The client learns where to POST from this first event.
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

    // Comment frames keep proxies from closing an idle stream.
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(keepAlive);
      sessions.delete(sessionId);
      log(`session ${sessionId.slice(0, 8)} closed (${sessions.size} open)`);
    });

    log(`session ${sessionId.slice(0, 8)} opened (${sessions.size} open)`);
    return;
  }

  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId");
    const stream = sessionId ? sessions.get(sessionId) : null;

    let body = "";
    for await (const chunk of req) body += chunk;

    let message;
    try {
      message = JSON.parse(body);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }

    const response = handleRpc(message);
    if (message.method) log(`→ ${message.method}${message.params?.name ? ` (${message.params.name})` : ""}`);

    if (!response) {
      res.writeHead(202).end();
      return;
    }

    if (stream) {
      // The transport's normal path: reply over the event stream.
      stream.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      res.writeHead(202).end();
    } else {
      // No stream (or a plain HTTP client): answer inline so the server is
      // still usable with curl.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(response));
    }
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        name: "livekitui-example-mcp",
        protocolVersion: PROTOCOL_VERSION,
        sse: "/sse",
        tools: TOOLS.map((t) => t.name),
      })
    );
    return;
  }

  res.writeHead(404).end("not found");
});

const log = (...args) => console.log("mcp:", ...args);

server.listen(PORT, () => {
  log(`example MCP server listening on http://localhost:${PORT}`);
  log(`  SSE endpoint  http://localhost:${PORT}/sse`);
  log(`  tools         ${TOOLS.map((t) => t.name).join(", ")}`);
});
