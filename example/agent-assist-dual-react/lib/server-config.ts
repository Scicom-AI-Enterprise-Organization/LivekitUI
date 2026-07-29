/**
 * Server-only view of the sandbox's configuration.
 *
 * Nothing here may be imported from a client component. `NEXT_PUBLIC_*` is
 * inlined by `next build`, so a value the browser needs has to travel from a
 * server component as a prop instead — see `app/page.tsx`.
 *
 * Values come from `sandbox.json`, which the dashboard writes next to
 * `.env.local` on every deploy, and fall back to the environment when that file
 * is absent (running this template by hand).
 *
 * Reading a file rather than trusting `process.env` is deliberate. A bundler may
 * constant-fold `process.env.AGENT_NAME` to whatever it knew when it compiled the
 * route, and a sandbox is compiled fresh on each deploy while its environment
 * changes underneath — which produced a genuinely nasty failure in the sibling
 * template: the process held the right value, a newly added route read it
 * correctly, and the existing route read empty, so the app dispatched no worker
 * and transcribed nothing with no error anywhere. `readFileSync` cannot be folded
 * away.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { DualConfig } from './types';

interface SandboxConfig {
  name: string;
  agentName: string;
  livekitUrl: string;
  livekitServerUrl: string;
  apiKey: string;
  apiSecret: string;
}

/** Re-read when the file changes; a deploy rewrites it and restarts us anyway. */
let cached: { mtimeMs: number; value: SandboxConfig } | null = null;

function fromFile(): SandboxConfig | null {
  const file = path.join(process.cwd(), 'sandbox.json');
  try {
    const { mtimeMs } = fs.statSync(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.value;
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as SandboxConfig;
    cached = { mtimeMs, value };
    return value;
  } catch {
    return null;
  }
}

export function sandboxConfig(): SandboxConfig {
  const file = fromFile();
  if (file) return file;
  return {
    name: (process.env.SANDBOX_NAME || '').trim(),
    agentName: (process.env.AGENT_NAME || '').trim(),
    livekitUrl: (process.env.LIVEKIT_URL || '').trim(),
    livekitServerUrl: (process.env.LIVEKIT_SERVER_URL || process.env.LIVEKIT_URL || '').trim(),
    apiKey: (process.env.LIVEKIT_API_KEY || '').trim(),
    apiSecret: (process.env.LIVEKIT_API_SECRET || '').trim(),
  };
}

/**
 * One room per sandbox, so a supervisor watching along only needs the same link.
 * `?room=` overrides it when several desks have to run side by side — which is
 * the realistic deployment, one room per agent.
 */
export function defaultRoomName(): string {
  const name = sandboxConfig().name.trim();
  return name ? `dual-${name}` : 'dual-assist-room';
}

/**
 * The address the *server* uses to reach livekit-server, which is not always the
 * one the browser uses: under Docker the public hostname may not resolve from
 * inside the container. Returns null when unset, so callers can degrade rather
 * than throw.
 */
export function serverApiUrl(): string | null {
  const raw = sandboxConfig().livekitServerUrl || sandboxConfig().livekitUrl;
  if (!raw) return null;
  return raw.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '');
}

export function dualConfig(room?: string): DualConfig {
  const cfg = sandboxConfig();
  return {
    serverUrl: cfg.livekitUrl,
    roomName: (room || '').trim() || defaultRoomName(),
    agentName: cfg.agentName,
  };
}
