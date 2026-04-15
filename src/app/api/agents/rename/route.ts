import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { oldName, newName } = await request.json();

  if (!oldName || !newName) {
    return NextResponse.json({ error: "oldName and newName required" }, { status: 400 });
  }

  const db = await ensureDb();
  const existing = await db.findAgentByName(oldName);
  if (!existing) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Check if newName conflicts with another agent
  const conflict = await db.findAgentByName(newName);
  if (conflict && conflict.id !== existing.id) {
    return NextResponse.json({ error: "An agent with this name already exists" }, { status: 409 });
  }

  // Update the agent's name — keep same id
  let config = {};
  try { config = JSON.parse(existing.config); } catch {}
  const updatedConfig = { ...config, name: newName };
  await db.updateAgent(existing.id, newName, JSON.stringify(updatedConfig), existing.status);

  return NextResponse.json({ success: true });
}
