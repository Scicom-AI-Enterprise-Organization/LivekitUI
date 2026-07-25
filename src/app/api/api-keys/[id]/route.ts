import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

/**
 * Revokes an issued key. The gateway reads the DB on every request with no
 * cache, so revocation takes effect on the next connection attempt — no
 * LiveKit server restart involved.
 *
 * ?hard=1 deletes the row outright instead of marking it revoked.
 */
export async function DELETE(
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
  const keyId = Number(id);
  if (!Number.isInteger(keyId)) {
    return NextResponse.json({ error: "Invalid key id" }, { status: 400 });
  }

  const db = await ensureDb();
  const existing = (await db.getAllApiKeys()).find((k) => k.id === keyId);
  if (!existing) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  if (request.nextUrl.searchParams.get("hard") === "1") {
    await db.deleteApiKey(keyId);
    return NextResponse.json({ success: true, deleted: true });
  }

  await db.revokeApiKey(keyId);
  return NextResponse.json({ success: true, revoked: true });
}
