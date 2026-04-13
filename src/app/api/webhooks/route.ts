import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// TODO: Replace in-memory storage with database persistence
interface StoredWebhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  status: string;
  createdAt: string;
}

const webhooks = new Map<string, StoredWebhook>();

function generateId() {
  return crypto.randomBytes(8).toString("hex");
}

function generateWebhookSecret() {
  return "whsec_" + crypto.randomBytes(24).toString("hex");
}

export async function GET() {
  const endpoints = Array.from(webhooks.values());
  return NextResponse.json({ endpoints });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { url, events } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  if (!events || !Array.isArray(events) || events.length === 0) {
    return NextResponse.json(
      { error: "At least one event is required" },
      { status: 400 }
    );
  }

  const id = generateId();
  const secret = generateWebhookSecret();

  const webhook: StoredWebhook = {
    id,
    url,
    events,
    secret,
    status: "Active",
    createdAt: new Date().toISOString(),
  };

  webhooks.set(id, webhook);

  return NextResponse.json({ endpoint: webhook });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { id } = body;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  webhooks.delete(id);

  return NextResponse.json({ success: true });
}
