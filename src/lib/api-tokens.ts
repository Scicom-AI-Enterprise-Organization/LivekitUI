/**
 * Bearer tokens for the REST API.
 *
 * Distinct from the LiveKit keys in Settings > API keys: those authenticate to
 * the LiveKit server through the gateway, these authenticate to *this*
 * dashboard. Keeping them separate means an agent holding a LiveKit key cannot
 * call dashboard endpoints.
 *
 * Tokens are 256 bits of entropy, so a plain SHA-256 is the right store — there
 * is nothing to brute-force, and it stays cheap enough to verify per request.
 */

import crypto from "node:crypto";

export const TOKEN_PREFIX = "lkui_";
/** Characters kept in the clear so a token is recognisable in the UI. */
const DISPLAY_PREFIX_LENGTH = TOKEN_PREFIX.length + 6;

export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  return {
    token,
    prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
    hash: hashApiToken(token),
  };
}

export function hashApiToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Pulls a Bearer token out of an Authorization header value. */
export function bearerFromHeader(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.startsWith(TOKEN_PREFIX) ? token : null;
}
