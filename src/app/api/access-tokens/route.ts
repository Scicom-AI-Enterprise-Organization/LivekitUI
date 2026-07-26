import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { generateApiToken } from "@/lib/api-tokens";

/**
 * Bearer tokens for this REST API. Owners and admins see every token; members
 * see only their own.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDb();
  const privileged = session.role === "owner" || session.role === "admin";
  const rows = await db.getDashboardTokens(privileged ? undefined : session.id);

  return NextResponse.json({
    tokens: rows.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.token_prefix,
      owner: t.owner_email,
      createdAt: t.created_at,
      lastUsedAt: t.last_used_at,
      revokedAt: t.revoked_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let name: string | undefined;
  try {
    ({ name } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { token, prefix, hash } = generateApiToken();
  const db = await ensureDb();
  const row = await db.createDashboardToken(session.id!, name.trim(), prefix, hash);

  // The only time the token itself is returned.
  return NextResponse.json({
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    token,
    createdAt: row.created_at,
  });
}
