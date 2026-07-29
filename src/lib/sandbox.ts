/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

import { getRuntimeConfig } from "./runtime-config";

const childProcess: any = require("child_process");
const fs: any = require("fs");
const path: any = require("path");
const net: any = require("net");

interface SandboxProcess {
  pid: number;
  port: number;
  logFile: string;
}

const runningProcesses: Map<string, SandboxProcess> = new Map();

function getLogsDir(): string {
  const dir = path.join(process.cwd(), "data", "sandbox-logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function findFreePort(start = 3100): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(start, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      if (start > 4000) return reject(new Error("No free port found"));
      findFreePort(start + 1).then(resolve, reject);
    });
  });
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}

export function getProcessInfo(name: string): SandboxProcess | null {
  return runningProcesses.get(name) || null;
}

/**
 * Where a sandbox records the PID of its dev server.
 *
 * The in-memory map is lost whenever the dashboard reloads, and the `/proc` scan
 * below only exists on Linux — so on macOS a restarted dashboard could neither
 * see a running sandbox nor stop one. Every redeploy then leaked the old server,
 * moved to a new port, and left the database pointing at a port nothing was
 * listening on: the sandbox reads as "not found or not running" while its old
 * copy is still serving. A PID file is how `agent-runner.ts` already solves the
 * same problem.
 */
function pidFilePath(name: string): string {
  return path.join(getSandboxesRoot(), name, "sandbox.pid");
}

function writeSandboxPid(name: string, pid: number): void {
  try {
    fs.writeFileSync(pidFilePath(name), String(pid));
  } catch {}
}

