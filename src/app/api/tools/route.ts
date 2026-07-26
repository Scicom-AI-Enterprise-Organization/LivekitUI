import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb, type DbAgentTool } from "@/lib/db";
import { isValidToolName, type ToolKind } from "@/lib/tools";

const KINDS: ToolKind[] = ["http", "client", "mcp"];

function serialize(row: DbAgentTool) {
  let config: unknown = {};
  try {
    config = JSON.parse(row.config);
  } catch {
    // A corrupted row shouldn't take down the whole list.
  }
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /api/tools — the reusable tool library. ?kind=http|client|mcp filters. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kind = request.nextUrl.searchParams.get("kind") || undefined;
  if (kind && !KINDS.includes(kind as ToolKind)) {
    return NextResponse.json(
      { error: `kind must be one of ${KINDS.join(", ")}` },
      { status: 400 }
    );
  }

  const db = await ensureDb();
  const tools = (await db.getAgentTools(kind)).map(serialize);
  return NextResponse.json({ tools, total: tools.length });
}

/**
 * POST /api/tools — create or update a library entry, keyed on (kind, name).
 *
 * Body: { kind, name, description?, config }
 * Agents keep their own copy of a tool, so editing here does not change agents
 * that already imported it.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { kind?: string; name?: string; description?: string; config?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { kind, name, description = "", config } = body;

  if (!kind || !KINDS.includes(kind as ToolKind)) {
    return NextResponse.json(
      { error: `kind must be one of ${KINDS.join(", ")}` },
      { status: 400 }
    );
  }
  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!isValidToolName(name.trim())) {
    return NextResponse.json(
      { error: "name must start with a letter or underscore and contain no spaces — it becomes a function name for the model" },
      { status: 400 }
    );
  }
  if (!config || typeof config !== "object") {
    return NextResponse.json({ error: "config must be an object" }, { status: 400 });
  }

  // Shape checks per kind, so a broken tool can't reach an agent's generated code.
  const c = config as Record<string, unknown>;
  if (kind === "http" && !c.url) {
    return NextResponse.json({ error: "config.url is required for an HTTP tool" }, { status: 400 });
  }
  if (kind === "mcp" && !c.url) {
    return NextResponse.json({ error: "config.url is required for an MCP server" }, { status: 400 });
  }

  const db = await ensureDb();
  const row = await db.upsertAgentTool(
    kind,
    name.trim(),
    description,
    JSON.stringify({ ...c, name: name.trim() })
  );
  return NextResponse.json(serialize(row));
}
