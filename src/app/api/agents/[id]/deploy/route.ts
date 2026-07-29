import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { deployAgent } from "@/lib/agent-runner";
import { redeployWorkersSourcedFrom } from "@/lib/agent-assist";
import { redeployDualWorkersSourcedFrom } from "@/lib/agent-assist-dual";

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

  // Project-wide secrets (Settings > Secrets) first — these hold the API keys
  // that providers reference. Agent-specific secrets override them.
  const secretsMap: Record<string, string> = {};
  for (const s of await db.getAllSecrets()) {
    secretsMap[s.name] = s.value;
  }
  for (const s of await db.getAgentSecrets(id)) {
    secretsMap[s.key] = s.value;
  }

  try {
    const { pid, logFile } = await deployAgent(id, pythonCode, secretsMap);

    // Update agent status to 'deployed'
    await db.updateAgent(agent.id, agent.name, agent.config, "deployed");

    // Record this deployment as a new version
    const deployerName = `${session.firstName} ${session.lastName}`.trim() || session.email;
    const version = await db.addAgentVersion(id, session.email, deployerName);

    // An assist worker that takes its models from this agent has them baked into an
    // `.env.local` written at *its* deploy, so it has to be redeployed too or "the
    // agent is the source of truth" quietly stops being true. Both flavours are
    // swept — the per-participant transcriber and the dual-track one — since either
    // can name this agent as its source.
    const deployer = { email: session.email, name: deployerName };
    const assistWorkers = [
      ...(await redeployWorkersSourcedFrom(id, deployer)),
      ...(await redeployDualWorkersSourcedFrom(id, deployer)),
    ];

    return NextResponse.json({
      pid,
      logFile,
      status: "deployed",
      version,
      assistWorkers: assistWorkers.length > 0 ? assistWorkers : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
