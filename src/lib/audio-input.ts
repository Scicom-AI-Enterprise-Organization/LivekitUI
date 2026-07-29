/**
 * How much audio an agent is handed at a time — `AudioInputOptions.frame_size_ms`.
 *
 * Node-free on purpose: the agent builder and the assist sandbox's settings form
 * are both client components and import this, while the deploy paths on the
 * server read it too. Same rule as `providers.ts` — nothing from `fs`, `path` or
 * a server-only module.
 *
 * One chunk is **one call into the noise filter**, and from there into the VAD
 * and the STT stream, so the size is both the granularity of the filter's work
 * and the buffering sitting in front of everything downstream. It does not change
 * how a filter *processes*: GTCRN always works in 256-sample hops through a
 * 512-point window and adds its own 32 ms at 16 kHz, whatever it is handed. What
 * it changes is how often that work is scheduled — and how much audio waits
 * before any of it starts.
 */

/** The SDK's own default. 800 samples at 16 kHz, twenty chunks a second. */
export const DEFAULT_AUDIO_CHUNK_MS = 50;

/** The sizes worth offering, with what each one buys. */
export const AUDIO_CHUNK_OPTIONS: { ms: number; hint: string }[] = [
  { ms: 10, hint: "100 filter calls a second per speaker" },
  { ms: 20, hint: "50 a second" },
  { ms: 50, hint: "20 a second — the SDK default" },
  { ms: 100, hint: "10 a second, most buffering" },
];

/**
 * Coerces a stored value to one of the offered sizes.
 *
 * An allow-list rather than a range check, for the same reason the model plugins
 * are: this number is interpolated into generated Python and into a worker's
 * environment, and neither should be able to carry whatever a config blob
 * happens to hold.
 */
export function normalizeAudioChunkMs(value: unknown): number {
  const ms = typeof value === "number" ? value : Number(value);
  return AUDIO_CHUNK_OPTIONS.some((option) => option.ms === ms) ? ms : DEFAULT_AUDIO_CHUNK_MS;
}
