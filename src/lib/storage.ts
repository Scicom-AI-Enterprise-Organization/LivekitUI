import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ensureDb, type StorageProvider } from "./db";
import { decryptSecret, encryptSecret } from "./api-keys";

/**
 * Object storage for session audio.
 *
 * Two backends, chosen in Settings → Storage: the dashboard's own disk, or any
 * S3-compatible bucket (AWS, MinIO, Ceph, R2, Wasabi…). S3 is signed here with
 * SigV4 over `fetch` rather than pulling in the AWS SDK — the dashboard needs
 * four verbs, and the signer is small enough to read.
 *
 * Where an object lives is recorded per recording, not inferred from the
 * current settings: switching a deployment to S3 must not orphan the audio
 * already written to disk.
 */

export interface StorageSettings {
  provider: StorageProvider;
  /** Base URL of the S3 API, e.g. `http://localhost:9000`. Blank means AWS. */
  endpoint: string;
  region: string;
  bucket: string;
  /** Key prefix inside the bucket. Ignored by the local backend. */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO and most self-hosted gateways need path-style addressing. */
  forcePathStyle: boolean;
}

export const DEFAULT_STORAGE_SETTINGS: StorageSettings = {
  provider: "local",
  endpoint: "",
  region: "us-east-1",
  bucket: "",
  prefix: "console-recordings",
  accessKeyId: "",
  secretAccessKey: "",
  forcePathStyle: true,
};

/** Where the local backend keeps objects — the pre-S3 recordings directory. */
function localRoot(): string {
  return path.join(process.cwd(), "data", "console-recordings");
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

/** Rejects a key that could escape the storage root. */
function assertSafeKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function loadStorageSettings(): Promise<StorageSettings> {
  const db = await ensureDb();
  const row = await db.getStorageConfig();
  if (!row) return { ...DEFAULT_STORAGE_SETTINGS };

  let secretAccessKey = "";
  if (row.secret_access_key_enc) {
    try {
      secretAccessKey = decryptSecret(row.secret_access_key_enc);
    } catch {
      // A key rotated out from under the blob: treat it as unset rather than
      // failing every read of every recording.
      secretAccessKey = "";
    }
  }

  return {
    provider: (row.provider as StorageProvider) || "local",
    endpoint: row.endpoint || "",
    region: row.region || "us-east-1",
    bucket: row.bucket || "",
    prefix: row.prefix || "",
    accessKeyId: row.access_key_id || "",
    secretAccessKey,
    forcePathStyle: !!row.force_path_style,
  };
}

/**
 * Saves the configuration. A `secretAccessKey` of `undefined` keeps the stored
 * one, which is how the settings page can round-trip a masked secret.
 */
export async function saveStorageSettings(
  input: Omit<StorageSettings, "secretAccessKey"> & { secretAccessKey?: string }
): Promise<void> {
  const db = await ensureDb();
  await db.saveStorageConfig({
    provider: input.provider,
    endpoint: input.endpoint.trim().replace(/\/+$/, ""),
    region: input.region.trim() || "us-east-1",
    bucket: input.bucket.trim(),
    prefix: trimSlashes(input.prefix.trim()),
    accessKeyId: input.accessKeyId.trim(),
    secretAccessKeyEnc:
      input.secretAccessKey === undefined ? null : encryptSecret(input.secretAccessKey),
    forcePathStyle: input.forcePathStyle,
  });
}

/** Human-readable summary for the UI and for error messages. */
export function describeStorage(settings: StorageSettings): string {
  if (settings.provider !== "s3") return `local disk · ${localRoot()}`;
  const where = settings.endpoint || `https://s3.${settings.region}.amazonaws.com`;
  return `s3 · ${settings.bucket}${settings.prefix ? `/${settings.prefix}` : ""} @ ${where}`;
}

/**
 * Explains why a configuration cannot be used, or null when it can. Called
 * before saving and before every S3 request, so a half-filled form fails with
 * a sentence rather than a signature error.
 */
export function validateStorage(settings: StorageSettings): string | null {
  if (settings.provider !== "s3") return null;
  if (!settings.bucket) return "A bucket name is required for S3 storage";
  if (!settings.accessKeyId) return "An access key ID is required for S3 storage";
  if (!settings.secretAccessKey) return "A secret access key is required for S3 storage";
  if (settings.endpoint && !/^https?:\/\//i.test(settings.endpoint)) {
    return "The endpoint must start with http:// or https://";
  }
  return null;
}

// ---------------------------------------------------------------------------
// S3: SigV4 over fetch
// ---------------------------------------------------------------------------

function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: crypto.BinaryLike, msg: string): Buffer {
  return crypto.createHmac("sha256", key).update(msg, "utf8").digest();
}

