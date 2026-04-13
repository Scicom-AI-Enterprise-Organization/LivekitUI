import { NextRequest, NextResponse } from "next/server";
import { registerUser, registerWithInvite, createSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password, firstName, lastName, company, invite } = body;

  if (!password || !firstName || !lastName) {
    return NextResponse.json(
      { error: "Password, first name, and last name are required" },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  // Invite-based registration
  if (invite) {
    const result = await registerWithInvite(invite, password, firstName, lastName, company);
    if (!result.success || !result.user) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    await createSession(result.user);
    return NextResponse.json({ user: result.user });
  }

  // Self-registration (owner)
  const { email } = body;
  if (!email) {
    return NextResponse.json(
      { error: "Email is required" },
      { status: 400 }
    );
  }

  const result = await registerUser(email, password, firstName, lastName, company);
  if (!result.success || !result.user) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  await createSession(result.user);
  return NextResponse.json({ user: result.user });
}
