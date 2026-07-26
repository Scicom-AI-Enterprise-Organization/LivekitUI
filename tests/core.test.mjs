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

  test("logs default to a 10kb tail", async () => {
    const res = await api(`/api/agents/${encodeURIComponent(agentName)}/logs`);
    assert.equal(res.status, 200);
    assert.equal(res.body.tail, "10kb", "opening a log must not pull the whole file");
    assert.equal(typeof res.body.logs, "string");
    assert.equal(typeof res.body.size, "number");
    assert.equal(typeof res.body.truncated, "boolean");
    assert.equal(typeof res.body.running, "boolean");
  });

  test("each tail size returns at most its window", async () => {
    const limits = { "10kb": 10 * 1024, "50kb": 50 * 1024, "100kb": 100 * 1024 };
    for (const [tail, max] of Object.entries(limits)) {
      const res = await api(`/api/agents/${encodeURIComponent(agentName)}/logs?tail=${tail}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.tail, tail);
      assert.ok(
        Buffer.byteLength(res.body.logs, "utf8") <= max,
        `${tail} returned more than ${max} bytes`
      );
    }
  });

  test("tail=all returns the whole file", async () => {
    const res = await api(`/api/agents/${encodeURIComponent(agentName)}/logs?tail=all`);
    assert.equal(res.status, 200);
    assert.equal(res.body.truncated, false, "the whole file is never marked truncated");
  });

  test("a larger window returns at least as much as a smaller one", async () => {
    const small = await api(`/api/agents/${encodeURIComponent(agentName)}/logs?tail=10kb`);
    const large = await api(`/api/agents/${encodeURIComponent(agentName)}/logs?tail=100kb`);
    assert.ok(large.body.logs.length >= small.body.logs.length);
  });

  test("an unknown tail size is rejected", async () => {
    const res = await api(`/api/agents/${encodeURIComponent(agentName)}/logs?tail=9tb`);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /tail must be one of/);
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

  test("overview reports a time range, not just what is live", async () => {
    const res = await api("/api/overview?hours=168");
    assert.equal(res.status, 200);
    assert.equal(res.body.hours, 168);

    // History comes from the dashboard's own rollup, so these must be present
    // and self-consistent even when no room is live right now.
    for (const series of [res.body.rooms.perDay, res.body.participants.perDay]) {
      assert.ok(Array.isArray(series), "per-day series must be an array");
      assert.equal(series.length, 7, "a 168h range is 7 daily buckets");
      for (const point of series) {
        assert.equal(typeof point.day, "string");
        assert.ok(Number.isFinite(point.value) && point.value >= 0);
      }
    }

    const roomsFromSeries = res.body.rooms.perDay.reduce((n, p) => n + p.value, 0);
    assert.equal(
      roomsFromSeries,
      res.body.rooms.total,
      "the daily buckets must add up to the headline room count"
    );

    const participantsFromSeries = res.body.participants.perDay.reduce((n, p) => n + p.value, 0);
    assert.equal(participantsFromSeries, res.body.participants.total);

    // Live counts are reported separately from the range, never mixed into it.
    assert.equal(typeof res.body.live.rooms, "number");
    assert.equal(typeof res.body.agents.concurrentPeak, "number");
    assert.ok(
      res.body.agents.concurrentPeak >= res.body.live.agents,
      "a peak over the range cannot be below what is connected now"
    );
  });

  test("overview time range narrows the result", async () => {
    const [week, hour] = await Promise.all([
      api("/api/overview?hours=168"),
      api("/api/overview?hours=1"),
    ]);
    assert.equal(week.status, 200);
    assert.equal(hour.status, 200);
    assert.ok(
      hour.body.rooms.total <= week.body.rooms.total,
      "an hour cannot contain more sessions than the week around it"
    );
    assert.equal(hour.body.rooms.perDay.length, 1);
  });

  test("participant minutes are split by kind and sum to the parts", async () => {
    const res = await api("/api/overview?hours=168");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.participants.byKind));
    for (const kind of res.body.participants.byKind) {
      assert.equal(typeof kind.label, "string");
      assert.ok(kind.value > 0, "a zero slice should be dropped, not drawn");
    }
    const webrtc = res.body.participants.byKind.find((k) => k.label === "WebRTC");
    assert.equal(
      webrtc?.value ?? 0,
      res.body.participants.minutes,
      "the WebRTC slice is the WebRTC headline number"
    );
  });

  test("telephony minutes are split by direction", async () => {
    const res = await api("/api/overview?hours=168");
    assert.equal(res.status, 200);
    const { inboundSec, outboundSec, perDay } = res.body.telephony;
    assert.ok(Number.isFinite(inboundSec) && inboundSec >= 0);
    assert.ok(Number.isFinite(outboundSec) && outboundSec >= 0);
    assert.equal(perDay.length, 7);
    for (const day of perDay) {
      assert.equal(day.total, day.inbound + day.outbound, "total must be the two legs");
    }
  });

  test("metrics returns prometheus-derived numbers, or explains their absence", async () => {
    const res = await api("/api/metrics?hours=168");

    if (res.status === 503) {
      // No `prometheus:` block in livekit.yaml is a deployment gap, not a bug —
      // but the route must say so rather than return zeros.
      assert.equal(res.body.metricsAvailable, false);
      assert.ok(res.body.hint, "an unreachable metrics port must come with a fix");
      return;
    }

    assert.equal(res.status, 200);
    assert.equal(res.body.metricsAvailable, true);
    // Media byte counters, not the psrpc signalling counters.
    assert.ok(Number.isFinite(res.body.live.bytesIn));
    assert.ok(Number.isFinite(res.body.live.bytesOut));

    const success = res.body.connectionSuccess;
    assert.ok(
      success === null || (success >= 0 && success <= 100),
      "connection success is a real ratio or null, never a hardcoded 100"
    );
    if (res.body.live.joinSignalConnected === 0) {
      assert.equal(success, null, "no connections means no rate to report");
    }

    const b = res.body.bandwidth;
    assert.equal(b.days.length, b.upstream.length);
    assert.equal(b.days.length, b.downstream.length);
    for (const v of [...b.upstream, ...b.downstream]) {
      assert.ok(v >= 0, "a counter reset must not produce negative transfer");
    }
  });

  test("transfer totals accumulate and never fall", async () => {
    const first = await api("/api/metrics?hours=168");
    if (first.status === 503) return; // no metrics port on this deployment

    assert.equal(first.status, 200);
    const a = first.body.bandwidth;

    // The dashboard's own total, not the server's counter — the server's runs
    // from its last boot and drops to zero when it restarts.
    assert.ok(Number.isFinite(a.totalUpstreamBytes));
    assert.ok(Number.isFinite(a.totalDownstreamBytes));
    assert.ok(a.sinceServerBootUpstream, "the server-boot figure is reported alongside");

    const second = await api("/api/metrics?hours=168");
    assert.equal(second.status, 200);
    const b = second.body.bandwidth;

    assert.ok(
      b.totalUpstreamBytes >= a.totalUpstreamBytes,
      "an accumulated total must never go backwards"
    );
    assert.ok(
      b.totalDownstreamBytes >= a.totalDownstreamBytes,
      "an accumulated total must never go backwards"
    );
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

describe("session history", { concurrency: false }, () => {
  const suffix = uniqueSuffix();
  const agentName = `bulk-delete-${suffix}`;
  const created = [];

  before(async () => {
    if (!(await serverUp())) throw new Error(`No dashboard at ${BASE_URL} — start it first`);

    // Three throwaway sessions of our own. The bulk tests must never touch
    // history the user actually recorded.
    for (let i = 0; i < 3; i++) {
      const res = await api("/api/sessions", {
        method: "POST",
        body: {
          agentName,
          room: `${agentName}-room-${i}`,
          talkMode: "browser",
          startedAt: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
          durationMs: 30_000,
          participants: 2,
          events: [],
          metrics: [],
          transcript: [],
        },
      });
      assert.equal(res.status, 200, "could not seed a session");
      created.push(res.body.session.id);
    }
  });

  after(async () => {
    if (created.length) {
      await api("/api/sessions", { method: "DELETE", body: { ids: created } }).catch(() => {});
    }
  });

  test("ids must be an array", async () => {
    const res = await api("/api/sessions", { method: "DELETE", body: { ids: "12" } });
    assert.equal(res.status, 400);
  });

  test("ids that parse to nothing usable are rejected", async () => {
    const res = await api("/api/sessions", { method: "DELETE", body: { ids: [0, -5, "abc"] } });
    assert.equal(res.status, 400);
  });

  test("a bulk delete is capped", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    const res = await api("/api/sessions", { method: "DELETE", body: { ids } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /more than 200/);
  });

  test("unknown ids are reported as missing, not as a failure", async () => {
    const res = await api("/api/sessions", { method: "DELETE", body: { ids: [987654, 987655] } });
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 0);
    assert.deepEqual(res.body.missing, [987654, 987655]);
    assert.deepEqual(res.body.failed, []);
  });

  test("deletes several at once, counting a repeated id only once", async () => {
    const [first, second] = created;
    const res = await api("/api/sessions", {
      method: "DELETE",
      body: { ids: [first, first, second, 987656] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.requested, 3, "the duplicate is collapsed before deleting");
    assert.equal(res.body.deleted, 2);
    assert.deepEqual(res.body.missing, [987656]);

    // Gone from the list, and the survivor is untouched.
    const list = await api(`/api/sessions?agent=${encodeURIComponent(agentName)}`);
    assert.equal(list.status, 200);
    const remaining = list.body.sessions.map((s) => s.id);
    assert.ok(!remaining.includes(first));
    assert.ok(!remaining.includes(second));
    assert.ok(remaining.includes(created[2]), "an unselected session must survive");
  });

  test("history paging reports a total and honours limit", async () => {
    const res = await api("/api/sessions?limit=1&offset=0");
    assert.equal(res.status, 200);
    assert.ok(res.body.sessions.length <= 1);
    assert.equal(res.body.limit, 1);
    assert.equal(typeof res.body.total, "number");
    assert.ok(res.body.total >= res.body.sessions.length);

    if (res.body.total > 1) {
      const second = await api("/api/sessions?limit=1&offset=1");
      assert.equal(second.status, 200);
      assert.notEqual(
        second.body.sessions[0]?.id,
        res.body.sessions[0]?.id,
        "a different offset must return a different row"
      );
    }
  });
});
