/**
 * LiveKit auth-translating gateway.
 *
 * Why this exists: the OSS livekit-server reads its API keys once, at boot
 * (verified — neither rewriting key_file nor SIGHUP reloads them). So issuing
 * keys at runtime the way LiveKit Cloud does is impossible if clients talk to
 * the server directly.
 *
 * This process sits in front of it. A client signs its token with the key we
 * issued; we look that key up in our database, verify the signature ourselves,
 * then re-sign the identical claims with the server's one real key and forward
 * the request. To the client it looks exactly like LiveKit Cloud: one unchanged
 * URL, many keys, revocation that takes effect immediately.
 *
 * Only signalling passes through here. WebRTC media negotiates ICE directly
 * with the SFU and never touches this process.
 *
 *   client ──(issued key)──> gateway :7885 ──(real key)──> livekit-server :7880
 *                                  │
 *                                  └── media flows client <──> SFU directly
 *
 * Run with:  npm run gateway
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeJwtClaims,
  verifyJwtHs256,
  signJwtHs256,
  decryptSecret,
} from "../src/lib/api-keys.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Config ──

loadDotEnv();

const PORT = Number(process.env.GATEWAY_PORT || 7885);
const UPSTREAM = new URL(
  (process.env.LIVEKIT_URL || "http://localhost:7880").replace(/^ws/, "http")
);
const REAL_KEY = process.env.LIVEKIT_API_KEY || "";
const REAL_SECRET = process.env.LIVEKIT_API_SECRET || "";
const VERBOSE = process.env.GATEWAY_VERBOSE === "1";

if (!REAL_KEY || !REAL_SECRET) {
  console.error("gateway: LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set");
  process.exit(1);
}

/** Minimal .env reader — this process runs outside Next.js. */
function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split("\n")) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue; // real env wins
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

// ── Key lookup ──
//
// Read straight from the dashboard's database: no cache, so a revoked key stops
// working on its very next request, and the gateway keeps serving even if the
// dashboard is down.

const keyStore = await openKeyStore();

async function openKeyStore() {
  const type = (process.env.DB_TYPE || "sqlite").toLowerCase();

  if (type === "postgres") {
    const { default: pg } = await import("pg");
    const pool = process.env.DATABASE_URL
      ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
      : new pg.Pool({
          host: process.env.POSTGRES_HOST || "localhost",
          port: Number(process.env.POSTGRES_PORT || 5432),
          user: process.env.POSTGRES_USER,
          password: process.env.POSTGRES_PASSWORD,
          database: process.env.POSTGRES_DB,
        });
    return {
      describe: `postgres ${process.env.POSTGRES_DB || "(url)"}`,
      async find(apiKey) {
        const { rows } = await pool.query(
          "SELECT api_key, api_secret_enc, revoked_at FROM api_keys WHERE api_key = $1",
          [apiKey]
        );
        return rows[0] || null;
      },
    };
  }

  const { default: Database } = await import("better-sqlite3");
  const file = path.resolve(ROOT, process.env.SQLITE_PATH || "./data/livekit.db");
  if (!fs.existsSync(file)) {
    console.error(
      `gateway: no database at ${file} — start the dashboard once so it can create the schema`
    );
    process.exit(1);
  }
  const db = new Database(file, { readonly: true, fileMustExist: true });
  const stmt = db.prepare(
    "SELECT api_key, api_secret_enc, revoked_at FROM api_keys WHERE api_key = ?"
  );
  return {
    describe: `sqlite ${file}`,
    async find(apiKey) {
      return stmt.get(apiKey) || null;
    },
  };
}

/**
 * Translates a client token into one the LiveKit server will accept.
 * Returns { token } on success or { error, status } on rejection.
 */
async function translateToken(token) {
  if (!token) return { error: "missing access token", status: 401 };

  const claims = decodeJwtClaims(token);
  if (!claims?.iss) return { error: "malformed token", status: 401 };

  // The server's own key: nothing to translate, pass it through untouched so
  // the dashboard and internal services can use this URL too.
  if (claims.iss === REAL_KEY) return { token, passthrough: true };

  let row;
  try {
    row = await keyStore.find(claims.iss);
  } catch (err) {
    console.error("gateway: key lookup failed:", err.message);
    return { error: "key lookup failed", status: 503 };
  }

  if (!row) return { error: `invalid API key: ${claims.iss}`, status: 401 };
  if (row.revoked_at) return { error: `API key revoked: ${claims.iss}`, status: 401 };
  if (!row.api_secret_enc) return { error: `API key has no stored secret`, status: 401 };

  let secret;
  try {
    secret = decryptSecret(row.api_secret_enc);
  } catch {
    return { error: "could not decrypt stored secret", status: 500 };
  }

  if (!verifyJwtHs256(token, secret)) {
    return { error: "invalid token signature", status: 401 };
  }
  if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000)) {
    return { error: "token expired", status: 401 };
  }

  // Re-sign the claims verbatim — same identity, same grants, same expiry —
  // changing only the issuer. Anything else would alter the caller's
  // permissions behind their back.
  return { token: signJwtHs256(claims, REAL_KEY, REAL_SECRET), issuedKey: claims.iss };
}

