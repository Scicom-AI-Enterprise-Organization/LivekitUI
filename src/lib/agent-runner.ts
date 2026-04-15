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

function getAgentsDir(): string {
  const dir = path.join(process.cwd(), "data", "agents");
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

export function isAgentRunning(name: string): boolean {
  const proc = runningAgents.get(name);
  if (!proc) return false;
  // Check if the PID is actually alive
  try {
    process.kill(proc.pid, 0);
    return true;
  } catch {
    runningAgents.delete(name);
    return false;
  }
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
  const proc = runningAgents.get(name);
  if (proc) {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      try { process.kill(proc.pid, "SIGTERM"); } catch {}
    }
    runningAgents.delete(name);
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
  const agentsDir = getAgentsDir();
  const agentFile = path.join(agentsDir, `${name}.py`);

  // Write the generated agent code
  fs.writeFileSync(agentFile, pythonCode);

  // Write an .env.local next to the agent file so dotenv picks it up
  const envPath = path.join(agentsDir, ".env.local");
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
      cwd: agentsDir,
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

  return { pid: child.pid!, logFile };
}
