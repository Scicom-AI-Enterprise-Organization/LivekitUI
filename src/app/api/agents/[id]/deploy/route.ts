import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { deployAgent } from "@/lib/agent-runner";

export async function POST(
  request: NextRequest,
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
  const { pythonCode } = await request.json();

  if (!pythonCode) {
    return NextResponse.json({ error: "pythonCode is required" }, { status: 400 });
  }

  const db = await ensureDb();
  const agent = await db.findAgentByName(id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Load secrets from agent_secrets table
  const dbSecrets = await db.getAgentSecrets(id);
  const secretsMap: Record<string, string> = {};
  for (const s of dbSecrets) {
    secretsMap[s.key] = s.value;
  }

  try {
    const { pid, logFile } = await deployAgent(id, pythonCode, secretsMap);

    // Update agent status to 'deployed'
    await db.updateAgent(agent.id, agent.name, agent.config, "deployed");

    return NextResponse.json({ pid, logFile, status: "deployed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
