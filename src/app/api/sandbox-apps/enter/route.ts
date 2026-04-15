import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { getProcessInfo } from "@/lib/sandbox";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  const redirect = request.nextUrl.searchParams.get("redirect") || `/sandbox/${name}/`;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Resolve port
  let port: number | null = null;

  const proc = getProcessInfo(name);
  if (proc) {
    port = proc.port;
  } else {
    const db = await ensureDb();
    const apps = await db.getAllSandboxApps();
    const app = apps.find((a) => a.name === name);
    if (app?.port) port = app.port;
  }

  if (!port) {
    return new NextResponse(
      `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#888">
        <div style="text-align:center">
          <h2>Sandbox "${name}" not found or not running</h2>
          <p><a href="/sandboxes" style="color:#6366f1">Go to dashboard</a></p>
        </div>
      </body></html>`,
      { status: 404, headers: { "content-type": "text/html" } }
    );
  }

  // Set cookie and redirect back to the sandbox URL
  const response = NextResponse.redirect(new URL(redirect, request.url));
  response.cookies.set("lk_sandbox", JSON.stringify({ name, port }), {
    path: "/",
    httpOnly: false,
    maxAge: 60 * 60 * 24,
  });

  return response;
}
