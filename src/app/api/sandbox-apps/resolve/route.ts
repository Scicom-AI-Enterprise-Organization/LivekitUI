import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { getProcessInfo, isPortFree, isRunning } from "@/lib/sandbox";

// Resolves a sandbox name to its current dev-server port. Middleware calls
// this on every /sandbox/{name}/* request so each tab can route to its own
// sandbox without relying on a shared browser cookie.
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  // isRunning() first, not getProcessInfo(): the in-memory map is empty after
  // any restart, and only isRunning() rebuilds it by scanning /proc for a
  // process whose cwd is this sandbox's directory.
  const proc = isRunning(name) ? getProcessInfo(name) : null;
  if (proc?.port) {
    return NextResponse.json({ port: proc.port });
  }

  const db = await ensureDb();
  const apps = await db.getAllSandboxApps();
  const app = apps.find((a) => a.name === name);
  if (!app?.port) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // The row records the port a sandbox last used, not that anything is
  // listening on it now — restarting the container kills every child process
  // and leaves these rows behind. Handing that port back unverified makes the
  // middleware proxy into a dead port, which surfaces as a bare 500 instead of
  // the "not running" page it would otherwise render.
  if (await isPortFree(app.port)) {
    return NextResponse.json({ error: "not running" }, { status: 404 });
  }

  return NextResponse.json({ port: app.port });
}
