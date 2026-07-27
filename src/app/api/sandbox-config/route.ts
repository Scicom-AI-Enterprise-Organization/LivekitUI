import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRuntimeConfig } from "@/lib/runtime-config";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = getRuntimeConfig().sandboxDomain;

  return NextResponse.json({ domain: base, prefix: `${base}/sandbox/` });
}
