import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/api/auth", "/api/sandbox-apps", "/api/webhooks/livekit"];

const DASHBOARD_PREFIXES = [
  "/api/agents", "/api/rooms", "/api/phone-numbers",
  "/api/sandbox-config", "/api/webhooks", "/api/api-keys", "/api/livekit",
  "/settings", "/agents", "/sessions", "/telephony", "/egresses", "/ingresses",
  "/billing", "/hub",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Sandbox: /sandbox/{name}/* ---
  if (pathname.startsWith("/sandbox/")) {
    const sandboxCookie = request.cookies.get("lk_sandbox");
    if (sandboxCookie) {
      try {
        const { port } = JSON.parse(sandboxCookie.value);
        if (port) {
          // /sandbox/{name}/foo → localhost:{port}/foo
          const parts = pathname.split("/");
          const subPath = parts.slice(3).join("/");
          const target = new URL(`http://localhost:${port}/${subPath}${request.nextUrl.search}`);
          return NextResponse.rewrite(target);
        }
      } catch {}
    }
    // No cookie — redirect to enter endpoint to set it
    const parts = pathname.split("/");
    const sandboxName = parts[2];
    if (sandboxName) {
      return NextResponse.redirect(
        new URL(`/api/sandbox-apps/enter?name=${encodeURIComponent(sandboxName)}&redirect=${encodeURIComponent(pathname)}`, request.url)
      );
    }
    return NextResponse.next();
  }

  // --- Proxy non-prefixed requests from sandbox (referer-based) ---
  const referer = request.headers.get("referer") || "";
  if (referer.includes("/sandbox/")) {
    if (!DASHBOARD_PREFIXES.some((p) => pathname.startsWith(p)) && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      const sandboxCookie = request.cookies.get("lk_sandbox");
      if (sandboxCookie) {
        try {
          const { port } = JSON.parse(sandboxCookie.value);
          if (port) {
            const target = new URL(`http://localhost:${port}${pathname}${request.nextUrl.search}`);
            return NextResponse.rewrite(target);
          }
        } catch {}
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
