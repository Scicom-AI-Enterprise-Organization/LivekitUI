import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { api, BASE_URL, cleanupToken, serverUp, uniqueSuffix } from "./helpers.mjs";

describe("access tokens", { concurrency: false }, () => {
  const created = [];

  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  after(async () => {
    for (const id of created) {
      await api(`/api/access-tokens/${id}?hard=1`, { method: "DELETE" }).catch(() => {});
    }
    await cleanupToken();
  });

  test("create returns the token exactly once", async () => {
    const res = await api("/api/access-tokens", {
      method: "POST",
      body: { name: `unit-${uniqueSuffix()}` },
    });
    assert.equal(res.status, 200);
    created.push(res.body.id);

    assert.match(res.body.token, /^lkui_/, "token must carry the lkui_ prefix");
    assert.ok(res.body.token.length > 30, "token must have real entropy");
    assert.ok(res.body.prefix.length < res.body.token.length, "prefix is a display fragment");

    // Listing must never expose the secret again.
    const list = await api("/api/access-tokens");
    const found = list.body.tokens.find((t) => t.id === res.body.id);
    assert.ok(found, "the new token must appear in the list");
    assert.equal(found.token, undefined, "list must not return the token value");
  });

  test("create requires a name", async () => {
    const res = await api("/api/access-tokens", { method: "POST", body: {} });
    assert.equal(res.status, 400);
  });

  test("create rejects a malformed body", async () => {
    const res = await fetch(`${BASE_URL}/api/access-tokens`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await (await import("./helpers.mjs")).token()}`,
      },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });

  test("a newly created token authenticates immediately", async () => {
    const res = await api("/api/access-tokens", {
      method: "POST",
      body: { name: `usable-${uniqueSuffix()}` },
    });
    created.push(res.body.id);

    const me = await api("/api/auth/me", { token: res.body.token });
    assert.equal(me.status, 200, "a fresh token must work at once");
  });

  test("revoking stops the token working on its next request", async () => {
    const res = await api("/api/access-tokens", {
      method: "POST",
      body: { name: `revoke-${uniqueSuffix()}` },
    });
    const { id, token: value } = res.body;

    const before = await api("/api/auth/me", { token: value });
    assert.equal(before.status, 200, "token should work before revocation");

    // Soft revoke on purpose: the row must survive so we can check it records
    // the revocation. Cleanup hard-deletes it afterwards.
    created.push(id);
    const revoked = await api(`/api/access-tokens/${id}`, { method: "DELETE" });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.revoked, true);

    const after = await api("/api/auth/me", { token: value });
    assert.equal(after.status, 401, "revocation must take effect with no restart");

    const list = await api("/api/access-tokens");
    const row = list.body.tokens.find((t) => t.id === id);
    assert.ok(row.revokedAt, "the row must record when it was revoked");
  });

  test("revoking an unknown id is a 404", async () => {
    const res = await api("/api/access-tokens/99999999", { method: "DELETE" });
    assert.equal(res.status, 404);
  });

  test("a non-numeric id is a 400", async () => {
    const res = await api("/api/access-tokens/not-a-number", { method: "DELETE" });
    assert.equal(res.status, 400);
  });

  test("using a token updates its lastUsedAt", async () => {
    const res = await api("/api/access-tokens", {
      method: "POST",
      body: { name: `touch-${uniqueSuffix()}` },
    });
    created.push(res.body.id);

    await api("/api/auth/me", { token: res.body.token });
    const list = await api("/api/access-tokens");
    const row = list.body.tokens.find((t) => t.id === res.body.id);
    assert.ok(row.lastUsedAt, "lastUsedAt must be stamped after a request");
  });
});
