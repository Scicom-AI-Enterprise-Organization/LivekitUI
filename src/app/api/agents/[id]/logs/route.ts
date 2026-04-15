import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAgentLogs, isAgentRunning } from "@/lib/agent-runner";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const logs = getAgentLogs(id);
  const running = isAgentRunning(id);

  return NextResponse.json({ logs, running });
}
