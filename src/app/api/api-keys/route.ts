import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// TODO: Replace in-memory storage with database persistence (e.g. db.getAllApiKeys())
interface StoredApiKey {
  id: string;
  name: string;
  description: string;
  key: string;
  secretHash: string;
  status: string;
  createdAt: string;
}

const apiKeys = new Map<string, StoredApiKey>();

function generateId() {
  return crypto.randomBytes(8).toString("hex");
}

function generateApiKey() {
  return "api_" + crypto.randomBytes(16).toString("hex");
}

function generateSecret() {
  return "sk_" + crypto.randomBytes(24).toString("hex");
}

function hashSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export async function GET() {
  const keys = Array.from(apiKeys.values()).map(({ secretHash, ...rest }) => rest);
  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const id = generateId();
  const key = generateApiKey();
  const secret = generateSecret();

  // TODO: Persist to database instead of in-memory storage
  const storedKey: StoredApiKey = {
    id,
    name,
    description: description || "",
    key,
    secretHash: hashSecret(secret),
    status: "Active",
    createdAt: new Date().toISOString(),
  };

  apiKeys.set(id, storedKey);

  // Return the secret in plaintext only on creation — it is hashed in storage
  return NextResponse.json({
    key: {
      id,
      name,
      description: storedKey.description,
      key,
      secret,
      status: storedKey.status,
      createdAt: storedKey.createdAt,
    },
  });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { id } = body;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  apiKeys.delete(id);

  return NextResponse.json({ success: true });
}
