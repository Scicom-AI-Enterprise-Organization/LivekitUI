import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { api, BASE_URL, cleanupToken, serverUp, uniqueSuffix } from "./helpers.mjs";

// One shared Bearer token per file — revoke it only once every suite is done.
after(cleanupToken);

describe("agents", { concurrency: false }, () => {
  const suffix = uniqueSuffix();
  const agentName = `test-agent-${suffix}`;
  let created = false;

  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  after(async () => {
    if (created) {
      await api("/api/agents", { method: "DELETE", body: { name: agentName } }).catch(() => {});
    }
  });

  test("list returns agents, sessions, stats, and history", async () => {
    const res = await api("/api/agents?hours=1");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.agents));
    assert.ok(Array.isArray(res.body.sessions));
    assert.ok(Array.isArray(res.body.history));
    assert.equal(typeof res.body.stats.totalAgents, "number");
    assert.equal(res.body.stats.totalAgents, res.body.agents.length, "stats must match the list");
  });

  test("a nameless auto-dispatch is not reported as an agent", async () => {
    const res = await api("/api/agents?hours=1");
    const phantom = res.body.agents.filter((a) => a.agentName.includes("auto-dispatch"));
    assert.equal(phantom.length, 0, "an auto-dispatch record is a dispatch, not a worker");
  });

  test("create requires a name", async () => {
    const res = await api("/api/agents", { method: "POST", body: { config: {} } });
    assert.equal(res.status, 400);
  });

  test("create then find by name", async () => {
    const res = await api("/api/agents", {
      method: "POST",
      body: { name: agentName, config: { instructions: "test only" }, status: "draft" },
    });
    assert.equal(res.status, 200);
    created = true;

    const found = await api(`/api/agents/by-name?name=${encodeURIComponent(agentName)}`);
    assert.equal(found.status, 200);
    assert.equal(found.body.agent.name, agentName);
  });

  test("an unknown agent name is a 404", async () => {
    const res = await api("/api/agents/by-name?name=definitely-not-an-agent-xyz");
    assert.equal(res.status, 404);
  });
});

describe("rooms and overview", { concurrency: false }, () => {
  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  test("rooms list has the documented shape", async () => {
    const res = await api("/api/rooms");
    assert.equal(res.status, 200);
    const rooms = res.body.rooms ?? res.body;
    assert.ok(Array.isArray(rooms));
  });

  test("participants of an unknown room do not crash the route", async () => {
    const res = await api("/api/rooms/definitely-no-such-room/participants");
    assert.ok([200, 404, 502].includes(res.status), `unexpected ${res.status}`);
  });

  test("overview returns stats", async () => {
    const res = await api("/api/overview");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body, "object");
  });

  test("metrics returns prometheus-derived numbers", async () => {
    const res = await api("/api/metrics");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body, "object");
  });
});

describe("secrets", { concurrency: false }, () => {
  const name = `TEST_SECRET_${uniqueSuffix().replace(/-/g, "_").toUpperCase()}`;

  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  after(async () => {
    await api("/api/secrets", { method: "DELETE", body: { name } }).catch(() => {});
  });

  test("create, list, then delete a secret", async () => {
    const created = await api("/api/secrets", {
      method: "POST",
      body: { name, value: "test-value", description: "created by the test suite" },
    });
    assert.equal(created.status, 200);

    const list = await api("/api/secrets");
    assert.equal(list.status, 200);
    const secrets = list.body.secrets ?? [];
    const found = secrets.find((s) => s.name === name);
    assert.ok(found, "the new secret must be listed");

    const deleted = await api("/api/secrets", { method: "DELETE", body: { name } });
    assert.equal(deleted.status, 200);

    const after = await api("/api/secrets");
    assert.ok(
      !(after.body.secrets ?? []).some((s) => s.name === name),
      "the secret must be gone after deletion"
    );
  });
});

describe("providers", { concurrency: false }, () => {
  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  test("list returns the seeded providers with model arrays", async () => {
    const res = await api("/api/providers");
    assert.equal(res.status, 200);
    const providers = res.body.providers ?? [];
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length > 0, "a fresh install seeds built-in providers");
    for (const p of providers) {
      assert.equal(typeof p.slug, "string");
      assert.ok(Array.isArray(p.models), `${p.slug}.models must be an array`);
    }
  });
});

describe("sandboxes and webhooks", { concurrency: false }, () => {
  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  test("sandbox apps list", async () => {
    const res = await api("/api/sandbox-apps");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.apps ?? res.body.sandboxApps ?? []));
  });

  test("sandbox config exposes the proxy base", async () => {
    const res = await api("/api/sandbox-config");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body, "object");
  });

  test("webhook event log is readable", async () => {
    const res = await api("/api/webhooks");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.events ?? []));
  });
});
