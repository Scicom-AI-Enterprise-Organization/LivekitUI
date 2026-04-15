import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { stopAgent, deployAgent } from "@/lib/agent-runner";
import fs from "fs";
import path from "path";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;
  const db = await ensureDb();
  const agent = await db.findAgentByName(id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Read the previously generated python code from disk
  const agentFile = path.join(process.cwd(), "data", "agents", `${id}.py`);
  if (!fs.existsSync(agentFile)) {
    return NextResponse.json(
      { error: "No generated code found. Deploy the agent from the builder first." },
      { status: 400 }
    );
  }
  const pythonCode = fs.readFileSync(agentFile, "utf-8");

  // Load secrets
  const dbSecrets = await db.getAgentSecrets(id);
  const secretsMap: Record<string, string> = {};
  for (const s of dbSecrets) secretsMap[s.key] = s.value;

  stopAgent(id);
  try {
    const { pid } = await deployAgent(id, pythonCode, secretsMap);
    await db.updateAgent(agent.id, agent.name, agent.config, "deployed");
    return NextResponse.json({ pid, status: "restarted" });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
