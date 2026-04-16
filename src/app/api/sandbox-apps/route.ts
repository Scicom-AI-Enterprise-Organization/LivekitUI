import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { deploySandbox, stopSandbox, isRunning, deleteSandboxDir } from "@/lib/sandbox";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDb();
  const apps = await db.getAllSandboxApps();

  const result = apps.map((a) => ({
    id: a.id,
    name: a.name,
    template: a.template,
    url: a.url,
    status: isRunning(a.name) ? "running" : "stopped",
    createdAt: a.created_at,
  }));

  return NextResponse.json({ apps: result });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { name, template, agentName } = await request.json();

  if (!name || !template) {
    return NextResponse.json({ error: "Name and template are required" }, { status: 400 });
  }

  try {
    const { url, port } = await deploySandbox(
      name,
      template,
      process.env.LIVEKIT_API_KEY || "",
      process.env.LIVEKIT_API_SECRET || "",
      process.env.NEXT_PUBLIC_SANDBOX_DOMAIN,
      agentName || ""
    );

    const db = await ensureDb();
    const app = await db.createSandboxApp(name, template, url, port);
    if (agentName) {
      await db.updateSandboxAppSettings(
        app.id,
        JSON.stringify({ agentDispatch: agentName, agentName })
      );
    }

    return NextResponse.json({
      app: {
        id: app.id,
        name: app.name,
        template: app.template,
        url: app.url,
        status: "running",
        createdAt: app.created_at,
        port,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("already exists")) {
      return NextResponse.json({ error: "An app with this name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id, name } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  stopSandbox(name);
  deleteSandboxDir(name);

  const db = await ensureDb();
  await db.deleteSandboxApp(id);

  return NextResponse.json({ success: true });
}
