import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const hours = parseInt(request.nextUrl.searchParams.get("hours") || "24", 10);

  const db = await ensureDb();
  const snapshots = await db.getAgentPerSnapshots(id, hours);

  const history = snapshots.map((s) => ({
    sessions: s.sessions,
    running: s.running ? 1 : 0,
    time: s.created_at,
  }));

  return NextResponse.json({ history });
}
