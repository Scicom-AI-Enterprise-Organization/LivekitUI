import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  DEFAULT_STORAGE_SETTINGS,
  describeStorage,
  loadStorageSettings,
  saveStorageSettings,
  validateStorage,
  type StorageSettings,
} from "@/lib/storage";

/**
 * Where session audio is written. The secret access key is never returned —
 * the UI sees whether one is set, and sends a new one only when it changes.
 */
function publicView(settings: StorageSettings) {
  return {
    provider: settings.provider,
    endpoint: settings.endpoint,
    region: settings.region,
    bucket: settings.bucket,
    prefix: settings.prefix,
    accessKeyId: settings.accessKeyId,
    secretConfigured: !!settings.secretAccessKey,
    forcePathStyle: settings.forcePathStyle,
    description: describeStorage(settings),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await loadStorageSettings();
  return NextResponse.json({ storage: publicView(settings) });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });
  }

  const provider = body.provider === "s3" ? "s3" : "local";
  const current = await loadStorageSettings();

  // An omitted or blank secret keeps the stored one, so the form can be saved
  // again without the operator re-typing a key it never showed them.
  const secretAccessKey =
    typeof body.secretAccessKey === "string" && body.secretAccessKey.length > 0
      ? body.secretAccessKey
      : undefined;

  const next: StorageSettings = {
    provider,
    endpoint: String(body.endpoint ?? "").trim().replace(/\/+$/, ""),
    region: String(body.region ?? "").trim() || DEFAULT_STORAGE_SETTINGS.region,
    bucket: String(body.bucket ?? "").trim(),
    prefix: String(body.prefix ?? "").trim().replace(/^\/+|\/+$/g, ""),
    accessKeyId: String(body.accessKeyId ?? "").trim(),
    secretAccessKey: secretAccessKey ?? current.secretAccessKey,
    forcePathStyle: body.forcePathStyle !== false,
  };

  const invalid = validateStorage(next);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    await saveStorageSettings({ ...next, secretAccessKey });
  } catch (err) {
    // Saving a new secret access key encrypts it, so a deployment with no
    // usable API_KEYS_ENC_KEY / SESSION_SECRET fails here and nowhere else —
    // `loadStorageSettings` treats an unreadable blob as unset, so the page
    // loads fine and only saving explodes. Uncaught, that reached the UI as a
    // bare "HTTP 500" and the actual message was only in the container log.
    // Same shape as POST /api/api-keys, which has always reported it.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save storage settings" },
      { status: 500 }
    );
  }

  const saved = await loadStorageSettings();
  return NextResponse.json({ storage: publicView(saved) });
}
