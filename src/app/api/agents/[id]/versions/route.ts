import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = await ensureDb();
  const versions = await db.getAgentVersions(id);

  return NextResponse.json({
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      deployerEmail: v.deployer_email,
      deployerName: v.deployer_name,
      createdAt: v.created_at,
    })),
  });
}
