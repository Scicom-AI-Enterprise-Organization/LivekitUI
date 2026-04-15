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

export function getProcessInfo(name: string): SandboxProcess | null {
  return runningProcesses.get(name) || null;
}

export function isRunning(name: string): boolean {
  return runningProcesses.has(name);
}

export function getLogs(name: string, tail = 200): string {
  const proc = runningProcesses.get(name);
  const logFile = proc?.logFile || path.join(getLogsDir(), `${name}.log`);

  if (!fs.existsSync(logFile)) return "";

  const content = fs.readFileSync(logFile, "utf-8");
  const lines = content.split("\n");
  return lines.slice(-tail).join("\n");
}

export async function deploySandbox(
  name: string,
  template: string,
  livekitApiKey: string,
  livekitApiSecret: string,
  sandboxDomain?: string,
  agentName?: string
): Promise<{ port: number; url: string }> {
  const templateDir = path.join(process.cwd(), "example", template);

  if (!fs.existsSync(path.join(templateDir, "package.json"))) {
    throw new Error(`Template "${template}" not found. Clone it to example/${template} first.`);
  }

  const port = await findFreePort();
  const base = sandboxDomain || "http://localhost:3000";
  const url = `${base.replace(/\/$/, "")}/sandbox/${name}`;

  // Write .env.local
  const envContent = [
    `LIVEKIT_API_KEY=${livekitApiKey}`,
    `LIVEKIT_API_SECRET=${livekitApiSecret}`,
    `LIVEKIT_URL=ws://localhost:7880`,
    `AGENT_NAME=${agentName || ""}`,
    `NEXT_PUBLIC_AGENT_NAME=${agentName || ""}`,
    "",
  ].join("\n");

  fs.writeFileSync(path.join(templateDir, ".env.local"), envContent);

  // Reset next.config to no basePath — the sandbox runs on its own port at /
  const configContent = `
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {};
export default nextConfig;
`;
  fs.writeFileSync(path.join(templateDir, "next.config.ts"), configContent);

  // Log file for this sandbox
  const logFile = path.join(getLogsDir(), `${name}.log`);
  const logStream = fs.openSync(logFile, "w");

  // Start dev server with logs piped to file
  const child = childProcess.spawn("npx", ["next", "dev", "--turbopack", "-p", String(port)], {
    cwd: templateDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", logStream, logStream],
    detached: true,
  });
  child.unref();

  runningProcesses.set(name, { pid: child.pid!, port, logFile });

  return { port, url };
}

export function stopSandbox(name: string): void {
  const proc = runningProcesses.get(name);
  if (proc) {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {}
    runningProcesses.delete(name);
  }
}
