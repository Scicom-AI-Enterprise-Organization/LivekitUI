import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { api, BASE_URL, serverUp } from "./helpers.mjs";

/**
 * Every non-public endpoint must reject an unauthenticated caller itself, not
 * rely on middleware. This caught a real hole: /api/agents once returned 200 to
 * anyone sending any Authorization header, because middleware was its only
 * guard.
 */
const PROTECTED = [
  ["GET", "/api/agents"],
  ["POST", "/api/agents"],
  ["DELETE", "/api/agents"],
  ["GET", "/api/agents/by-name?name=x"],
  ["POST", "/api/agents/rename"],
  ["GET", "/api/agents/x/logs"],
  ["GET", "/api/agents/x/metrics"],
  ["GET", "/api/agents/x/history"],
  ["GET", "/api/agents/x/versions"],
  ["GET", "/api/agents/x/secrets"],
  ["POST", "/api/agents/x/deploy"],
  ["POST", "/api/agents/x/stop"],
  ["POST", "/api/agents/x/restart"],
  ["GET", "/api/access-tokens"],
  ["POST", "/api/access-tokens"],
  ["DELETE", "/api/access-tokens/1"],
  ["GET", "/api/api-keys"],
  ["POST", "/api/api-keys"],
  ["DELETE", "/api/api-keys/1"],
  ["GET", "/api/auth/me"],
  ["GET", "/api/auth/users"],
  ["POST", "/api/auth/invite"],
  ["POST", "/api/auth/password"],
  ["PATCH", "/api/auth/profile"],
  ["GET", "/api/rooms"],
  ["GET", "/api/rooms/x/participants"],
  ["GET", "/api/overview"],
  ["GET", "/api/metrics"],
  ["GET", "/api/egresses"],
  ["POST", "/api/egresses"],
  ["POST", "/api/egresses/x/stop"],
  ["GET", "/api/ingresses"],
  ["POST", "/api/ingresses"],
  ["DELETE", "/api/ingresses/x"],
  ["GET", "/api/sip-trunks"],
  ["POST", "/api/sip-trunks"],
  ["DELETE", "/api/sip-trunks/x"],
  ["GET", "/api/dispatch-rules"],
  ["POST", "/api/dispatch-rules"],
  ["DELETE", "/api/dispatch-rules/x"],
  ["GET", "/api/calls"],
  ["GET", "/api/phone-numbers"],
  ["POST", "/api/phone-numbers"],
  ["GET", "/api/phone-numbers/providers"],
  ["POST", "/api/phone-numbers/import"],
  ["GET", "/api/providers"],
  ["POST", "/api/providers"],
  ["POST", "/api/providers/test"],
  ["GET", "/api/secrets"],
  ["POST", "/api/secrets"],
  ["GET", "/api/tools"],
  ["POST", "/api/tools"],
  ["DELETE", "/api/tools/1"],
  ["POST", "/api/tools/openapi"],
  ["GET", "/api/sandbox-apps"],
  ["POST", "/api/sandbox-apps"],
  ["GET", "/api/sandbox-config"],
  ["GET", "/api/webhooks"],
  ["DELETE", "/api/webhooks"],
  ["POST", "/api/livekit/token"],
];

/** Deliberately reachable without a session. */
const PUBLIC = [
  ["GET", "/api/auth/setup-check"],
  ["POST", "/api/auth/login"],
  ["GET", "/api/sandbox-apps/resolve?name=x"],
];

describe("authorization", () => {
  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  for (const [method, path] of PROTECTED) {
    test(`${method} ${path} rejects no credentials`, async () => {
      const res = await api(path, { method, noAuth: true, body: method === "GET" ? undefined : {} });
      assert.equal(res.status, 401, `${method} ${path} must answer 401, got ${res.status}`);
    });

    test(`${method} ${path} rejects a forged token`, async () => {
      const res = await api(path, {
        method,
        token: "lkui_forged-token-value",
        body: method === "GET" ? undefined : {},
      });
      assert.equal(res.status, 401, `${method} ${path} must answer 401, got ${res.status}`);
    });
  }

  for (const [method, path] of PUBLIC) {
    test(`${method} ${path} stays reachable without credentials`, async () => {
      const res = await api(path, { method, noAuth: true, body: method === "GET" ? undefined : {} });
      assert.notEqual(res.status, 401, `${method} ${path} is meant to be public`);
    });
  }
});
