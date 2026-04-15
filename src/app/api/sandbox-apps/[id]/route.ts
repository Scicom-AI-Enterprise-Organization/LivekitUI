import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

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
  await db.updateSandboxAppSettings(parseInt(id, 10), JSON.stringify(settings));

  return NextResponse.json({ success: true });
}
