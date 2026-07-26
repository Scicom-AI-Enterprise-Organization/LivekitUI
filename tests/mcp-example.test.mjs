/**
 * Drives the example MCP server the way a real client does: SSE + POST.
 * Skips itself when the server is not running (npm run mcp:example).
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.TEST_MCP_URL || "http://localhost:7900";

let up = false;
try {
  up = (await fetch(BASE + "/", { signal: AbortSignal.timeout(2000) })).ok;
} catch {}

const ok = (label, cond, extra = "") => test(label, (t) => {
  if (!up) return t.skip("example MCP server not running");
  assert.ok(cond, extra);
});

if (!up) {
  test("example MCP server", (t) => t.skip("not running — start it with npm run mcp:example"));
} else {

// 1. open the stream and read the endpoint event
const res = await fetch(`${BASE}/sse`);
ok("SSE stream opens", res.ok && res.headers.get("content-type").startsWith("text/event-stream"));
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
const replies = [];

const pump = (async () => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (event && data) replies.push({ event, data });
    }
  }
})();

await new Promise(r => setTimeout(r, 400));
const endpointEvent = replies.find(r => r.event === "endpoint");
ok("server announces its POST endpoint", !!endpointEvent, endpointEvent?.data);
const postUrl = BASE + endpointEvent.data;

const rpc = async (method, params, id) => {
  const before = replies.length;
  await fetch(postUrl, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  for (let i = 0; i < 40 && replies.length === before; i++) await new Promise(r => setTimeout(r, 50));
  const msg = replies.slice(before).find(r => r.event === "message");
  return msg ? JSON.parse(msg.data) : null;
};

const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {} }, 1);
ok("initialize handshake", init?.result?.protocolVersion === "2024-11-05", init?.result?.serverInfo?.name);
ok("declares tool capability", !!init?.result?.capabilities?.tools);

const list = await rpc("tools/list", {}, 2);
const names = (list?.result?.tools || []).map(t => t.name);
ok("tools/list returns all three", names.length === 3, names.join(", "));
ok("each tool has a schema", (list.result.tools || []).every(t => t.inputSchema?.type === "object"));

const echo = await rpc("tools/call", { name: "echo", arguments: { text: "hello mcp" } }, 3);
ok("tools/call echo", echo?.result?.content?.[0]?.text === "Echo: hello mcp", echo?.result?.content?.[0]?.text);

const dice = await rpc("tools/call", { name: "roll_dice", arguments: { sides: 20, count: 3 } }, 4);
ok("tools/call roll_dice", /Rolled .* on 3 20-sided dice/.test(dice?.result?.content?.[0]?.text || ""), dice?.result?.content?.[0]?.text);

const time = await rpc("tools/call", { name: "get_current_time", arguments: { timezone: "Asia/Kuala_Lumpur" } }, 5);
ok("tools/call get_current_time", /current time in Asia\/Kuala_Lumpur/.test(time?.result?.content?.[0]?.text || ""), time?.result?.content?.[0]?.text);

const badTz = await rpc("tools/call", { name: "get_current_time", arguments: { timezone: "Mars/Olympus" } }, 6);
ok("bad input is a tool result, not a crash", !!badTz?.result?.content?.[0]?.text, badTz?.result?.content?.[0]?.text);

const unknown = await rpc("tools/call", { name: "no_such_tool", arguments: {} }, 7);
ok("unknown tool is a JSON-RPC error", unknown?.error?.code === -32602, unknown?.error?.message);

const ping = await rpc("ping", {}, 8);
ok("ping", !!ping && !ping.error);

reader.cancel().catch(() => {});
  await pump.catch(() => {});
}
