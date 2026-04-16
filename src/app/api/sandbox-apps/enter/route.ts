import { NextRequest, NextResponse } from "next/server";

// Legacy: middleware now resolves sandbox ports per-request via
// /api/sandbox-apps/resolve, so we no longer need a cookie. Keep this
// endpoint as a simple redirect for any stray links still pointing here.
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  const redirect = request.nextUrl.searchParams.get("redirect") || `/sandbox/${name}/`;
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  return NextResponse.redirect(new URL(redirect, request.url));
}
