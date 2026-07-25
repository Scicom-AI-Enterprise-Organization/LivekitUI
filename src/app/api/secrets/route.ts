import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { SECRET_NAME_PATTERN } from "@/lib/providers";

/** Never send a full secret unless it was explicitly requested by an admin. */
function preview(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(8);
  return `${value.slice(0, 4)}${"•".repeat(12)}${value.slice(-2)}`;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canReveal = session.role === "owner" || session.role === "admin";
  const reveal = request.nextUrl.searchParams.get("reveal") === "1" && canReveal;

  const db = await ensureDb();
  const secrets = await db.getAllSecrets();

  return NextResponse.json({
    canReveal,
    secrets: secrets.map((s) => ({
      name: s.name,
      description: s.description,
      preview: preview(s.value),
      value: reveal ? s.value : undefined,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { name, value, description } = await request.json();

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!SECRET_NAME_PATTERN.test(name)) {
    return NextResponse.json(
      { error: "Name must be a valid environment variable name (letters, digits, underscore; cannot start with a digit)" },
      { status: 400 }
    );
  }
  if (typeof value !== "string" || value.length === 0) {
    return NextResponse.json({ error: "Value is required" }, { status: 400 });
  }

  const db = await ensureDb();
  await db.upsertSecret(name, value, description?.trim() || null);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { name } = await request.json();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const db = await ensureDb();

  // Warn (but still allow) when a provider is pointing at this secret.
  const providers = await db.getAllProviders();
  const used = providers.filter((p) => p.api_key_secret === name).map((p) => p.name);

  await db.deleteSecret(name);

  return NextResponse.json({ success: true, usedBy: used });
}
