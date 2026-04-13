import { NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";

export async function GET() {
  try {
    const db = await ensureDb();
    const users = await db.getAllUsers();
    return NextResponse.json({ hasUsers: users.length > 0 });
  } catch {
    return NextResponse.json({ hasUsers: false });
  }
}
