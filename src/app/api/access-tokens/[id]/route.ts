import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

/**
 * Revokes a Bearer token. Takes effect on its next request — tokens are looked
 * up per call with no cache.
 *
 * ?hard=1 removes the row instead of keeping a revoked record. The test suite
 * uses it so repeated runs don't pile up dead tokens.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const tokenId = Number(id);
  if (!Number.isInteger(tokenId)) {
    return NextResponse.json({ error: "Invalid token id" }, { status: 400 });
  }

  const db = await ensureDb();
  const token = await db.findDashboardTokenById(tokenId);
  if (!token) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  // Members may only revoke their own tokens.
  const privileged = session.role === "owner" || session.role === "admin";
  if (!privileged && token.user_id !== session.id) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (request.nextUrl.searchParams.get("hard") === "1") {
    await db.deleteDashboardToken(tokenId);
    return NextResponse.json({ success: true, deleted: true });
  }

  await db.revokeDashboardToken(tokenId);
  return NextResponse.json({ success: true, revoked: true });
}
