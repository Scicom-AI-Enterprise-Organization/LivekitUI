import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = await ensureDb();
  const secrets = await db.getAgentSecrets(id);

  return NextResponse.json({
    secrets: secrets.map((s) => ({
      key: s.key,
      value: s.value, // returned but treat as sensitive
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;
  const { key, value } = await request.json();

  if (!key || !value) {
    return NextResponse.json({ error: "Key and value are required" }, { status: 400 });
  }

  const db = await ensureDb();
  await db.upsertAgentSecret(id, key, value);

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;
  const { key } = await request.json();

  if (!key) {
    return NextResponse.json({ error: "Key is required" }, { status: 400 });
  }

  const db = await ensureDb();
  await db.deleteAgentSecret(id, key);

  return NextResponse.json({ success: true });
}
