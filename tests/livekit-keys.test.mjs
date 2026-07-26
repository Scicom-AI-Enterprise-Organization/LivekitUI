import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { api, BASE_URL, cleanupToken, GATEWAY_URL, serverUp, uniqueSuffix } from "./helpers.mjs";

import {
  decodeJwtClaims,
  decryptSecret,
  encryptSecret,
  generateApiKeyPair,
  signJwtHs256,
  verifyJwtHs256,
} from "../src/lib/api-keys.ts";

// One shared Bearer token per file — revoke it only once every suite is done.
after(cleanupToken);

/** The gateway is optional; skip its tests when it isn't running. */
async function gatewayUp() {
  try {
    const res = await fetch(`${GATEWAY_URL}/`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("issued LiveKit keys", { concurrency: false }, () => {
  const created = [];

  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  after(async () => {
    for (const id of created) {
      await api(`/api/api-keys/${id}?hard=1`, { method: "DELETE" }).catch(() => {});
    }
  });

  test("generate returns a key and its secret once", async () => {
    const res = await api("/api/api-keys", {
      method: "POST",
      body: { description: `test-key-${uniqueSuffix()}` },
    });
    assert.equal(res.status, 200);
    created.push(res.body.id);

    assert.match(res.body.apiKey, /^API[A-Za-z0-9]{12}$/, "keys mirror LiveKit Cloud's format");
    assert.equal(res.body.apiSecret.length, 43);
    assert.ok(res.body.wsUrl, "a key is useless without the URL to use it against");

    const list = await api("/api/api-keys");
    const found = list.body.keys.find((k) => k.id === res.body.id);
    assert.ok(found, "the key must be listed");
    assert.equal(found.apiSecret, undefined, "the secret must never be listed");
  });

  test("generate requires a description", async () => {
    const res = await api("/api/api-keys", { method: "POST", body: {} });
    assert.equal(res.status, 400);
  });

  test("revoking marks the key revoked", async () => {
    const res = await api("/api/api-keys", {
      method: "POST",
      body: { description: `revoke-${uniqueSuffix()}` },
    });
    created.push(res.body.id);

    const revoked = await api(`/api/api-keys/${res.body.id}`, { method: "DELETE" });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.revoked, true);

    const list = await api("/api/api-keys");
    const row = list.body.keys.find((k) => k.id === res.body.id);
    assert.ok(row.revokedAt, "the row must record the revocation");
  });

  test("revoking an unknown key is a 404", async () => {
    const res = await api("/api/api-keys/99999999", { method: "DELETE" });
    assert.equal(res.status, 404);
  });
});

describe("key crypto", () => {
  test("keys are unique and correctly shaped", () => {
    const a = generateApiKeyPair();
    const b = generateApiKeyPair();
    assert.match(a.apiKey, /^API[A-Za-z0-9]{12}$/);
    assert.notEqual(a.apiKey, b.apiKey);
    assert.notEqual(a.apiSecret, b.apiSecret);
  });

  test("secrets survive an encrypt/decrypt round trip", () => {
    process.env.SESSION_SECRET ||= "test-session-secret-for-crypto-tests";
    const { apiSecret } = generateApiKeyPair();
    const blob = encryptSecret(apiSecret);
    assert.ok(!blob.includes(apiSecret), "ciphertext must not contain the plaintext");
    assert.equal(decryptSecret(blob), apiSecret);
  });

  test("a tampered ciphertext is rejected", () => {
    process.env.SESSION_SECRET ||= "test-session-secret-for-crypto-tests";
    const blob = encryptSecret("some-secret-value");
    const tampered = blob.slice(0, -2) + (blob.endsWith("00") ? "11" : "00");
    assert.throws(() => decryptSecret(tampered));
  });

  test("re-signing preserves every claim but the issuer", () => {
    const claims = {
      iss: "APIoriginalkey",
      sub: "alice",
      exp: Math.floor(Date.now() / 1000) + 600,
      video: { roomJoin: true, room: "r1", canPublish: true },
      metadata: "keep-me",
    };
    const resigned = signJwtHs256(claims, "devkey", "server-secret");
    const out = decodeJwtClaims(resigned);

    assert.equal(out.iss, "devkey", "issuer must become the server key");
    assert.equal(out.sub, claims.sub);
    assert.equal(out.exp, claims.exp);
    assert.equal(out.metadata, claims.metadata);
    assert.deepEqual(out.video, claims.video, "grants must survive verbatim");
  });

  test("a signature only verifies with the right secret", () => {
    const token = signJwtHs256({ sub: "x" }, "key", "right-secret");
    assert.ok(verifyJwtHs256(token, "right-secret"));
    assert.ok(!verifyJwtHs256(token, "wrong-secret"));
  });
});

describe("gateway translation", { concurrency: false }, () => {
  let skip = false;

  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
    skip = !(await gatewayUp());
  });

  test("gateway passes through the server's own key", async (t) => {
    if (skip) return t.skip("gateway not running");
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const key = process.env.LIVEKIT_API_KEY || "devkey";
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!secret) return t.skip("LIVEKIT_API_SECRET not set");

    const rooms = await new RoomServiceClient(GATEWAY_URL, key, secret).listRooms();
    assert.ok(Array.isArray(rooms));
  });

  test("gateway rejects a key it was never told about", async (t) => {
    if (skip) return t.skip("gateway not running");
    const { RoomServiceClient } = await import("livekit-server-sdk");
    await assert.rejects(
      () => new RoomServiceClient(GATEWAY_URL, "APIneverIssued99", "x".repeat(43)).listRooms(),
      /invalid API key|401/i
    );
  });
});
