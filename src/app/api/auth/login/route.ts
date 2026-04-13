import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, createSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const result = await validateCredentials(email, password);
  if (!result.success || !result.user) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  await createSession(result.user);

  return NextResponse.json({ user: result.user });
}
