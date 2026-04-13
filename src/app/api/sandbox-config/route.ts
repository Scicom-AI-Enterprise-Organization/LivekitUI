import { NextResponse } from "next/server";

export async function GET() {
  const domain = process.env.NEXT_PUBLIC_SANDBOX_DOMAIN || "";
  const isLocal = !domain || domain === "localhost" || domain.startsWith("localhost:");

  return NextResponse.json({ domain, isLocal });
}
