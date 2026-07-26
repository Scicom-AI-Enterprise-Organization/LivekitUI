import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  DEFAULT_STORAGE_SETTINGS,
  loadStorageSettings,
  testStorage,
  type StorageSettings,
} from "@/lib/storage";

/**
 * Round-trips a probe object through the given configuration — or the saved one
 * when the body is empty — so the settings page can prove credentials work
 * before anything depends on them.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const current = await loadStorageSettings();

  const settings: StorageSettings = body
    ? {
        provider: body.provider === "s3" ? "s3" : "local",
        endpoint: String(body.endpoint ?? "").trim().replace(/\/+$/, ""),
        region: String(body.region ?? "").trim() || DEFAULT_STORAGE_SETTINGS.region,
        bucket: String(body.bucket ?? "").trim(),
        prefix: String(body.prefix ?? "").trim().replace(/^\/+|\/+$/g, ""),
        accessKeyId: String(body.accessKeyId ?? "").trim(),
        // Testing an unchanged form must not require re-typing the secret.
        secretAccessKey:
          typeof body.secretAccessKey === "string" && body.secretAccessKey.length > 0
            ? body.secretAccessKey
            : current.secretAccessKey,
        forcePathStyle: body.forcePathStyle !== false,
      }
    : current;

  const result = await testStorage(settings);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
