import { NextResponse } from "next/server";

export async function GET() {
  const domain = process.env.NEXT_PUBLIC_SANDBOX_DOMAIN || "http://localhost:3000";
  const base = domain.replace(/\/$/, "");

  return NextResponse.json({ domain: base, prefix: `${base}/sandbox/` });
}
