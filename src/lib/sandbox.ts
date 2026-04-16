/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

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

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}

export function getProcessInfo(name: string): SandboxProcess | null {
  return runningProcesses.get(name) || null;
}

export function isRunning(name: string): boolean {
  if (runningProcesses.has(name)) return true;

  // Fallback: the dashboard may have restarted, losing the in-memory map.
  // Scan /proc to see if any process has this sandbox's dir as its cwd.
  const sandboxDir = path.join(getSandboxesRoot(), name);
  try {
    for (const pid of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const cwd = fs.readlinkSync(path.join("/proc", pid, "cwd"));
        if (cwd === sandboxDir) {
          // Re-populate the in-memory map so future checks are fast
          const port = readPortFromCmdline(Number(pid));
          if (port) {
            runningProcesses.set(name, { pid: Number(pid), port, logFile: path.join(getLogsDir(), `${name}.log`) });
          }
          return true;
        }
      } catch {}
    }
  } catch {}
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

// Symlink-copy from source template dir to per-sandbox dir.
// We symlink heavy dirs (node_modules, .next) and copy the rest (so each
// sandbox has its own .env.local, next.config.ts, source code, etc.)
function provisionSandboxDir(srcDir: string, dstDir: string) {
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

  // NOTE: do NOT symlink .next — Next.js inlines NEXT_PUBLIC_* env vars at
  // build/compile time, and a shared .next would leak one sandbox's agent
  // name into all others. Each sandbox needs its own build cache.
  const SYMLINK = new Set(["node_modules", ".git"]);
  const SKIP = new Set([".env.local"]);

  for (const entry of fs.readdirSync(srcDir)) {
    if (SKIP.has(entry)) continue;
    const src = path.join(srcDir, entry);
    const dst = path.join(dstDir, entry);

    if (fs.existsSync(dst)) continue;

    const stat = fs.lstatSync(src);

    if (SYMLINK.has(entry)) {
      // Symlink large directories so we don't duplicate them
      try {
        fs.symlinkSync(src, dst, stat.isDirectory() ? "dir" : "file");
      } catch {}
      continue;
    }

    if (stat.isDirectory()) {
      // Recursively copy directories
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

  // Write .env.local for THIS sandbox
  const livekitWsUrl =
    process.env.NEXT_PUBLIC_LIVEKIT_URL ||
    process.env.LIVEKIT_URL ||
    "ws://localhost:7880";

  const envContent = [
    `LIVEKIT_API_KEY=${livekitApiKey}`,
    `LIVEKIT_API_SECRET=${livekitApiSecret}`,
    `LIVEKIT_URL=${livekitWsUrl}`,
    `AGENT_NAME=${agentName || ""}`,
    `NEXT_PUBLIC_AGENT_NAME=${agentName || ""}`,
    "",
  ].join("\n");

  fs.writeFileSync(path.join(sandboxDir, ".env.local"), envContent);

  // Reset next.config so sandbox runs at root
  const configContent = `
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {};
export default nextConfig;
`;
  fs.writeFileSync(path.join(sandboxDir, "next.config.ts"), configContent);

  const logFile = path.join(getLogsDir(), `${name}.log`);
  const logStream = fs.openSync(logFile, "w");

  const child = childProcess.spawn("npx", ["next", "dev", "--turbopack", "-p", String(port)], {
    cwd: sandboxDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", logStream, logStream],
    detached: true,
  });
  child.unref();

  runningProcesses.set(name, { pid: child.pid!, port, logFile });

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
  const proc = runningProcesses.get(name);
  if (proc) {
    try { process.kill(-proc.pid, "SIGKILL"); }
    catch { try { process.kill(proc.pid, "SIGKILL"); } catch {} }
    runningProcesses.delete(name);
  }

  // Fallback: the dashboard may have been restarted since the sandbox was
  // started, losing the in-memory PID. Kill any `next dev` process whose
  // cwd points at this sandbox's directory so we don't leak.
  const sandboxDir = path.join(getSandboxesRoot(), name);
  try {
    const procDir = "/proc";
    for (const pid of fs.readdirSync(procDir)) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const cwd = fs.readlinkSync(path.join(procDir, pid, "cwd"));
        if (cwd === sandboxDir || cwd.startsWith(sandboxDir + "/")) {
          try { process.kill(Number(pid), "SIGKILL"); } catch {}
        }
      } catch {}
    }
  } catch {}
}

export function deleteSandboxDir(name: string): void {
  const sandboxDir = path.join(getSandboxesRoot(), name);
  if (fs.existsSync(sandboxDir)) {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  }
}