/** RFC 3986 encoding, per path segment — S3 signs the encoded path. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function s3Target(
  settings: StorageSettings,
  key: string
): { url: string; host: string; canonicalUri: string } {
  const base = settings.endpoint || `https://s3.${settings.region}.amazonaws.com`;
  const url = new URL(base);
  const encodedKey = key.split("/").map(encodeSegment).join("/");

  // The canonical URI has to be byte-for-byte the path being requested, or the
  // signature will not verify — so both styles derive one from the other.
  if (settings.forcePathStyle) {
    const canonicalUri = `/${encodeSegment(settings.bucket)}/${encodedKey}`;
    return { url: `${url.origin}${canonicalUri}`, host: url.host, canonicalUri };
  }

  const host = `${settings.bucket}.${url.host}`;
  return { url: `${url.protocol}//${host}/${encodedKey}`, host, canonicalUri: `/${encodedKey}` };
}

async function s3Request(
  settings: StorageSettings,
  method: "PUT" | "GET" | "DELETE" | "HEAD",
  key: string,
  body?: Buffer,
  contentType?: string
): Promise<Response> {
  const invalid = validateStorage(settings);
  if (invalid) throw new Error(invalid);

  const { url, host, canonicalUri } = s3Target(settings, key);
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim()}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${settings.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${settings.secretAccessKey}`, dateStamp), settings.region), "s3"),
    "aws4_request"
  );
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return fetch(url, {
    method,
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: method === "PUT" ? new Uint8Array(payload) : undefined,
    // A bucket behind a dead endpoint must not hang an upload forever.
    signal: AbortSignal.timeout(60_000),
  });
}

/** Turns an S3 error body into one line worth showing in a toast. */
async function s3Error(res: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    const text = await res.text();
    detail = text.match(/<Message>([^<]+)<\/Message>/)?.[1] || text.slice(0, 200);
  } catch {}
  return new Error(`${what} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// Object API
// ---------------------------------------------------------------------------

export interface PutResult {
  /** Which backend took the bytes — recorded alongside the object. */
  storage: StorageProvider;
  /** Full key as stored, including the S3 prefix. */
  objectKey: string;
}

function prefixed(settings: StorageSettings, key: string): string {
  const prefix = trimSlashes(settings.prefix);
  return prefix ? `${prefix}/${key}` : key;
}

export async function putObject(
  key: string,
  data: Buffer,
  contentType: string,
  settings?: StorageSettings
): Promise<PutResult> {
  assertSafeKey(key);
  const config = settings ?? (await loadStorageSettings());

  if (config.provider === "s3") {
    const objectKey = prefixed(config, key);
    const res = await s3Request(config, "PUT", objectKey, data, contentType);
    if (!res.ok) throw await s3Error(res, "Upload to S3");
    return { storage: "s3", objectKey };
  }

  const target = path.join(localRoot(), key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return { storage: "local", objectKey: key };
}

export async function getObject(
  storage: string,
  objectKey: string,
  settings?: StorageSettings
): Promise<Buffer | null> {
  assertSafeKey(objectKey);

  if (storage === "s3") {
    const config = settings ?? (await loadStorageSettings());
    const res = await s3Request(config, "GET", objectKey);
    if (res.status === 404) return null;
    if (!res.ok) throw await s3Error(res, "Read from S3");
    return Buffer.from(await res.arrayBuffer());
  }

  const target = path.join(localRoot(), objectKey);
  if (!fs.existsSync(target)) return null;
  return fs.readFileSync(target);
}

export async function deleteObject(
  storage: string,
  objectKey: string,
  settings?: StorageSettings
): Promise<void> {
  assertSafeKey(objectKey);

  if (storage === "s3") {
    const config = settings ?? (await loadStorageSettings());
    const res = await s3Request(config, "DELETE", objectKey);
    // S3 reports deleting a missing key as success; anything else is real.
    if (!res.ok && res.status !== 404) throw await s3Error(res, "Delete from S3");
    return;
  }

  fs.rmSync(path.join(localRoot(), objectKey), { force: true });
}

/**
 * Writes, reads back and removes a probe object, so the settings page can say
 * whether the credentials actually work rather than whether they parse.
 */
export async function testStorage(
  settings: StorageSettings
): Promise<{ ok: boolean; message: string }> {
  const invalid = validateStorage(settings);
  if (invalid) return { ok: false, message: invalid };

  const key = `.livekit-ui-write-test-${crypto.randomBytes(6).toString("hex")}`;
  const payload = Buffer.from(`livekit-ui storage test ${new Date().toISOString()}`);

  try {
    const put = await putObject(key, payload, "text/plain", settings);
    const read = await getObject(put.storage, put.objectKey, settings);
    if (!read || !read.equals(payload)) {
      return { ok: false, message: "The test object was written but read back wrong" };
    }
    await deleteObject(put.storage, put.objectKey, settings);
    return { ok: true, message: `Wrote, read and deleted a test object · ${describeStorage(settings)}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}
