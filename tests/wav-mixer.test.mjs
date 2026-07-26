import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMixer, createWavWriter, SAMPLE_RATE } from "../observer/wav-mixer.mjs";

/**
 * The mixer is the one piece of the session observer that is pure enough to test
 * without a LiveKit server, and the one where an off-by-one silently shifts a
 * whole recording out of sync with its transcript. So it gets real coverage.
 */

/** Collects the PCM a mixer emits, as Int16 samples. */
function collector() {
  const chunks = [];
  return {
    write: (chunk) => chunks.push(Buffer.from(chunk)),
    samples() {
      const joined = Buffer.concat(chunks);
      const out = new Int16Array(joined.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = joined.readInt16LE(i * 2);
      return out;
    },
  };
}

const tone = (length, value) => Int16Array.from({ length }, () => value);

describe("wav mixer", () => {
  test("one track comes back unchanged", () => {
    const sink = collector();
    const mixer = createMixer({ write: sink.write, windowMs: 100 });

    mixer.add("a", tone(4800, 1000), 0);
    mixer.add("a", tone(4800, 2000), 0); // offset ignored after the first frame
    const { samples, durationMs } = mixer.finish();

    assert.equal(samples, 9600);
    assert.equal(durationMs, 200);
    const out = sink.samples();
    assert.equal(out.length, 9600);
    assert.equal(out[0], 1000);
    assert.equal(out[4799], 1000);
    assert.equal(out[4800], 2000);
    assert.equal(out[9599], 2000);
  });

  test("overlapping tracks are summed and clipped into int16", () => {
    const sink = collector();
    const mixer = createMixer({ write: sink.write, windowMs: 100 });

    mixer.add("agent", tone(480, 20000), 0);
    mixer.add("caller", tone(480, 20000), 0);
    mixer.finish();

    const out = sink.samples();
    assert.equal(out.length, 480);
    // 40000 would wrap as int16; the mixer clips instead.
    assert.equal(out[0], 32767);
  });

  test("a track that joins late is padded with silence, not shifted forward", () => {
    const sink = collector();
    const mixer = createMixer({ write: sink.write, windowMs: 50 });

    // Joining a full second in — far beyond one 50 ms mixing window.
    const offset = SAMPLE_RATE;
    mixer.add("late", tone(480, 500), offset);
    mixer.finish();

    const out = sink.samples();
    assert.equal(out.length, offset + 480);
    assert.equal(out[0], 0, "leading gap must be silence");
    assert.equal(out[offset - 1], 0);
    assert.equal(out[offset], 500, "audio must land at its arrival offset");
  });

  test("two tracks keep their own alignment across a flush", () => {
    const sink = collector();
    const mixer = createMixer({ write: sink.write, windowMs: 20 });

    // 100 ms of agent audio forces several flushes at a 20 ms window.
    for (let i = 0; i < 10; i++) mixer.add("agent", tone(480, 100), 0);
    // The caller starts halfway through, once the front is already written out.
    mixer.add("caller", tone(480, 200), 480 * 5);
    mixer.finish();

    const out = sink.samples();
    assert.equal(out.length, 4800);
    assert.equal(out[0], 100, "agent only at the start");
    assert.equal(out[480 * 5], 100, "a late frame behind the window is dropped, not misplaced");
    assert.equal(out[4799], 100);
  });

  test("audio past the cap is dropped and reported", () => {
    const sink = collector();
    const mixer = createMixer({ write: sink.write, windowMs: 20, maxDurationMs: 100 });

    mixer.add("a", tone(4800, 300), 0); // 100 ms — exactly the cap
    assert.equal(mixer.capped, false);
    mixer.add("a", tone(480, 300), 0); // past it
    assert.equal(mixer.capped, true);

    const { durationMs } = mixer.finish();
    assert.equal(durationMs, 100);
  });

  test("wav header is patched with the real length on close", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wav-")), "session.wav");
    const writer = createWavWriter(file);

    const pcm = Buffer.alloc(960 * 2);
    writer.write(pcm);
    writer.write(pcm);
    const { bytes, dataBytes } = writer.close();

    assert.equal(dataBytes, 3840);
    assert.equal(bytes, 3884);
    assert.equal(fs.statSync(file).size, 3884);

    const head = fs.readFileSync(file);
    assert.equal(head.toString("ascii", 0, 4), "RIFF");
    assert.equal(head.toString("ascii", 8, 12), "WAVE");
    assert.equal(head.readUInt32LE(4), 3876, "RIFF size is everything after the first 8 bytes");
    assert.equal(head.readUInt16LE(22), 1, "mono");
    assert.equal(head.readUInt32LE(24), SAMPLE_RATE);
    assert.equal(head.readUInt16LE(34), 16, "16-bit samples");
    assert.equal(head.readUInt32LE(40), 3840, "data chunk size");

    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
