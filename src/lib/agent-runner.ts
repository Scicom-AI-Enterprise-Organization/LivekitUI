/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

const childProcess: any = require("child_process");
const fs: any = require("fs");
const path: any = require("path");

interface AgentProcess {
  pid: number;
  logFile: string;
  startedAt: number;
}

const runningAgents: Map<string, AgentProcess> = new Map();

function getAgentsRoot(): string {
  const dir = path.join(process.cwd(), "data", "agents");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAgentDir(name: string): string {
  const dir = path.join(getAgentsRoot(), name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getLogsDir(): string {
  const dir = path.join(process.cwd(), "data", "agent-logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getPythonBin(): string {
  // Use the venv from example/agent-starter-python
  const venvPython = path.join(
    process.cwd(),
    "example",
    "agent-starter-python",
    "venv",
    "bin",
    "python3"
  );
  if (!fs.existsSync(venvPython)) {
    throw new Error(
      "Python venv not found. Set up example/agent-starter-python first:\n  cd example/agent-starter-python && python3.10 -m venv venv && source venv/bin/activate && pip install 'livekit-agents[openai,silero]~=1.5' python-dotenv"
    );
  }
  return venvPython;
}

function pidFilePath(name: string): string {
  return path.join(getAgentsRoot(), name, "agent.pid");
}

function writePidFile(name: string, pid: number) {
  try {
    fs.writeFileSync(pidFilePath(name), String(pid));
  } catch {}
}

function readPidFile(name: string): number | null {
  try {
    const p = pidFilePath(name);
    if (!fs.existsSync(p)) return null;
    const pid = parseInt(fs.readFileSync(p, "utf-8").trim(), 10);
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

export function isAgentRunning(name: string): boolean {
  // In-memory first
  const proc = runningAgents.get(name);
  if (proc && isPidAlive(proc.pid)) return true;
  if (proc) runningAgents.delete(name);

  // Fallback: PID file on disk (survives dev server reloads)
  const filePid = readPidFile(name);
  if (filePid && isPidAlive(filePid)) return true;

  return false;
}

export function getAgentProcess(name: string): AgentProcess | null {
  if (!isAgentRunning(name)) return null;
  return runningAgents.get(name) || null;
}

export function getAgentLogs(name: string, tail = 200): string {
  const proc = runningAgents.get(name);
  const logFile = proc?.logFile || path.join(getLogsDir(), `${name}.log`);
  if (!fs.existsSync(logFile)) return "";
  const content = fs.readFileSync(logFile, "utf-8");
  const lines = content.split("\n");
  return lines.slice(-tail).join("\n");
}

export function stopAgent(name: string): void {
  // In-memory process (current dev server session)
  const proc = runningAgents.get(name);
  if (proc) {
    try { process.kill(-proc.pid, "SIGTERM"); }
    catch { try { process.kill(proc.pid, "SIGTERM"); } catch {} }
    runningAgents.delete(name);
  }

  // Also kill via PID file (survives dev server restarts)
  const filePid = readPidFile(name);
  if (filePid && isPidAlive(filePid)) {
    try { process.kill(-filePid, "SIGTERM"); }
    catch { try { process.kill(filePid, "SIGTERM"); } catch {} }
  }
  try { fs.unlinkSync(pidFilePath(name)); } catch {}
}

export function deleteAgentFiles(name: string): void {
  const agentDir = path.join(getAgentsRoot(), name);
  const logFile = path.join(getLogsDir(), `${name}.log`);
  if (fs.existsSync(agentDir)) {
    try { fs.rmSync(agentDir, { recursive: true, force: true }); } catch {}
  }
  if (fs.existsSync(logFile)) {
    try { fs.unlinkSync(logFile); } catch {}
  }
}

export async function deployAgent(
  name: string,
  pythonCode: string,
  secrets: Record<string, string>
): Promise<{ pid: number; logFile: string }> {
  // Stop existing instance first
  if (isAgentRunning(name)) {
    stopAgent(name);
  }

  const pythonBin = getPythonBin();
  const agentDir = getAgentDir(name);
  const agentFile = path.join(agentDir, "agent.py");

  // Write the generated agent code (one per agent dir)
  fs.writeFileSync(agentFile, pythonCode);

  // Write per-agent .env.local
  const envPath = path.join(agentDir, ".env.local");
  const envContent = Object.entries({
    LIVEKIT_URL: process.env.LIVEKIT_URL || "ws://localhost:7880",
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY || "",
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET || "",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    ...secrets,
  })
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  fs.writeFileSync(envPath, envContent);

  const logFile = path.join(getLogsDir(), `${name}.log`);
  const logStream = fs.openSync(logFile, "w");

  const child = childProcess.spawn(
    pythonBin,
    [agentFile, "dev"],
    {
      cwd: agentDir,
      env: { ...process.env, ...secrets },
      stdio: ["ignore", logStream, logStream],
      detached: true,
    }
  );
  child.unref();

  runningAgents.set(name, {
    pid: child.pid!,
    logFile,
    startedAt: Date.now(),
  });
  writePidFile(name, child.pid!);

  return { pid: child.pid!, logFile };
}
