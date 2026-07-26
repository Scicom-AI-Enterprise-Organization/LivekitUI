/**
 * Shared test setup.
 *
 * These are integration tests: they drive the real REST API against a running
 * dashboard, so they exercise the actual routes, database, and LiveKit server
 * rather than mocks. Run the dashboard first, then `npm test`.
 *
 * Auth: set TEST_EMAIL + TEST_PASSWORD (an existing account) or TEST_API_TOKEN
 * (an existing lkui_ token). The suite mints its own short-lived Bearer token
 * from the credentials and revokes it when done.
 */

export const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3010";
export const GATEWAY_URL = process.env.TEST_GATEWAY_URL || "http://localhost:7885";

let cachedToken = process.env.TEST_API_TOKEN || null;
let mintedTokenId = null;
let cachedCookie = null;

/** True when the dashboard is reachable — tests skip themselves otherwise. */
export async function serverUp() {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/setup-check`, {
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function login() {
  if (cachedCookie) return cachedCookie;
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("Set TEST_EMAIL and TEST_PASSWORD (or TEST_API_TOKEN) to run these tests");
  }

  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}). Check TEST_EMAIL / TEST_PASSWORD.`);
  }
  cachedCookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return cachedCookie;
}

/** A Bearer token for the suite, minted once and reused. */
export async function token() {
  if (cachedToken) return cachedToken;

  const cookie = await login();
  const res = await fetch(`${BASE_URL}/api/access-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: `test-suite-${process.pid}` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Could not mint a test token: ${data.error}`);

  cachedToken = data.token;
  mintedTokenId = data.id;
  return cachedToken;
}

/** Revokes the suite's own token. Safe to call when nothing was minted. */
export async function cleanupToken() {
  if (!mintedTokenId) return;
  const cookie = await login();
  // hard=1 removes the row: without it every run would leave a revoked token
  // behind and clutter Settings > Access tokens.
  await fetch(`${BASE_URL}/api/access-tokens/${mintedTokenId}?hard=1`, {
    method: "DELETE",
    headers: { cookie },
  }).catch(() => {});
  mintedTokenId = null;
}

/**
 * Authenticated request. Returns { status, body } — body is parsed JSON, or the
 * raw text when a route answers with something else.
 */
export async function api(path, options = {}) {
  const bearer = options.noAuth ? null : options.token ?? (await token());
  const headers = { ...(options.headers || {}) };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

/**
 * Endpoints backed by egress / ingress / SIP need Redis and their own LiveKit
 * services. A single-node dev server answers 503 with serviceAvailable:false,
 * which is a valid outcome — assert on both shapes so the suite passes in
 * either deployment.
 */
export function assertListOrUnavailable(result, key, assert) {
  if (result.status === 503) {
    assert.equal(result.body.serviceAvailable, false, "503 must carry serviceAvailable:false");
    assert.ok(result.body.reason, "503 must explain why the service is unavailable");
    return { available: false, items: [] };
  }
  assert.equal(result.status, 200, `expected 200 or 503, got ${result.status}`);
  assert.ok(Array.isArray(result.body[key]), `${key} must be an array`);
  assert.equal(typeof result.body.total, "number", "total must be a number");
  return { available: true, items: result.body[key] };
}

/** Unique suffix so parallel or repeated runs never collide. */
export function uniqueSuffix() {
  return `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}
