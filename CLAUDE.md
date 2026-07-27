# LiveKit UI

Self-hosted dashboard for managing a LiveKit deployment: rooms, agents, telephony, egress/ingress, sandboxes, model providers, secrets, API keys and session history. Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui.

`README.md` is the user-facing setup guide. This file is the working context for editing the code.

## Commands

```bash
npm run dev      # Next dev server. The user runs it on port 3010, not 3000.
npm run build    # next build --webpack — run before claiming a change compiles
npm run lint     # eslint
npm test         # node --test tests/**/*.test.mjs
npm run gateway  # API-key translating proxy on :7885 (see gateway/CLAUDE.md)
```

`npx tsc --noEmit` is the fast correctness check; `npm run build` additionally validates App Router constraints that `tsc` misses (e.g. a page exporting anything but a default component).

## Processes this depends on

The dashboard is a control plane — most pages are only as alive as the services behind them.

| Process | Port | Needed for |
|---|---|---|
| `livekit-server --config livekit.yaml --dev` | 7880 | everything |
| Redis (`livekit-redis` container) | 6399 | SIP, egress, ingress |
| `livekit-sip` (container, `sip.yaml`) | 5060 | telephony pages |
| Deployed agents (`data/agents/<name>/agent.py`) | — | agent preview, SIP calls reaching an agent |
| Sandbox apps (`data/sandboxes/<name>`) | 31xx | `/sandbox/<name>` |
| Session observers (`observer/session-observer.mjs`) | — | history for sessions no browser hosted; one child per live room, only when capture is on |

`livekit-server` reads its config **only at boot**. Editing `livekit.yaml` (adding `redis:`, keys, webhooks) does nothing until it is restarted.

Egress, ingress and SIP register with the server over Redis. Without a `redis:` block the server answers `"sip not connected (redis required)"` — `src/lib/livekit-errors.ts` maps that to a 503 with `serviceAvailable: false` so pages explain themselves instead of showing a raw error. That is a deployment gap, not a bug.

### Two addresses for one server

`LIVEKIT_URL` is the **server-to-server** address (`src/lib/livekit.ts` builds the SDK clients from it). Under Docker it is an internal hostname like `http://livekit:7880`, which a browser cannot resolve.

`LIVEKIT_PUBLIC_URL` is the **browser-facing** one — what the console, the agent preview and generated sandboxes dial. It is resolved per request in `src/lib/runtime-config.ts` and handed to client pages through `RuntimeConfigProvider`, mounted in the dashboard layout. Nothing browser-facing may read `process.env.NEXT_PUBLIC_*` from a client component: `next build` inlines those, so the value freezes at image-build time and one image stops working for a second deployment. `useRuntimeConfig()` throws outside the provider rather than falling back to localhost.

Behind TLS this must be `wss://` — an `https` page cannot open a `ws://` socket. Getting it wrong does not read as a URL problem: the browser reaches whatever LiveKit *is* at that address, shows it a token signed by a key it doesn't have, and the console reports `invalid API key`.

## Architecture

```
Browser ──> Next.js (dashboard + /api/*) ──> livekit-server ──> agents / SIP / egress
                     │                             │
                     │                             └─ room_started webhook
                     │                                     │
                     ├── SQLite or Postgres  (src/lib/db.ts)│
                     └── spawns Python agents, sandbox Next apps, and
                         session observers as child processes ◄──┘
```

Two kinds of state, and the distinction matters constantly:

- **LiveKit-owned** — rooms, participants, SIP trunks, dispatch rules, egress. Read and written through the server SDK. Nothing is mirrored locally; the dashboard is a view.
- **Dashboard-owned** — users, sessions, agents' saved config, providers, secrets, phone numbers, sandbox apps, webhook log, console session history. Lives in our database.

Console session **audio** is the exception to both: the bytes go wherever Settings → Storage points (local disk or an S3-compatible bucket, see `src/lib/storage.ts`), and only the index lives in the database. `/sessions/history/[id]` replays a saved session by joining the two.

### Who writes a session to history

Two writers, and the difference explains most questions about missing sessions:

- **A console tab.** `use-session-persistence.ts` posts what the browser held when the session ends. This is the only writer for sessions the console hosts, and the richer one — it has the local microphone, the config and the agent's metrics stream.
- **A session observer**, when capture is switched on in Settings → Project. The `room_started` webhook spawns `observer/session-observer.mjs`, which joins the room hidden and drops a capture file that `src/lib/session-capture.ts` adopts. This is what puts an inbound SIP call or a sandbox app into the history at all.

Capture is **off by default** (`capture_config`, one row). With it off, a session nobody had a tab open for leaves no trace — that is the product's default, not a bug. `console_sessions.source` records which writer won; a capture never overwrites a console row (`SESSION_SOURCE_RANK`).

Phone numbers are the confusing one: that page is a *local registry* only. Adding a number provisions nothing and needs no SIP.

### Reading a session back

The console and the replay at `/sessions/history/[id]` put events, metrics, the transcript and both timelines on **one wall-clock axis**, driven by the session recording: one audio handle per view, and a click anywhere moves every panel. Two facts govern anything drawn there, both detailed in `src/components/CLAUDE.md`:

- A recording's stored `durationMs` is wall-clock, not the length of the audio file. Treating them as the same stretches the whole plot against the playhead.
- A metric's timestamp is when the agent *reported* it, not when the work happened — TTS in particular is still audibly playing after its metric arrives. `metricWindows()` owns that translation.

## Conventions

- **Every API route** starts with `getSession()` → 401, then `session.role === "member"` → 403 for writes. Members are view-only.
- **Auth guard** lives in `src/app/(dashboard)/layout.tsx`, not middleware. Middleware only sees whether a cookie *exists* (no DB access from the edge), so a stale cookie would otherwise render the whole dashboard with every fetch 401ing.
- **Dashboard pages are client components** that fetch from `/api/*`. They do not read the database directly.
- **Feedback is a toast** (`sonner`, mounted in the root layout), not a modal. Long errors use `duration: Infinity` + `closeButton`.
- Prefer deriving state from the URL over mirroring it in `useState` — see `?provider=<slug>` on the providers page and `?setting=<tab>` in the agent builder.
- `eslint` runs `react-hooks/set-state-in-effect` as an **error**. Calling a function that sets state synchronously at the top of an effect trips it; fetch-then-`.then(setX)` does not.

## Known rough edges

- Several pre-existing lint errors (`set-state-in-effect`, unescaped entities) exist in older pages. Compare error counts before/after a change rather than assuming a clean baseline.
- `noise_cancellation.BVC()` in generated agent code is a LiveKit Cloud feature. Self-hosted it logs `noise cancellation is not authorized (404)` and no-ops. Harmless, noisy.
- The agent builder's live preview dispatches the **deployed** agent, so it tests what is deployed, not unsaved edits.