const log = (...args) => VERBOSE && console.log("gateway:", ...args);

// ── HTTP: Twirp server APIs and the /rtc/validate pre-check ──

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Twirp (RoomService, Egress, Ingress, SIP, AgentDispatch): Bearer token
  if (url.pathname.startsWith("/twirp/")) {
    const auth = req.headers.authorization || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const result = await translateToken(bearer);
    if (result.error) return reject(res, result);
    log(url.pathname, result.issuedKey ? `via ${result.issuedKey}` : "passthrough");
    return forward(req, res, url, { authorization: `Bearer ${result.token}` });
  }

  // Signalling pre-check: /rtc/validate, /rtc/v1/validate
  if (url.pathname.startsWith("/rtc")) {
    const result = await translateToken(url.searchParams.get("access_token"));
    if (result.error) return reject(res, result);
    url.searchParams.set("access_token", result.token);
    log(url.pathname, result.issuedKey ? `via ${result.issuedKey}` : "passthrough");
    return forward(req, res, url, {});
  }

  // Anything else (health checks, etc.) goes straight through.
  return forward(req, res, url, {});
});

function reject(res, { error, status }) {
  log("rejected:", error);
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(error);
}

function forward(req, res, url, headerOverrides) {
  const proxied = http.request(
    {
      host: UPSTREAM.hostname,
      port: UPSTREAM.port || 80,
      method: req.method,
      path: url.pathname + url.search,
      headers: { ...req.headers, host: UPSTREAM.host, ...headerOverrides },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    }
  );
  proxied.on("error", (err) => {
    console.error("gateway: upstream error:", err.message);
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("upstream unavailable");
  });
  req.pipe(proxied);
}

// ── WebSocket: the signalling connection itself ──

server.on("upgrade", async (req, clientSocket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (!url.pathname.startsWith("/rtc")) {
    return clientSocket.destroy();
  }

  const result = await translateToken(url.searchParams.get("access_token"));
  if (result.error) {
    log("ws rejected:", result.error);
    clientSocket.write(
      `HTTP/1.1 ${result.status} Unauthorized\r\nconnection: close\r\n\r\n${result.error}`
    );
    return clientSocket.destroy();
  }
  url.searchParams.set("access_token", result.token);
  log("ws", url.pathname, result.issuedKey ? `via ${result.issuedKey}` : "passthrough");

  const proxied = http.request({
    host: UPSTREAM.hostname,
    port: UPSTREAM.port || 80,
    method: "GET",
    path: url.pathname + url.search,
    headers: { ...req.headers, host: UPSTREAM.host },
  });

  proxied.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    // Replay the 101 handshake verbatim, then get out of the way and let the
    // two sockets talk to each other.
    const lines = [`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}`];
    for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
      lines.push(`${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i + 1]}`);
    }
    clientSocket.write(lines.join("\r\n") + "\r\n\r\n");

    if (upstreamHead?.length) clientSocket.write(upstreamHead);
    if (head?.length) upstreamSocket.write(head);

    clientSocket.setNoDelay(true);
    upstreamSocket.setNoDelay(true);

    upstreamSocket.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  // Upstream answered with a normal response instead of upgrading — usually a
  // rejected token. Relay it so the client sees the real reason.
  proxied.on("response", (upstreamRes) => {
    const lines = [`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}`];
    for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
      lines.push(`${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i + 1]}`);
    }
    clientSocket.write(lines.join("\r\n") + "\r\n\r\n");
    upstreamRes.pipe(clientSocket);
  });

  proxied.on("error", (err) => {
    console.error("gateway: ws upstream error:", err.message);
    clientSocket.destroy();
  });

  proxied.end();
});

server.listen(PORT, () => {
  console.log(`gateway listening on :${PORT}`);
  console.log(`  upstream    ${UPSTREAM.origin}`);
  console.log(`  server key  ${REAL_KEY} (passthrough)`);
  console.log(`  key store   ${keyStore.describe}`);
});
