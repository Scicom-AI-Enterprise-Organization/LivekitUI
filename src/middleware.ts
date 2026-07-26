import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/api/auth", "/api/sandbox-apps", "/api/webhooks/livekit"];

const DASHBOARD_PREFIXES = [
  "/api/agents", "/api/rooms", "/api/phone-numbers",
  "/api/sandbox-config", "/api/webhooks", "/api/api-keys", "/api/livekit",
  "/api/providers", "/api/secrets", "/api/access-tokens",
  "/api/egresses", "/api/ingresses", "/api/sip-trunks", "/api/dispatch-rules",
  "/api/calls", "/api/overview", "/api/metrics", "/api/sessions", "/api/storage",
  "/settings", "/agents", "/sessions", "/telephony", "/egresses", "/ingresses",
  "/billing", "/hub", "/api-docs",
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
    // REST clients get a JSON 401, not a redirect to an HTML login page. A
    // Bearer token is validated by the route itself (middleware has no DB
    // access), so its presence is enough to pass through here.
    if (pathname.startsWith("/api/")) {
      if (request.headers.get("authorization")) return NextResponse.next();
      return NextResponse.json(
        { error: "Unauthorized. Send a session cookie or an Authorization: Bearer lkui_… token." },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!favicon.ico).*)"],
};
