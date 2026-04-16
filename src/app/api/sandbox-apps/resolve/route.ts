import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { getProcessInfo } from "@/lib/sandbox";

// Resolves a sandbox name to its current dev-server port. Middleware calls
// this on every /sandbox/{name}/* request so each tab can route to its own
// sandbox without relying on a shared browser cookie.
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const proc = getProcessInfo(name);
  if (proc?.port) {
    return NextResponse.json({ port: proc.port });
  }

  const db = await ensureDb();
  const apps = await db.getAllSandboxApps();
  const app = apps.find((a) => a.name === name);
  if (!app?.port) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ port: app.port });
}
