import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLogs } from "@/lib/sandbox";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name parameter is required" }, { status: 400 });
  }

  const tail = parseInt(request.nextUrl.searchParams.get("tail") || "200", 10);
  const logs = getLogs(name, tail);

  return NextResponse.json({ logs });
}
