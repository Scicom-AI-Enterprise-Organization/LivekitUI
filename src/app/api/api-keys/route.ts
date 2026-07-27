import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { generateApiKeyPair, encryptSecret } from "@/lib/api-keys";
import { getRuntimeConfig } from "@/lib/runtime-config";

/**
 * The URL handed out with issued keys. The LiveKit server has never heard of
 * an issued key — only the gateway can translate it — so this must point at
 * the gateway, not straight at the server.
 */
function issuedKeyUrl() {
  const gateway =
    process.env.LIVEKIT_GATEWAY_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_LIVEKIT_GATEWAY_URL;
  return {
    wsUrl: gateway || getRuntimeConfig().livekitUrl,
    gatewayConfigured: !!gateway,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wsUrl = getRuntimeConfig().livekitUrl;
  const httpUrl = process.env.LIVEKIT_URL || "http://localhost:7880";
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";

  // Only admins/owners can see the secret
  const canSeeSecret = session.role === "owner" || session.role === "admin";

  const db = await ensureDb();
  const keys = await db.getAllApiKeys();
  const issued = issuedKeyUrl();

  return NextResponse.json({
    wsUrl,
    httpUrl,
    apiKey,
    apiSecret: canSeeSecret ? apiSecret : "",
    canSeeSecret,
    // Issued keys. Their secrets are returned once, at creation, and never again.
    gatewayUrl: issued.wsUrl,
    gatewayConfigured: issued.gatewayConfigured,
    keys: keys.map((k) => ({
      id: k.id,
      description: k.description,
      apiKey: k.api_key,
      owner: k.owner,
      createdAt: k.created_at,
      revokedAt: k.revoked_at,
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

  let description: string | undefined;
  try {
    ({ description } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!description?.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const { apiKey, apiSecret } = generateApiKeyPair();

  let encrypted: string;
  try {
    encrypted = encryptSecret(apiSecret);
  } catch (err) {
    // Missing or malformed encryption key. Fail loudly rather than storing a
    // secret we could never read back.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not encrypt secret" },
      { status: 500 }
    );
  }

  const db = await ensureDb();
  const row = await db.createApiKey(description.trim(), apiKey, encrypted, session.email);
  const issued = issuedKeyUrl();

  return NextResponse.json({
    id: row.id,
    description: row.description,
    apiKey,
    apiSecret,
    wsUrl: issued.wsUrl,
    gatewayConfigured: issued.gatewayConfigured,
    createdAt: row.created_at,
  });
}
