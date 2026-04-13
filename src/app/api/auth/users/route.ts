import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDb();
  const users = await db.getAllUsers();

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      company: u.company,
      role: u.role,
      createdAt: u.created_at,
    })),
  });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "owner" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  // Cannot delete yourself
  if (id === session.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const db = await ensureDb();
  const target = await db.findUserById(id);
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Admins cannot delete owners
  if (session.role === "admin" && target.role === "owner") {
    return NextResponse.json({ error: "Admins cannot delete owners" }, { status: 403 });
  }

  await db.deleteUser(id);
  return NextResponse.json({ success: true });
}
