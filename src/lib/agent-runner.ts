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

export function getAgentPid(name: string): number | null {
  const proc = runningAgents.get(name);
  if (proc && isPidAlive(proc.pid)) return proc.pid;
  const filePid = readPidFile(name);
  if (filePid && isPidAlive(filePid)) return filePid;
  return null;
}

// Extract the LiveKit worker ID (e.g. AW_uCjXyNwzLLQF) that the Python
// agent logs on registration: `registered worker {"id": "AW_..."}`
export function getAgentWorkerId(name: string): string | null {
  const logFile = path.join(getLogsDir(), `${name}.log`);
  if (!fs.existsSync(logFile)) return null;
  try {
    const content = fs.readFileSync(logFile, "utf-8") as string;
    // Scan bottom-up for the most recent registration line.
    const matches = content.match(/"id":\s*"(AW_[A-Za-z0-9]+)"/g);
    if (!matches || matches.length === 0) return null;
    const last = matches[matches.length - 1];
    const m = last.match(/"(AW_[A-Za-z0-9]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Real-process metrics (Linux /proc-based)
// ---------------------------------------------------------------------------

function getPidForName(name: string): number | null {
  const proc = runningAgents.get(name);
  if (proc && isPidAlive(proc.pid)) return proc.pid;
  const filePid = readPidFile(name);
  if (filePid && isPidAlive(filePid)) return filePid;
  return null;
}

function readProcStat(pid: number): { utime: number; stime: number; starttime: number } | null {
  try {
    const content = fs.readFileSync(`/proc/${pid}/stat`, "utf-8") as string;
    // The 2nd field is comm in parens which can contain spaces. Skip past last ')'.
    const lastParen = content.lastIndexOf(")");
    const fields = content.slice(lastParen + 2).split(" ");
    // fields[0] is state. utime is field 14 in stat (1-indexed from comm).
    // After our slice: state=0, ppid=1, ... utime=11, stime=12, ... starttime=19
    return {
      utime: parseInt(fields[11], 10) || 0,
      stime: parseInt(fields[12], 10) || 0,
      starttime: parseInt(fields[19], 10) || 0,
    };
  } catch {
    return null;
  }
}

function readBootTime(): number {
  try {
    const stat = fs.readFileSync("/proc/stat", "utf-8") as string;
    const m = stat.match(/btime\s+(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

function readVmRssKb(pid: number): number {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf-8") as string;
    const m = status.match(/VmRSS:\s+(\d+) kB/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

function readSystemMemKb(): number {
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf-8") as string;
    const m = meminfo.match(/MemTotal:\s+(\d+) kB/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

// Per-process CPU sampler (delta-based)
const cpuSampleCache = new Map<number, { time: number; total: number }>();
function sampleCpuPercent(pid: number): number {
  const stat = readProcStat(pid);
  if (!stat) return 0;
  const total = stat.utime + stat.stime;
  const now = Date.now();
  const prev = cpuSampleCache.get(pid);
  cpuSampleCache.set(pid, { time: now, total });
  if (!prev) return 0;
  const dtMs = now - prev.time;
  if (dtMs <= 0) return 0;
  // Clock ticks per second (typical 100 on Linux)
  const HZ = 100;
  const cpuMs = ((total - prev.total) / HZ) * 1000;
  const pct = (cpuMs / dtMs) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// Parse LLM TTFT (time-to-first-token) from agent logs.
// livekit-agents emits via `logger.info("LLM metrics", extra={ttft: 0.42, ...})`
// which renders depending on the log formatter. Examples seen in the wild:
//   "ttft": 0.42            (JSON)
//   'ttft': 0.42            (Python dict repr)
//   ttft=0.42               (extra= kwargs)
//   ttft=0.42s / ttft: 0.42s (human)
function parseLlmLatencies(name: string, sampleLines = 1000): number[] {
  const logs = getAgentLogs(name, sampleLines);
  const out: number[] = [];
  for (const line of logs.split("\n")) {
    // Skip non-LLM lines for performance/accuracy
    if (!/ttft/i.test(line)) continue;
    // Skip RealtimeModel lines if you want only LLM; comment out to include both
    // if (/RealtimeModel/.test(line)) continue;

    // Match any of: "ttft":0.42 | 'ttft':0.42 | ttft=0.42 | ttft: 0.42
    const m = line.match(/['"]?ttft['"]?\s*[:=]\s*([\d.]+)\s*(ms|s)?/i);
    if (!m) continue;
    const value = parseFloat(m[1]);
    const unit = (m[2] || "s").toLowerCase();
    const ms = unit === "ms" ? value : value * 1000;
    if (Number.isFinite(ms) && ms >= 0) out.push(ms);
  }
  return out;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

export interface AgentMetrics {
  uptimeSeconds: number;
  uptimeReadable: string;
  cpuPercent: number;
  memoryMb: number;
  memoryPercent: number;
  llmLatency: { p50: number; p90: number; p99: number; samples: number } | null;
}

export function getAgentMetrics(name: string): AgentMetrics | null {
  const pid = getPidForName(name);
  if (!pid) return null;

  // Uptime via /proc/[pid]/stat starttime + boot time
  let uptimeSeconds = 0;
  const stat = readProcStat(pid);
  const boot = readBootTime();
  if (stat && boot) {
    const HZ = 100;
    const startEpoch = boot + stat.starttime / HZ;
    uptimeSeconds = Math.max(0, Math.floor(Date.now() / 1000 - startEpoch));
  }

  // Fall back to in-memory startedAt for non-Linux dev
  if (!uptimeSeconds) {
    const proc = runningAgents.get(name);
    if (proc) uptimeSeconds = Math.floor((Date.now() - proc.startedAt) / 1000);
  }

  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const mins = Math.floor((uptimeSeconds % 3600) / 60);
  const secs = uptimeSeconds % 60;
  const uptimeReadable = days > 0
    ? `${days}d ${hours}h`
    : hours > 0
    ? `${hours}h ${mins}m`
    : mins > 0
    ? `${mins}m ${secs}s`
    : `${secs}s`;

  const cpuPercent = sampleCpuPercent(pid);
  const memoryKb = readVmRssKb(pid);
  const memoryMb = Math.round(memoryKb / 1024);
  const totalKb = readSystemMemKb();
  const memoryPercent = totalKb > 0 ? Math.round((memoryKb / totalKb) * 100 * 10) / 10 : 0;

  const ttftSamples = parseLlmLatencies(name);
  const llmLatency = ttftSamples.length > 0
    ? {
        p50: percentile(ttftSamples, 50),
        p90: percentile(ttftSamples, 90),
        p99: percentile(ttftSamples, 99),
        samples: ttftSamples.length,
      }
    : null;

  return {
    uptimeSeconds,
    uptimeReadable,
    cpuPercent,
    memoryMb,
    memoryPercent,
    llmLatency,
  };
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
