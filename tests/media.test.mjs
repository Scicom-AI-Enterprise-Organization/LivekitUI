import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { api, assertListOrUnavailable, BASE_URL, cleanupToken, serverUp } from "./helpers.mjs";

// One shared Bearer token per file — revoke it only once every suite is done.
after(cleanupToken);

/**
 * Egress, ingress, and SIP each run as their own LiveKit service over Redis. A
 * single-node `livekit-server --dev` has none of them, so every list here
 * accepts either real data or the documented 503 + serviceAvailable:false.
 * Validation and auth are asserted unconditionally, since those are ours.
 */
describe("egress", { concurrency: false }, () => {
  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  test("list returns egresses or reports the service is unavailable", async () => {
    const res = await api("/api/egresses");
    const { available, items } = assertListOrUnavailable(res, "egresses", assert);
    if (available) {
      for (const e of items) {
        assert.equal(typeof e.egressId, "string");
        assert.equal(typeof e.status, "string");
        assert.ok(Array.isArray(e.destinations));
      }
    }
  });

  test("list accepts room and active filters", async () => {
    const res = await api("/api/egresses?room=nonexistent-room&active=1");
    assertListOrUnavailable(res, "egresses", assert);
  });

  test("start requires a room", async () => {
    const res = await api("/api/egresses", { method: "POST", body: { type: "file", filepath: "/tmp/x.mp4" } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /room/);
  });

  test("start rejects an unknown output type", async () => {
    const res = await api("/api/egresses", { method: "POST", body: { room: "r", type: "telepathy" } });
    assert.equal(res.status, 400);
  });

  test("start requires filepath for a file egress", async () => {
    const res = await api("/api/egresses", { method: "POST", body: { room: "r", type: "file" } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /filepath/);
  });

  test("start requires url for a stream egress", async () => {
    const res = await api("/api/egresses", { method: "POST", body: { room: "r", type: "stream" } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /url/);
  });

  test("stopping an unknown egress fails with an explanation", async () => {
    const res = await api("/api/egresses/EG_does_not_exist/stop", { method: "POST" });
    // 404 when the service is up and simply has no such egress; 503 when the
    // service isn't connected; 502 when it answers something we can't classify
    // (a bare dev server panics rather than reporting "not found").
    assert.ok([404, 502, 503].includes(res.status), `expected 404/502/503, got ${res.status}`);
    assert.ok(res.body.error, "a failure must say what went wrong");
  });
});

describe("ingress", { concurrency: false }, () => {
  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  test("list returns ingresses or reports the service is unavailable", async () => {
    const res = await api("/api/ingresses");
    const { available, items } = assertListOrUnavailable(res, "ingresses", assert);
    if (available) {
      for (const i of items) {
        assert.equal(typeof i.ingressId, "string");
        assert.equal(typeof i.status, "string");
      }
    }
  });

  test("create requires a name", async () => {
    const res = await api("/api/ingresses", { method: "POST", body: { room: "r" } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /name/);
  });

  test("create requires a room", async () => {
    const res = await api("/api/ingresses", { method: "POST", body: { name: "n" } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /room/);
  });

  test("create rejects an unknown input type", async () => {
    const res = await api("/api/ingresses", {
      method: "POST",
      body: { name: "n", room: "r", inputType: "carrier-pigeon" },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /inputType/);
  });

  test("create requires a url for inputType=url", async () => {
    const res = await api("/api/ingresses", {
      method: "POST",
      body: { name: "n", room: "r", inputType: "url" },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /url/);
  });

  test("deleting an unknown ingress fails with an explanation", async () => {
    const res = await api("/api/ingresses/IN_does_not_exist", { method: "DELETE" });
    assert.ok([404, 502, 503].includes(res.status), `expected 404/502/503, got ${res.status}`);
    assert.ok(res.body.error, "a failure must say what went wrong");
    assert.ok(res.body.details, "the upstream reason must be passed through");
  });
});

describe("telephony", { concurrency: false }, () => {
  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);
  });

  test("sip trunks list returns trunks or reports the service is unavailable", async () => {
    const res = await api("/api/sip-trunks");
    const { available, items } = assertListOrUnavailable(res, "trunks", assert);
    if (available) {
      for (const t of items) {
        assert.ok(["inbound", "outbound"].includes(t.direction));
        assert.equal(typeof t.trunkId, "string");
      }
    }
  });

  test("sip trunks rejects an unknown direction filter", async () => {
    const res = await api("/api/sip-trunks?direction=sideways");
    assert.equal(res.status, 400);
  });

  test("trunk creation validates direction, name, and numbers", async () => {
    const bad = await api("/api/sip-trunks", { method: "POST", body: { direction: "sideways" } });
    assert.equal(bad.status, 400);

    const noName = await api("/api/sip-trunks", { method: "POST", body: { direction: "inbound" } });
    assert.equal(noName.status, 400);
    assert.match(noName.body.error, /name/);

    const noNumbers = await api("/api/sip-trunks", {
      method: "POST",
      body: { direction: "inbound", name: "t" },
    });
    assert.equal(noNumbers.status, 400);
    assert.match(noNumbers.body.error, /numbers/);

    const noAddress = await api("/api/sip-trunks", {
      method: "POST",
      body: { direction: "outbound", name: "t", numbers: ["+15550001111"] },
    });
    assert.ok([400, 503].includes(noAddress.status));
    if (noAddress.status === 400) assert.match(noAddress.body.error, /address/);
  });

  test("dispatch rules list returns rules or reports the service is unavailable", async () => {
    const res = await api("/api/dispatch-rules");
    assertListOrUnavailable(res, "rules", assert);
  });

  test("dispatch rule creation validates type and target", async () => {
    const badType = await api("/api/dispatch-rules", { method: "POST", body: { type: "vibes" } });
    assert.equal(badType.status, 400);

    const noRoom = await api("/api/dispatch-rules", { method: "POST", body: { type: "direct" } });
    assert.equal(noRoom.status, 400);
    assert.match(noRoom.body.error, /roomName/);

    const noPrefix = await api("/api/dispatch-rules", { method: "POST", body: { type: "individual" } });
    assert.equal(noPrefix.status, 400);
    assert.match(noPrefix.body.error, /roomPrefix/);
  });

  test("calls are derived from SIP participants in rooms", async () => {
    const res = await api("/api/calls");
    // No Redis needed: this walks rooms, so it should always answer.
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.calls));
    for (const c of res.body.calls) {
      assert.equal(typeof c.callId, "string");
      assert.equal(typeof c.roomName, "string");
    }
  });

  test("phone numbers list works", async () => {
    const res = await api("/api/phone-numbers");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.numbers ?? res.body.phoneNumbers ?? []));
  });
});
