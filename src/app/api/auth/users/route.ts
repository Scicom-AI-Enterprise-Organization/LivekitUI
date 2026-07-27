import { NextRequest, NextResponse } from "next/server";
import { ensureDb, type UserRole } from "@/lib/db";
import { addGithubMember, getSession } from "@/lib/auth";

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
      authProvider: u.auth_provider ?? "local",
      githubLogin: u.github_login ?? null,
      createdAt: u.created_at,
    })),
  });
}

/**
 * Add a member by GitHub username (SSO — no invite link, no password).
 * Owner-only, mirroring the invite route's gate.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "owner") {
    return NextResponse.json(
      { error: "Only owners can add members" },
      { status: 403 }
    );
  }

  const { githubLogin, role } = (await request.json()) as {
    githubLogin?: string;
    role?: UserRole;
  };
  if (!githubLogin || !role) {
    return NextResponse.json(
      { error: "githubLogin and role are required" },
      { status: 400 }
    );
  }
  const validRoles: UserRole[] = ["admin", "member"];
  if (!validRoles.includes(role)) {
    return NextResponse.json(
      { error: "Role must be admin or member" },
      { status: 400 }
    );
  }

  const result = await addGithubMember(githubLogin.trim(), role);
  if (!result.success || !result.user) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ user: result.user });
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
