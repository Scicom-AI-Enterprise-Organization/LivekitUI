import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { deploySandbox, stopSandbox } from "@/lib/sandbox";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id, name } = await request.json();
  if (!id || !name) {
    return NextResponse.json({ error: "id and name are required" }, { status: 400 });
  }

  const db = await ensureDb();
  const apps = await db.getAllSandboxApps();
  const app = apps.find((a) => a.id === id);
  if (!app) {
    return NextResponse.json({ error: "Sandbox app not found" }, { status: 404 });
  }

  // Stop existing process
  stopSandbox(name);

  try {
    // Redeploy with same config
    const { url, port } = await deploySandbox(
      name,
      app.template,
      process.env.LIVEKIT_API_KEY || "",
      process.env.LIVEKIT_API_SECRET || ""
    );

    return NextResponse.json({
      success: true,
      url,
      port,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
