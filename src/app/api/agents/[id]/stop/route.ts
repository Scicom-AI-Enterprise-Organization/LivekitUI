import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { stopAgent } from "@/lib/agent-runner";

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
  stopAgent(id);

  const db = await ensureDb();
  const agent = await db.findAgentByName(id);
  if (agent) {
    await db.updateAgent(agent.id, agent.name, agent.config, "draft");
  }

  return NextResponse.json({ success: true });
}
