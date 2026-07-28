import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { ensureDb } from "@/lib/db";
import { deploySandbox, stopSandbox } from "@/lib/sandbox";
import { ASSIST_TEMPLATE, deployAssistWorker, normalizeAssistConfig } from "@/lib/agent-assist";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = await ensureDb();
  const app = await db.getSandboxApp(parseInt(id, 10));
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let settings = {};
  try { settings = JSON.parse(app.settings || "{}"); } catch {}

  return NextResponse.json({
    app: {
      id: app.id,
      name: app.name,
      template: app.template,
      url: app.url,
      port: app.port,
      status: app.status,
      settings,
      createdAt: app.created_at,
    },
  });
}

export async function PATCH(
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
  const body = await request.json();
  const { settings } = body;

  if (!settings || typeof settings !== "object") {
    return NextResponse.json({ error: "settings is required" }, { status: 400 });
  }

  const db = await ensureDb();
  const app = await db.getSandboxApp(parseInt(id, 10));
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const incoming = settings as Record<string, unknown>;

  // The assist config is what the worker runs on, so it is validated here rather
  // than trusted from the dialog — every field of it ends up in the worker's
  // environment.
  if (app.template === ASSIST_TEMPLATE && incoming.assist) {
    incoming.assist = normalizeAssistConfig(incoming.assist);
  }

  await db.updateSandboxAppSettings(parseInt(id, 10), JSON.stringify(incoming));

  // A worker this sandbox owns has to be redeployed too: its models, turn
  // detector and prompt live in its `.env.local`, which is only written at
  // deploy. Saving the dialog and seeing nothing change would be the bug.
  let workerWarning: string | null = null;
  const ownedWorker = typeof incoming.assistWorker === "string" ? incoming.assistWorker : "";
  if (app.template === ASSIST_TEMPLATE && ownedWorker && incoming.assist) {
    try {
      await deployAssistWorker(app.name, normalizeAssistConfig(incoming.assist), {
        email: session.email,
        name: `${session.firstName} ${session.lastName}`.trim() || session.email,
      });
    } catch (err) {
      workerWarning = err instanceof Error ? err.message : String(err);
    }
  }

  // Always redeploy so .env.local reflects the saved settings (agent name,
  // etc.) and NEXT_PUBLIC_* env vars are re-inlined into the dev build.
  const newDispatch = (incoming.agentDispatch as string) || "";
  const agentName = newDispatch === "__auto__" ? "" : newDispatch;
  try {
    stopSandbox(app.name);
    await deploySandbox(
      app.name,
      app.template,
      process.env.LIVEKIT_API_KEY || "",
      process.env.LIVEKIT_API_SECRET || "",
      getRuntimeConfig().sandboxDomain,
      agentName
    );
  } catch (err) {
    return NextResponse.json({ success: true, warning: String(err), workerWarning });
  }

  return NextResponse.json({ success: true, redeployed: true, workerWarning });
}
