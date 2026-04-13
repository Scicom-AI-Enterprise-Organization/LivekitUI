import { NextRequest, NextResponse } from "next/server";
import { getSession, createInvite } from "@/lib/auth";
import type { UserRole } from "@/lib/db";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "owner") {
    return NextResponse.json(
      { error: "Only owners can invite members" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { email, role } = body;

  if (!email || !role) {
    return NextResponse.json(
      { error: "Email and role are required" },
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

  const result = await createInvite(email, role);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  const origin = request.nextUrl.origin;
  const inviteUrl = `${origin}/register?invite=${result.token}`;

  return NextResponse.json({ inviteUrl });
}
