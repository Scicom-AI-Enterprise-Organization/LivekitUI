import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/api/auth", "/api/sandbox-apps", "/api/webhooks/livekit"];

const DASHBOARD_PREFIXES = [
  "/api/agents", "/api/rooms", "/api/phone-numbers",
  "/api/sandbox-config", "/api/webhooks", "/api/api-keys", "/api/livekit",
  "/settings", "/agents", "/sessions", "/telephony", "/egresses", "/ingresses",
  "/billing", "/hub",
];

async function resolveSandboxPort(origin: string, name: string): Promise<number | null> {
  try {
    const r = await fetch(`${origin}/api/sandbox-apps/resolve?name=${encodeURIComponent(name)}`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data.port === "number" ? data.port : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const origin = request.nextUrl.origin;

  // --- Sandbox: /sandbox/{name}/* ---
  if (pathname.startsWith("/sandbox/")) {
    const parts = pathname.split("/");
    const name = parts[2];
    if (name) {
      const port = await resolveSandboxPort(origin, name);
      if (port) {
        const subPath = parts.slice(3).join("/");
        const target = new URL(`http://localhost:${port}/${subPath}${request.nextUrl.search}`);
        return NextResponse.rewrite(target);
      }
      return new NextResponse(
        `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#888"><div style="text-align:center"><h2>Sandbox "${name}" not found or not running</h2><p><a href="/sandboxes" style="color:#6366f1">Go to dashboard</a></p></div></body></html>`,
        { status: 404, headers: { "content-type": "text/html" } }
      );
    }
    return NextResponse.next();
  }

  // --- Proxy non-prefixed requests from sandbox (referer-based) ---
  // The sandbox template serves assets like /_next/... and /api/... at the
  // root. Use the referer to tell which sandbox's port they belong to.
  const referer = request.headers.get("referer") || "";
  const refererSandboxMatch = referer.match(/\/sandbox\/([^/?#]+)/);
  if (refererSandboxMatch) {
    if (!DASHBOARD_PREFIXES.some((p) => pathname.startsWith(p)) && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      const port = await resolveSandboxPort(origin, refererSandboxMatch[1]);
      if (port) {
        const target = new URL(`http://localhost:${port}${pathname}${request.nextUrl.search}`);
        return NextResponse.rewrite(target);
      }
    }
  }

  // --- Auth ---
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get("lk_session");
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!favicon.ico).*)"],
};
