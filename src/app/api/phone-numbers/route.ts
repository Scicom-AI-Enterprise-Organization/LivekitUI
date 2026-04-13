import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import type { PhoneProvider } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDb();
  const numbers = await db.getAllPhoneNumbers();

  return NextResponse.json({
    numbers: numbers.map((n) => ({
      id: n.id,
      number: n.number,
      label: n.label,
      provider: n.provider,
      capabilities: JSON.parse(n.capabilities),
      createdAt: n.created_at,
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

  const body = await request.json();
  const { number, label, provider, capabilities } = body;

  if (!number) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  const db = await ensureDb();

  const existing = await db.findPhoneNumberByNumber(number);
  if (existing) {
    return NextResponse.json({ error: "This number already exists" }, { status: 409 });
  }

  const validProviders: PhoneProvider[] = ["manual", "twilio", "vonage", "telnyx"];
  const prov: PhoneProvider = validProviders.includes(provider) ? provider : "manual";
  const caps = JSON.stringify(capabilities || { voice: true, sms: false });

  const created = await db.createPhoneNumber(number, label || null, prov, null, caps);

  return NextResponse.json({
    number: {
      id: created.id,
      number: created.number,
      label: created.label,
      provider: created.provider,
      capabilities: JSON.parse(created.capabilities),
      createdAt: created.created_at,
    },
  });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  const db = await ensureDb();
  await db.deletePhoneNumber(id);

  return NextResponse.json({ success: true });
}
