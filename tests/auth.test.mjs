import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { api, BASE_URL, cleanupToken, login, serverUp, token } from "./helpers.mjs";

// One shared Bearer token per file — revoke it only once every suite is done.
after(cleanupToken);

describe("auth", { concurrency: false }, () => {
  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  test("setup-check is public", async () => {
    const res = await api("/api/auth/setup-check", { noAuth: true });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.hasUsers, "boolean");
  });

  test("login rejects a wrong password", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.invalid", password: "wrong-password" }),
    });
    assert.equal(res.status, 401);
  });

  test("login sets a session cookie", async () => {
    const cookie = await login();
    assert.match(cookie, /lk_session=/);
  });

  test("me returns the caller via cookie", async () => {
    const cookie = await login();
    const res = await fetch(`${BASE_URL}/api/auth/me`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.user.email, "user.email must be present");
    assert.ok(["owner", "admin", "member"].includes(body.user.role));
  });

  test("me returns the same caller via Bearer token", async () => {
    const cookie = await login();
    const viaCookie = await (await fetch(`${BASE_URL}/api/auth/me`, { headers: { cookie } })).json();
    const viaToken = await api("/api/auth/me");
    assert.equal(viaToken.status, 200);
    assert.equal(viaToken.body.user.email, viaCookie.user.email);
    assert.equal(viaToken.body.user.role, viaCookie.user.role);
  });

  test("a malformed Bearer token is rejected, not treated as anonymous-allowed", async () => {
    const res = await api("/api/auth/me", { token: "lkui_this-was-never-issued" });
    assert.equal(res.status, 401);
  });

  test("a non-lkui Authorization header does not authenticate", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: "Bearer some.jwt.token" },
    });
    assert.equal(res.status, 401);
  });

  test("unauthenticated API calls get JSON 401, never an HTML redirect", async () => {
    const res = await fetch(`${BASE_URL}/api/agents`, { redirect: "manual" });
    assert.equal(res.status, 401);
    assert.match(res.headers.get("content-type") || "", /application\/json/);
    const body = await res.json();
    assert.ok(body.error, "must carry an error message");
  });

  test("a valid token reaches protected routes", async () => {
    const res = await api("/api/auth/me", { token: await token() });
    assert.equal(res.status, 200);
  });
});