function readSandboxPid(name: string): number | null {
  try {
    const file = pidFilePath(name);
    if (!fs.existsSync(file)) return null;
    const pid = parseInt(fs.readFileSync(file, "utf-8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** PIDs whose cwd is this sandbox's directory. Linux only — `/proc` is the source. */
function pidsByCwd(sandboxDir: string): number[] {
  const found: number[] = [];
  try {
    for (const pid of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const cwd = fs.readlinkSync(path.join("/proc", pid, "cwd"));
        if (cwd === sandboxDir || cwd.startsWith(sandboxDir + "/")) found.push(Number(pid));
      } catch {}
    }
  } catch {}
  return found;
}

export function isRunning(name: string): boolean {
  const known = runningProcesses.get(name);
  if (known && isPidAlive(known.pid)) return true;
  if (known) runningProcesses.delete(name);

  // Survives a dashboard reload, on every platform.
  const filePid = readSandboxPid(name);
  if (filePid && isPidAlive(filePid)) return true;

  // Legacy fallback for a sandbox started before the PID file existed.
  const sandboxDir = path.join(getSandboxesRoot(), name);
  for (const pid of pidsByCwd(sandboxDir)) {
    const port = readPortFromCmdline(pid);
    if (port) {
      runningProcesses.set(name, { pid, port, logFile: path.join(getLogsDir(), `${name}.log`) });
    }
    return true;
  }
  return false;
}

function readPortFromCmdline(pid: number): number | null {
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf-8") as string;
    const match = cmdline.match(/-p\0?(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

export function getLogs(name: string, tail = 200): string {
  const proc = runningProcesses.get(name);
  const logFile = proc?.logFile || path.join(getLogsDir(), `${name}.log`);

  if (!fs.existsSync(logFile)) return "";

  const content = fs.readFileSync(logFile, "utf-8");
  const lines = content.split("\n");
  return lines.slice(-tail).join("\n");
}

function getSandboxesRoot(): string {
  const dir = path.join(process.cwd(), "data", "sandboxes");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Copies a template into a sandbox's own directory, symlinking the heavy parts.
 *
 * **Template files are refreshed on every deploy.** They used to be skipped when
 * they already existed, which froze a sandbox at whatever the template looked
 * like the day it was created: fixing a bug in the template, or adding a route to
 * it, could never reach an existing sandbox, and Restart looked like it did
 * nothing. Anything hand-edited inside `data/sandboxes/<name>` is therefore
 * overwritten — the sandbox directory is a build output, not a place to work.
 *
 * `.env.local` is the sandbox's own (written per deploy from its settings), and
 * `sandbox.pid` belongs to the running process, so neither comes from the
 * template.
 */
function provisionSandboxDir(srcDir: string, dstDir: string) {
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

  // NOTE: do NOT symlink .next — Next.js inlines NEXT_PUBLIC_* env vars at
  // build/compile time, and a shared .next would leak one sandbox's agent
  // name into all others. Each sandbox needs its own build cache.
  const SYMLINK = new Set(["node_modules", ".git"]);
  const SKIP = new Set([".env.local", "sandbox.json", "sandbox.pid", ".next"]);

  for (const entry of fs.readdirSync(srcDir)) {
    if (SKIP.has(entry)) continue;
    const src = path.join(srcDir, entry);
    const dst = path.join(dstDir, entry);

    const stat = fs.lstatSync(src);

    // A symlink that is already in place points at the same template dir; there
    // is nothing to refresh, and replacing it would churn node_modules.
    if (SYMLINK.has(entry) && fs.existsSync(dst)) continue;

    if (SYMLINK.has(entry)) {
      // Symlink large directories so we don't duplicate them
      try {
        fs.symlinkSync(src, dst, stat.isDirectory() ? "dir" : "file");
      } catch {}
      continue;
    }

    if (stat.isDirectory()) {
      // Replaced, not merged: a file the template no longer has would otherwise
      // linger, and in `app/` a lingering file is a route that still answers.
      try {
        fs.rmSync(dst, { recursive: true, force: true });
      } catch {}
      fs.mkdirSync(dst, { recursive: true });
      for (const sub of fs.readdirSync(src)) {
        copyRecursive(path.join(src, sub), path.join(dst, sub));
      }
    } else if (stat.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

function copyRecursive(src: string, dst: string) {
  const stat = fs.lstatSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const sub of fs.readdirSync(src)) {
      copyRecursive(path.join(src, sub), path.join(dst, sub));
    }
  } else if (stat.isFile()) {
    fs.copyFileSync(src, dst);
  }
}

export async function deploySandbox(
  name: string,
  template: string,
  livekitApiKey: string,
  livekitApiSecret: string,
  sandboxDomain?: string,
  agentName?: string
): Promise<{ port: number; url: string }> {
  const templateSrcDir = path.join(process.cwd(), "example", template);

  if (!fs.existsSync(path.join(templateSrcDir, "package.json"))) {
    throw new Error(`Template "${template}" not found. Clone it to example/${template} first.`);
  }

  // Per-sandbox directory under data/sandboxes/{name}
  const sandboxDir = path.join(getSandboxesRoot(), name);

  // Wipe any prior .next build — NEXT_PUBLIC_* env vars are inlined at
  // compile time, so reusing a stale cache would keep the old agent name.
  const nextPath = path.join(sandboxDir, ".next");
  if (fs.existsSync(nextPath)) {
    try {
      if (fs.lstatSync(nextPath).isSymbolicLink()) {
        fs.unlinkSync(nextPath);
      } else {
        fs.rmSync(nextPath, { recursive: true, force: true });
      }
    } catch {}
  }

  provisionSandboxDir(templateSrcDir, sandboxDir);

  // Reuse the previously-allocated port if it's still free. This keeps
  // existing browser cookies valid across redeploys instead of bumping
  // to a new port every time.
  let port: number | null = null;
  try {
    const { ensureDb } = await import("./db");
    const db = await ensureDb();
    const apps = await db.getAllSandboxApps();
    const existing = apps.find((a) => a.name === name);
    if (existing?.port && await isPortFree(existing.port)) {
      port = existing.port;
    }
  } catch {}
  if (!port) port = await findFreePort();
  const base = sandboxDomain || "http://localhost:3000";
  const url = `${base.replace(/\/$/, "")}/sandbox/${name}`;

  // The environment for THIS sandbox. The templates hand `LIVEKIT_URL` straight
  // to the browser from their /api/connection-details route, so it has to be the
  // public URL — not the dashboard's own `LIVEKIT_URL`, which under Docker or
  // Kubernetes is an internal hostname.
  const livekitWsUrl = getRuntimeConfig().livekitUrl;

  const sandboxEnv: Record<string, string> = {
    LIVEKIT_API_KEY: livekitApiKey,
    LIVEKIT_API_SECRET: livekitApiSecret,
    LIVEKIT_URL: livekitWsUrl,
    // The server-to-server address, for a template that calls the SDK from its
    // own routes (agent-assist lists participants to show a seat as taken). The
    // public URL above is a browser address and under Docker the container may
    // not resolve it at all.
    LIVEKIT_SERVER_URL: process.env.LIVEKIT_URL || livekitWsUrl,
    // Its own name, so a template can derive a stable room from it rather than
    // inventing a random one per visit — which is what lets two people reach the
    // same call from one link.
    SANDBOX_NAME: name,
    AGENT_NAME: agentName || "",
    NEXT_PUBLIC_AGENT_NAME: agentName || "",
  };

  // `.env.local` is written for the reader, but it is NOT what makes these
  // values take effect — the spawn below is. See the `env:` note there.
  fs.writeFileSync(
    path.join(sandboxDir, ".env.local"),
    Object.entries(sandboxEnv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"
  );

  // The same values as a file the template can read at request time.
  //
  // `.env.local` alone is not reliable enough for a value the app must get right:
  // a bundler is free to constant-fold `process.env.AGENT_NAME` into whatever it
  // knew at compile time, and a sandbox is compiled fresh every deploy while its
  // environment changes underneath. When that folding goes wrong the symptom is
  // brutal to diagnose — the process holds the correct value, a newly added route
  // reads it correctly, and the *existing* route reads empty, so the app quietly
  // dispatches no agent and transcribes nothing. A `readFileSync` cannot be
  // folded away.
  const sandboxConfig = {
    name,
    agentName: agentName || "",
    livekitUrl: livekitWsUrl,
    livekitServerUrl: process.env.LIVEKIT_URL || livekitWsUrl,
    apiKey: livekitApiKey,
    apiSecret: livekitApiSecret,
  };
  fs.writeFileSync(
    path.join(sandboxDir, "sandbox.json"),
    JSON.stringify(sandboxConfig, null, 2) + "\n"
  );

  // Reset next.config so sandbox runs at root.
  //
  // `devIndicators: false` removes the floating Next.js dev badge. A sandbox is
  // something you hand to another person — a support agent, a customer on a test
  // call — and the badge sits over the app's own controls. Sandboxes always run
  // via `next dev`, so without this it is always there.
  const configContent = `
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  devIndicators: false,
};
export default nextConfig;
`;
  fs.writeFileSync(path.join(sandboxDir, "next.config.ts"), configContent);

  const logFile = path.join(getLogsDir(), `${name}.log`);
  const logStream = fs.openSync(logFile, "w");

  // `sandboxEnv` is spread AFTER `process.env`, and that order is the whole
  // fix: the sandbox's values must override the dashboard's, not defer to them.
  //
  // Writing `.env.local` is not enough on its own. `@next/env` snapshots
  // `process.env` on first load and then takes a key from an env file *only when
  // it is absent from that snapshot* — an inherited variable is never
  // overwritten. So under Docker or Kubernetes, where the dashboard holds
  // `LIVEKIT_URL=http://livekit-server:7880` for its own SDK calls, the child
  // `next dev` inherited that internal hostname and silently discarded the
  // public URL written next to it. The template then handed the internal address
  // to the browser as `serverUrl`.
  //
  // That failure does not read as a configuration problem, because the
  // configuration was right: the console works (it goes through
  // `runtime-config.ts`), and only sandboxes break. Behind TLS it does not even
  // reach the network — an https page cannot open a `ws://` socket, so the
  // browser blocks it as mixed content and reports a `SecurityError` about
  // WebSocket construction rather than an unresolvable host.
  const child = childProcess.spawn("npx", ["next", "dev", "--turbopack", "-p", String(port)], {
    cwd: sandboxDir,
    env: { ...process.env, ...sandboxEnv, PORT: String(port) },
    stdio: ["ignore", logStream, logStream],
    detached: true,
  });
  child.unref();

  runningProcesses.set(name, { pid: child.pid!, port, logFile });
  writeSandboxPid(name, child.pid!);

  // Persist the fresh port so /enter works after the dashboard restarts
  // (in-memory map gets lost; DB is the durable source of truth).
  try {
    const { ensureDb } = await import("./db");
    const db = await ensureDb();
    await db.updateSandboxAppPort(name, port);
  } catch {}

  return { port, url };
}

export function stopSandbox(name: string): void {
  const kill = (pid: number) => {
    // The child is detached, so it leads its own process group — killing the
    // group takes `next dev` and the compiler workers it spawned. Falling back to
    // the bare PID would leave those holding the port.
    try { process.kill(-pid, "SIGKILL"); }
    catch { try { process.kill(pid, "SIGKILL"); } catch {} }
  };

  const proc = runningProcesses.get(name);
  if (proc) {
    kill(proc.pid);
    runningProcesses.delete(name);
  }

  // The dashboard may have reloaded since this sandbox started, losing the
  // in-memory PID. Without this the old server keeps the port and the next
  // deploy moves to a new one, so the database stops describing reality.
  const filePid = readSandboxPid(name);
  if (filePid && filePid !== proc?.pid) kill(filePid);
  try { fs.unlinkSync(pidFilePath(name)); } catch {}

  // Legacy fallback for anything started before the PID file existed (Linux).
  for (const pid of pidsByCwd(path.join(getSandboxesRoot(), name))) kill(pid);
}

export function deleteSandboxDir(name: string): void {
  const sandboxDir = path.join(getSandboxesRoot(), name);
  if (fs.existsSync(sandboxDir)) {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  }
}
