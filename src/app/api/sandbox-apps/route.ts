import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDb();
  const apps = await db.getAllSandboxApps();

  return NextResponse.json({
    apps: apps.map((a) => ({
      id: a.id,
      name: a.name,
      template: a.template,
      url: a.url,
      status: a.status,
      createdAt: a.created_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { name, template } = await request.json();

  if (!name || !template) {
    return NextResponse.json({ error: "Name and template are required" }, { status: 400 });
  }

  const domain = process.env.NEXT_PUBLIC_SANDBOX_DOMAIN || "sandbox.example.com";
  const url = `https://${name}.${domain}`;

  const db = await ensureDb();

  try {
    const app = await db.createSandboxApp(name, template, url);
    return NextResponse.json({
      app: {
        id: app.id,
        name: app.name,
        template: app.template,
        url: app.url,
        status: app.status,
        createdAt: app.created_at,
      },
    });
  } catch {
    return NextResponse.json({ error: "An app with this name already exists" }, { status: 409 });
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

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  const db = await ensureDb();
  await db.deleteSandboxApp(id);

  return NextResponse.json({ success: true });
}
