import { ensureDb } from "./db";

/**
 * Whether the dashboard records sessions nobody had a browser tab open for.
 *
 * **Off by default, deliberately.** Turning it on means the server joins every
 * room livekit reports, subscribes to the audio, and writes a WAV plus a history
 * row for each one — including calls from real phone numbers. That is a decision
 * for whoever runs the deployment, not a default, so it lives behind a switch in
 * Settings → Project.
 *
 * The stored row is the only authority: no environment variable overrides it, so
 * "is capture on?" has exactly one answer and the switch always reflects it.
 */

export interface CaptureSettings {
  enabled: boolean;
  /** Mix and store the room's audio, not just the transcript and events. */
  audio: boolean;
  /** Hard stop per session, so one forgotten room cannot fill the disk. */
  maxMinutes: number;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  enabled: false,
  audio: true,
  maxMinutes: 60,
};

/** Bounds on the cap: long enough for a real call, short of unbounded. */
export const MIN_CAPTURE_MINUTES = 1;
export const MAX_CAPTURE_MINUTES = 12 * 60;

export function clampCaptureMinutes(value: unknown): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_CAPTURE_SETTINGS.maxMinutes;
  return Math.min(Math.max(parsed, MIN_CAPTURE_MINUTES), MAX_CAPTURE_MINUTES);
}

export async function loadCaptureSettings(): Promise<CaptureSettings> {
  const db = await ensureDb();
  const row = await db.getCaptureConfig();
  if (!row) return { ...DEFAULT_CAPTURE_SETTINGS };

  return {
    enabled: !!row.enabled,
    audio: !!row.capture_audio,
    maxMinutes: clampCaptureMinutes(row.max_minutes),
  };
}

export async function saveCaptureSettings(next: CaptureSettings): Promise<CaptureSettings> {
  const settings: CaptureSettings = {
    enabled: !!next.enabled,
    audio: !!next.audio,
    maxMinutes: clampCaptureMinutes(next.maxMinutes),
  };

  const db = await ensureDb();
  await db.saveCaptureConfig({
    enabled: settings.enabled,
    captureAudio: settings.audio,
    maxMinutes: settings.maxMinutes,
  });

  return settings;
}
