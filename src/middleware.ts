import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/api/auth", "/api/sandbox-apps", "/api/webhooks/livekit"];

const DASHBOARD_PREFIXES = [
  "/api/agents", "/api/rooms", "/api/phone-numbers",
  "/api/sandbox-config", "/api/webhooks", "/api/api-keys", "/api/livekit",
  "/api/providers", "/api/secrets", "/api/access-tokens",
  "/api/egresses", "/api/ingresses", "/api/sip-trunks", "/api/dispatch-rules",
  "/api/calls", "/api/overview", "/api/metrics", "/api/sessions", "/api/storage",
  "/api/tools", "/api/assist-sim",
  "/settings", "/agents", "/sessions", "/telephony", "/egresses", "/ingresses",
  "/billing", "/hub", "/api-docs",
];

/**
 * Where the middleware calls its own API. Deliberately NOT `nextUrl.origin`:
 * that is the address the *browser* used, so on a deployment it is the public
 * HTTPS hostname, and resolving a sandbox would mean leaving the container,
 * resolving its own public DNS name from the inside, hairpinning back through
 * the ingress and trusting its certificate. Where any of that fails the fetch
 * throws, the port comes back null, and every sandbox renders "not found or
 * not running" while `/api/sandbox-apps/resolve` answers correctly from
 * outside.
 *
 * Middleware runs on the edge runtime, so `process.env.PORT` is inlined at
 * build time and is not readable here. `nextUrl.port` carries the real port
 * whenever the client connected straight to the server (dev on :3010); behind
 * TLS termination it is empty, and the container listens on 3000 — the port
 * the Dockerfile sets and exposes.
 */
function internalOrigin(request: NextRequest): string {
  return `http://127.0.0.1:${request.nextUrl.port || "3000"}`;
}

async function resolveSandboxPort(request: NextRequest, name: string): Promise<number | null> {
  try {
    const r = await fetch(
      `${internalOrigin(request)}/api/sandbox-apps/resolve?name=${encodeURIComponent(name)}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data.port === "number" ? data.port : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Sandbox: /sandbox/{name}/* ---
  if (pathname.startsWith("/sandbox/")) {
    const parts = pathname.split("/");
    const name = parts[2];
    if (name) {
      const port = await resolveSandboxPort(request, name);
      if (port) {
        const subPath = parts.slice(3).join("/");
        // 127.0.0.1, not localhost: Node resolves localhost verbatim and may
        // try ::1 first, which a sandbox bound to 0.0.0.0 never answers.
        const target = new URL(`http://127.0.0.1:${port}/${subPath}${request.nextUrl.search}`);
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
      const port = await resolveSandboxPort(request, refererSandboxMatch[1]);
      if (port) {
        const target = new URL(`http://127.0.0.1:${port}${pathname}${request.nextUrl.search}`);
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
