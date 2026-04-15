import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const db = await ensureDb();
  const agent = await db.findAgentByName(name);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(agent.config);
  } catch {}

  return NextResponse.json({
    agent: {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      config,
      createdAt: agent.created_at,
      updatedAt: agent.updated_at,
    },
  });
}
