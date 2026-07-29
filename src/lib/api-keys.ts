/**
 * Issued API keys — generation, secret encryption, and HS256 JWT handling.
 *
 * The LiveKit server only knows ONE key pair (the one in livekit.yaml). Keys
 * issued here live in our database and are translated by the gateway: it
 * verifies a client's token against the issued key's secret, then re-signs the
 * same claims with the real server key. See gateway/server.mjs.
 *
 * Deliberately imports nothing but node:crypto — the standalone gateway loads
 * this file directly (Node strips the types), so it must not pull in Next.js
 * or path-aliased modules.
 */

import crypto from "node:crypto";

// ── Key generation ──

const KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomString(length: number): string {
  // Rejection-free: map 6 random bits per char over a 62-char alphabet would
  // bias slightly, so draw a byte per char and reject values that would.
  const out: string[] = [];
  const limit = 256 - (256 % KEY_ALPHABET.length);
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out.push(KEY_ALPHABET[byte % KEY_ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

/**
 * Mirrors LiveKit Cloud's shape: an "API"-prefixed identifier and a long
 * secret. The identifier lands in the JWT's `iss` claim, which is how the
 * gateway knows which secret to verify against.
 */
export function generateApiKeyPair(): { apiKey: string; apiSecret: string } {
  return {
    apiKey: "API" + randomString(12),
    apiSecret: randomString(43),
  };
}

// ── Secret encryption at rest ──
//
// We need the plaintext secret to verify a client's HMAC signature, so a hash
// won't do. Encrypt with AES-256-GCM instead.

function encryptionKey(): Buffer {
  const explicit = process.env.API_KEYS_ENC_KEY;
  if (explicit) {
    const buf = Buffer.from(explicit, "hex");
    if (buf.length === 32) return buf;
    // These messages reach an operator in the UI (a toast on Settings > Storage,
    // the API keys page), so they carry the command rather than just the rule.
    // `Buffer.from(…, "hex")` stops at the first non-hex character instead of
    // throwing, so a passphrase set here decodes to a short buffer and lands
    // on exactly the same complaint as a too-short key — hence naming both
    // possibilities rather than only the length.
    throw new Error(
      `API_KEYS_ENC_KEY must be 64 hex characters (32 bytes) — got ${explicit.length} characters decoding to ${buf.length}. Generate one with: openssl rand -hex 32`
    );
  }
  const session = process.env.SESSION_SECRET;
  if (!session) {
    throw new Error(
      "Set API_KEYS_ENC_KEY (64 hex chars, `openssl rand -hex 32`) or SESSION_SECRET to encrypt issued API key secrets"
    );
  }
  // Fixed salt: the derived key has to be stable across restarts and across
  // the dashboard and gateway processes.
  return crypto.scryptSync(session, "livekitui.api-keys.v1", 32);
}

/** Returns "v1:<iv-hex>:<tag-hex>:<ciphertext-hex>". */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(blob: string): string {
  const [version, ivHex, tagHex, dataHex] = blob.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !dataHex) {
    throw new Error("Malformed encrypted secret");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

// ── HS256 JWTs ──
//
// LiveKit tokens are HS256 JWTs signed with the API secret, carrying the key
// name in `iss`. We verify and re-sign them by hand so that unrecognised claims
// survive the round trip untouched — dropping one would silently change a
// participant's permissions.

export interface LiveKitTokenClaims {
  iss?: string;
  sub?: string;
  exp?: number;
  nbf?: number;
  [claim: string]: unknown;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function sign(signingInput: string, secret: string): string {
  return b64url(crypto.createHmac("sha256", secret).update(signingInput).digest());
}

/** Reads claims WITHOUT verifying — only for discovering `iss`. */
export function decodeJwtClaims(token: string): LiveKitTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function verifyJwtHs256(token: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const expected = sign(`${parts[0]}.${parts[1]}`, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Re-signs claims as-is, replacing only `iss` with the given key. */
export function signJwtHs256(
  claims: LiveKitTokenClaims,
  apiKey: string,
  apiSecret: string
): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify({ ...claims, iss: apiKey })));
  return `${header}.${payload}.${sign(`${header}.${payload}`, apiSecret)}`;
}
