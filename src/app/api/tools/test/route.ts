import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  ToolTestInputError,
  runHttpToolTest,
  runMcpServerTest,
} from "@/lib/tool-test";
import type { HttpTool, McpServer } from "@/lib/tools";

/**
 * POST /api/tools/test — try a tool definition before it is saved.
 *
 * The request is built the way the generated agent builds it, so a tool that
 * works here works in a call. Reaching an operator-supplied URL from the server
 * is admin-only and time-boxed, like `providers/test`.
 *
 * Body: { kind: "http", config, args } | { kind: "mcp", config }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { kind?: string; config?: unknown; args?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { kind, config, args } = body;

  if (kind === "client") {
    return NextResponse.json(
      {
        error:
          "A client tool runs in the frontend session, so there is nothing for the server to call. Check the definition here and try it in a live session.",
      },
      { status: 400 }
    );
  }
  if (kind !== "http" && kind !== "mcp") {
    return NextResponse.json({ error: 'kind must be "http" or "mcp"' }, { status: 400 });
  }

  try {
    const result =
      kind === "http"
        ? await runHttpToolTest(config as HttpTool, args ?? {})
        : await runMcpServerTest(config as McpServer);
    return NextResponse.json(result);
  } catch (err) {
    // Bad input is the caller's to fix; a failed attempt is reported as a
    // result, not an error, so the dialog can show what came back.
    if (err instanceof ToolTestInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
