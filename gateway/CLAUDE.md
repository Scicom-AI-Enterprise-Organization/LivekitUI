# gateway — API-key translating proxy

`npm run gateway` → `:7885`.

## Why it exists

The OSS `livekit-server` reads its API keys once, at boot. Neither rewriting `key_file` nor `SIGHUP` reloads them, so runtime-issued keys — the thing LiveKit Cloud does — are impossible if clients talk to the server directly.

This process sits in front. A client signs a token with the key we issued in **Settings > API keys**; the gateway looks that key up in the database, verifies the signature itself, re-signs the identical claims with the server's one real key, and forwards. To the client it looks like Cloud: one URL, many keys, revocation effective immediately.

```
client ──(issued key)──> gateway :7885 ──(real key)──> livekit-server :7880
             │
             └── WebRTC media negotiates with the SFU directly, bypassing this process
```

Only signalling passes through. Media never does — so the gateway is not on the latency path, and a gateway restart does not drop in-flight audio.

## Constraints

- Issued key secrets must be **recoverable**, not just hashed, because the gateway needs the plaintext to verify a client signature. They are AES-256-GCM encrypted at rest (`src/lib/api-keys.ts`, `API_KEYS_ENC_KEY`, falling back to a key derived from `SESSION_SECRET`). Changing either value makes existing issued keys unreadable.
- `LIVEKIT_GATEWAY_PUBLIC_URL` is what gets handed out alongside a generated key. It must point at the gateway, not at `livekit-server`, or generated keys are rejected.
- Plain `.mjs` on purpose — no build step, so it can run from the same image as the dashboard with a different command.
- Revocation is a database check per request; there is no cache to invalidate.
