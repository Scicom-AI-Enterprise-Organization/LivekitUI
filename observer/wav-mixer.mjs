/**
 * Mixes several live audio tracks into one mono WAV, incrementally.
 *
 * The observer subscribes to every audio track in a room — the agent, a browser
 * mic, a phone caller — and each arrives as its own stream of frames. They have
 * to end up on a single timeline, because the whole point of the recording is to
 * line up against the transcript and the event log.
 *
 * Frames are placed by *arrival time*, not by concatenation: a track that joins
 * ten seconds into a call starts ten seconds into the file. After its first
 * frame a track advances by its own sample count, so its audio stays internally
 * continuous even if the clock jitters.
 *
 * Mixing happens in a short sliding window (two seconds by default), and samples
 * older than the window are written out and forgotten. That keeps memory flat
 * for a call of any length — an hour of 48 kHz mono is 172 MB of PCM, which is
 * fine on disk and not fine in a Node heap.
 */

import fs from "node:fs";

export const SAMPLE_RATE = 48000;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;

/** Int16 range — the sum of several tracks has to be clipped back into it. */
const PCM_MIN = -32768;
const PCM_MAX = 32767;

/**
 * @param {object} opts
 * @param {(chunk: Buffer) => void} opts.write   Receives finished Int16LE PCM.
 * @param {number} [opts.sampleRate]
 * @param {number} [opts.windowMs]   How long a sample stays mixable.
 * @param {number} [opts.maxDurationMs] Hard stop, so one forgotten room cannot
 *   fill the disk. Audio past it is dropped and `capped` goes true.
 */
export function createMixer({
  write,
  sampleRate = SAMPLE_RATE,
  windowMs = 2000,
  maxDurationMs = 60 * 60 * 1000,
} = {}) {
  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const maxSamples = Math.max(1, Math.round((maxDurationMs / 1000) * sampleRate));

  // Sums, not Int16: three tracks at full scale must not wrap before clipping.
  const window = new Int32Array(windowSamples);
  /** Absolute sample index of `window[0]`. */
  let flushed = 0;
  /** Highest absolute index any track has written to. */
  let highWater = 0;
  let capped = false;

  /** Where each track is writing, keyed however the caller identifies them. */
  const cursors = new Map();

  function emit(count) {
    if (count <= 0) return;
    const out = Buffer.allocUnsafe(count * BYTES_PER_SAMPLE);
    for (let i = 0; i < count; i++) {
      const sum = window[i];
      out.writeInt16LE(sum < PCM_MIN ? PCM_MIN : sum > PCM_MAX ? PCM_MAX : sum, i * BYTES_PER_SAMPLE);
    }
    write(out);
    window.copyWithin(0, count);
    window.fill(0, windowSamples - count);
    flushed += count;
  }

  /**
   * Frees space so the window reaches `needEnd`, flushing what falls behind.
   *
   * Loops rather than flushing once: a track that joins a minute into the call
   * needs far more than one window of room, and every flush past the last real
   * sample writes the silence that keeps it aligned.
   */
  function makeRoomFor(needEnd) {
    while (needEnd > flushed + windowSamples) {
      emit(Math.min(needEnd - (flushed + windowSamples), windowSamples));
    }
  }

  return {
    get capped() {
      return capped;
    },

    /**
     * @param {string} trackId
     * @param {Int16Array} samples  Mono, at this mixer's sample rate.
     * @param {number} offsetSamples Where to start this track, used for its
     *   first frame only — afterwards the track follows its own sample count.
     */
    add(trackId, samples, offsetSamples) {
      if (samples.length === 0) return;

      let cursor = cursors.get(trackId);
      if (cursor === undefined) cursor = Math.max(0, Math.round(offsetSamples));

      if (cursor >= maxSamples) {
        capped = true;
        cursors.set(trackId, cursor + samples.length);
        return;
      }

      const end = cursor + samples.length;
      makeRoomFor(end);

      for (let i = 0; i < samples.length; i++) {
        const abs = cursor + i;
        // Already written out — a frame this late cannot be mixed any more.
        if (abs < flushed) continue;
        const slot = abs - flushed;
        if (slot >= windowSamples) break;
        window[slot] += samples[i];
      }

      cursors.set(trackId, end);
      if (end > highWater) highWater = end;
    },

    /** Flushes everything still in the window. Returns the length written. */
    finish() {
      const remaining = Math.min(highWater, flushed + windowSamples) - flushed;
      emit(Math.max(0, remaining));
      return { samples: flushed, durationMs: Math.round((flushed / sampleRate) * 1000) };
    },
  };
}

/**
 * A WAV file that can be written before its length is known.
 *
 * The header carries two byte counts, so it is stamped with placeholders up
 * front and patched on close — which is why this writes with a file descriptor
 * rather than a stream.
 */
export function createWavWriter(filePath, { sampleRate = SAMPLE_RATE, channels = 1 } = {}) {
  const fd = fs.openSync(filePath, "w");
  let dataBytes = 0;

  fs.writeSync(fd, header(0, sampleRate, channels), 0, WAV_HEADER_BYTES, 0);

  return {
    write(chunk) {
      fs.writeSync(fd, chunk, 0, chunk.length, WAV_HEADER_BYTES + dataBytes);
      dataBytes += chunk.length;
    },
    close() {
      fs.writeSync(fd, header(dataBytes, sampleRate, channels), 0, WAV_HEADER_BYTES, 0);
      fs.closeSync(fd);
      return { bytes: WAV_HEADER_BYTES + dataBytes, dataBytes };
    },
    get bytes() {
      return WAV_HEADER_BYTES + dataBytes;
    },
  };
}

function header(dataBytes, sampleRate, channels) {
  const buf = Buffer.alloc(WAV_HEADER_BYTES);
  const byteRate = sampleRate * channels * BYTES_PER_SAMPLE;

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(channels * BYTES_PER_SAMPLE, 32); // block align
  buf.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}
