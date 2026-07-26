import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const domain = process.env.NEXT_PUBLIC_SANDBOX_DOMAIN || "http://localhost:3000";
  const base = domain.replace(/\/$/, "");

  return NextResponse.json({ domain: base, prefix: `${base}/sandbox/` });
}
