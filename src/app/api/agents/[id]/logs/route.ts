import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAgentLogTail, isAgentRunning } from "@/lib/agent-runner";
import { DEFAULT_TAIL, TAIL_SIZES, isTailSize } from "@/lib/log-tail";

/**
 * GET /api/agents/{name}/logs — the tail of an agent's log.
 *
 * ?tail=10kb|50kb|100kb|all — defaults to 10kb so opening the viewer on a
 * long-running agent stays cheap. The viewer polls this for a live tail.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requested = (request.nextUrl.searchParams.get("tail") || DEFAULT_TAIL).toLowerCase();
  if (!isTailSize(requested)) {
    return NextResponse.json(
      { error: `tail must be one of ${Object.keys(TAIL_SIZES).join(", ")}` },
      { status: 400 }
    );
  }

  const { id } = await params;
  const { logs, size, truncated } = getAgentLogTail(id, TAIL_SIZES[requested]);

  return NextResponse.json({
    logs,
    running: isAgentRunning(id),
    tail: requested,
    size,
    truncated,
  });
}
