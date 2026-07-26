import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

/**
 * DELETE /api/tools/{id} — remove a library entry.
 *
 * Agents that already imported this tool keep their own copy and are
 * unaffected.
 */
export async function DELETE(
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
  const toolId = Number(id);
  if (!Number.isInteger(toolId)) {
    return NextResponse.json({ error: "Invalid tool id" }, { status: 400 });
  }

  const db = await ensureDb();
  const tool = await db.findAgentToolById(toolId);
  if (!tool) {
    return NextResponse.json({ error: "Tool not found" }, { status: 404 });
  }

  await db.deleteAgentTool(toolId);
  return NextResponse.json({ success: true, deleted: true });
}
