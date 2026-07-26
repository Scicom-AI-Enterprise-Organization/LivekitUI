import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { api, BASE_URL, cleanupToken, serverUp, uniqueSuffix } from "./helpers.mjs";

// One shared Bearer token per file — revoke it only once every suite is done.
after(cleanupToken);

describe("tool library", { concurrency: false }, () => {
  const suffix = uniqueSuffix().replace(/-/g, "_");
  const created = [];

  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  after(async () => {
    for (const id of created) {
      await api(`/api/tools/${id}`, { method: "DELETE" }).catch(() => {});
    }
  });

  test("create tools of each kind", async () => {
    const cases = [
      {
        kind: "http",
        name: `http_${suffix}`,
        description: "test http tool",
        config: {
          method: "POST",
          url: "https://api.example.com/thing",
          params: [{ name: "city", type: "string", description: "City", required: true }],
          headers: [{ name: "X-Test", value: "1" }],
        },
      },
      { kind: "client", name: `client_${suffix}`, description: "test client tool", config: { params: [] } },
      { kind: "mcp", name: `mcp_${suffix}`, config: { url: "https://mcp.example.com/sse", headers: [] } },
    ];

    for (const c of cases) {
      const res = await api("/api/tools", { method: "POST", body: c });
      assert.equal(res.status, 200, `${c.kind} should be created`);
      created.push(res.body.id);
      assert.equal(res.body.kind, c.kind);
      assert.equal(res.body.name, c.name);
      // The name is mirrored into the config so an imported copy carries it.
      assert.equal(res.body.config.name, c.name);
    }
  });

  test("list returns them, and ?kind filters", async () => {
    const all = await api("/api/tools");
    assert.equal(all.status, 200);
    assert.ok(all.body.total >= 3);

    const http = await api("/api/tools?kind=http");
    assert.equal(http.status, 200);
    assert.ok(
      http.body.tools.every((t) => t.kind === "http"),
      "kind filter must not leak other kinds"
    );
    assert.ok(http.body.tools.some((t) => t.name === `http_${suffix}`));
  });

  test("an unknown kind filter is rejected", async () => {
    const res = await api("/api/tools?kind=telepathy");
    assert.equal(res.status, 400);
  });

  test("names must be usable as function names", async () => {
    for (const name of ["has spaces", "1starts-with-digit", ""]) {
      const res = await api("/api/tools", {
        method: "POST",
        body: { kind: "client", name, config: { params: [] } },
      });
      assert.equal(res.status, 400, `"${name}" must be rejected`);
    }
  });

  test("http and mcp entries require a url", async () => {
    const http = await api("/api/tools", {
      method: "POST",
      body: { kind: "http", name: `nourl_${suffix}`, config: { method: "GET" } },
    });
    assert.equal(http.status, 400);
    assert.match(http.body.error, /url/);

    const mcp = await api("/api/tools", {
      method: "POST",
      body: { kind: "mcp", name: `nourl2_${suffix}`, config: {} },
    });
    assert.equal(mcp.status, 400);
  });

  test("saving the same kind and name updates rather than duplicating", async () => {
    const name = `dupe_${suffix}`;
    const first = await api("/api/tools", {
      method: "POST",
      body: { kind: "http", name, description: "first", config: { method: "GET", url: "https://a.example" } },
    });
    assert.equal(first.status, 200);
    created.push(first.body.id);

    const second = await api("/api/tools", {
      method: "POST",
      body: { kind: "http", name, description: "second", config: { method: "POST", url: "https://b.example" } },
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id, "an upsert must reuse the row");
    assert.equal(second.body.description, "second");
    assert.equal(second.body.config.url, "https://b.example");

    const list = await api("/api/tools?kind=http");
    assert.equal(
      list.body.tools.filter((t) => t.name === name).length,
      1,
      "there must be exactly one row for that name"
    );
  });

  test("the same name may exist under a different kind", async () => {
    const name = `shared_${suffix}`;
    const a = await api("/api/tools", {
      method: "POST",
      body: { kind: "client", name, config: { params: [] } },
    });
    const b = await api("/api/tools", {
      method: "POST",
      body: { kind: "mcp", name, config: { url: "https://mcp.example" } },
    });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.notEqual(a.body.id, b.body.id);
    created.push(a.body.id, b.body.id);
  });

  test("delete removes the entry", async () => {
    const res = await api("/api/tools", {
      method: "POST",
      body: { kind: "client", name: `gone_${suffix}`, config: { params: [] } },
    });
    const { id } = res.body;

    const deleted = await api(`/api/tools/${id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);

    const list = await api("/api/tools");
    assert.ok(!list.body.tools.some((t) => t.id === id), "the row must be gone");
  });

  test("deleting an unknown id is a 404", async () => {
    const res = await api("/api/tools/99999999", { method: "DELETE" });
    assert.equal(res.status, 404);
  });

  test("a non-numeric id is a 400", async () => {
    const res = await api("/api/tools/not-a-number", { method: "DELETE" });
    assert.equal(res.status, 400);
  });

  test("an OpenAPI document becomes HTTP tools", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Spec Under Test", version: "9.9" },
      servers: [{ url: "https://spec.example.com" }],
      paths: {
        "/widgets/{widgetId}": {
          get: {
            operationId: "getWidget",
            summary: "Fetch a widget",
            parameters: [{ name: "widgetId", in: "path", required: true, schema: { type: "string" } }],
          },
        },
      },
    };
    const res = await api("/api/tools/openapi", { method: "POST", body: { spec: JSON.stringify(spec) } });
    assert.equal(res.status, 200);
    assert.equal(res.body.title, "Spec Under Test");
    assert.equal(res.body.baseUrl, "https://spec.example.com");

    const tool = res.body.tools.find((t) => t.name === "get_widget");
    assert.ok(tool, "operationId should become a snake_case tool name");
    assert.equal(tool.method, "GET");
    assert.equal(tool.url, "https://spec.example.com/widgets/{widgetId}");
    assert.ok(tool.params.some((p) => p.name === "widgetId" && p.required));
  });

  test("YAML documents are accepted too", async () => {
    const yamlSpec = [
      "openapi: 3.0.0",
      "info:",
      "  title: YAML Spec",
      "servers:",
      "  - url: https://yaml.example.com",
      "paths:",
      "  /things:",
      "    get:",
      "      operationId: listThings",
    ].join("\n");
    const res = await api("/api/tools/openapi", { method: "POST", body: { spec: yamlSpec } });
    assert.equal(res.status, 200);
    assert.equal(res.body.title, "YAML Spec");
    assert.ok(res.body.tools.some((t) => t.name === "list_things"));
  });

  test("reading a spec saves nothing on its own", async () => {
    const before = (await api("/api/tools")).body.total;
    await api("/api/tools/openapi", {
      method: "POST",
      body: {
        spec: JSON.stringify({ openapi: "3.0.0", info: {}, paths: { "/x": { get: { operationId: "xOp" } } } }),
      },
    });
    const after = (await api("/api/tools")).body.total;
    assert.equal(after, before, "parsing is a preview — the caller decides what to keep");
  });

  test("a malformed or non-OpenAPI document is rejected", async () => {
    for (const spec of ["this: [is: not: valid", JSON.stringify({ hello: "world" }), "{}"]) {
      const res = await api("/api/tools/openapi", { method: "POST", body: { spec } });
      assert.equal(res.status, 400, `should reject: ${spec.slice(0, 20)}`);
      assert.ok(res.body.error);
    }
  });

  test("openapi import needs a url or a spec", async () => {
    const res = await api("/api/tools/openapi", { method: "POST", body: {} });
    assert.equal(res.status, 400);
  });

  test("a non-http url scheme is refused", async () => {
    const res = await api("/api/tools/openapi", { method: "POST", body: { url: "file:///etc/passwd" } });
    assert.equal(res.status, 400);
  });
});
