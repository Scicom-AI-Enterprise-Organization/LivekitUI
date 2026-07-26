import { NextRequest, NextResponse } from "next/server";
import { getSession, updateProfile } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { firstName, lastName, company } = await request.json();
  if (typeof firstName !== "string" || typeof lastName !== "string") {
    return NextResponse.json({ error: "First and last name are required" }, { status: 400 });
  }

  const result = await updateProfile(
    session.id,
    firstName,
    lastName,
    typeof company === "string" ? company : null
  );
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const updated = await getSession();
  return NextResponse.json({ user: updated });
}
