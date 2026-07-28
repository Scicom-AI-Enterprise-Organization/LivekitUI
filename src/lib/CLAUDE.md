# src/lib — data and service layer

Server-side modules, with one deliberate exception (`providers.ts`).

## db.ts

One `Database` interface, **two full implementations** — SQLite (`better-sqlite3`) and Postgres (`pg`), chosen by `DB_TYPE`. Every schema or method change must be made in **both halves** or Postgres users break silently. The file is long; the halves are marked by `// --- SQLite ---` and `// --- PostgreSQL ---` banners.

Dialect traps that have already bitten:

- SQLite `datetime('now')` vs Postgres `NOW()`; SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` vs `SERIAL`.
- Placeholders are `?` in SQLite and `$1…$n` in Postgres. Adding a column means renumbering every later `$n` in that statement.
- Heredoc/copy-paste can double-escape quotes (`''''`, `datetime(''now'')`). That throws `SqliteError: near "now": syntax error` from `init()`, which runs on *every* request — so the whole app 500s, not just one page.

**Migrations.** `CREATE TABLE IF NOT EXISTS` never adds a column to an existing table. Anything added after a table shipped needs an explicit migration inside `init()`:

- SQLite: read `PRAGMA table_info(<table>)` and `ALTER TABLE … ADD COLUMN` when absent (SQLite has no `IF NOT EXISTS` for columns).
- Postgres: `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` in the init block.

Built-in providers are seeded once, only when the `providers` table is empty, so deleting them does not resurrect them until the table is empty again.

## providers.ts — must stay Node-free

Imported by **client components** (the agent builder, the providers page). No `fs`, `path`, or server-only imports, ever. `db.ts` imports it, never the reverse.

Owns the model-reference format: `"<provider-slug>/<model-id>"`, split on the **first** slash so model ids may contain slashes (`internal-vllm/Qwen/Qwen3-32B`). `resolveModel()` turns a stored value into `{plugin, model, baseUrl, apiKeySecret, audioFormat}` for code generation; `normalizeModelValue()` migrates pre-provider values (`"gpt-5.4-mini"`) via the legacy maps in the builder.

## livekit.ts / livekit-errors.ts

`livekit.ts` returns SDK clients built from `LIVEKIT_URL` + key/secret. `livekit-errors.ts` classifies failures: `not connected|redis required` → 503 with `serviceAvailable: false` (a missing side-service, not a bug), `not found` → 404, else 502. Use it in every route that calls the SDK so pages get a consistent, explainable shape.

## agent-runner.ts

Spawns and supervises deployed Python agents (detached, PID files under `data/agents/<name>/`, logs in `data/agent-logs/`). Because it holds no in-memory state across dev-server reloads, liveness is checked via PID file + `process.kill(pid, 0)`.

`getPythonBin()` resolves `AGENT_PYTHON_BIN` → `example/agent-starter-python/venv` → `.venv`, and its error message is the setup instructions users will actually follow — keep the package list in it accurate as the code generator gains plugins. Deploy writes `.env.local` from project secrets first, then per-agent secrets (so agent secrets win).

## storage.ts / console-recordings.ts / console-sessions.ts

Session audio and the history that plays it back.

`storage.ts` is the object layer: local disk (`data/console-recordings`) or any S3-compatible bucket, chosen in Settings → Storage. S3 is signed with **SigV4 over `fetch`** using `node:crypto` — no AWS SDK, deliberately. Credentials are encrypted with the same AES-256-GCM helpers as issued API keys.

Where an object lives is recorded **per recording** (`session_recordings.storage`), never inferred from the current settings — switching a deployment to S3 must not orphan the audio already on disk. `console-recordings.ts` is the index over that: DB rows for metadata, storage for bytes, plus a one-time adoption of the pre-index JSON sidecars on first read.

`durationMs` on a recording row is **wall-clock** — what the browser recorder measured between start and stop — and is not necessarily the length of the audio in the file (a suspended `AudioContext` produces no samples while time passes). It is fine for a list, but anything aligning events to the audio must use the file's own duration; the player already does. Same for `startedAt`: it is when the recorder started, which is a moment after the room connected, so it is the anchor for the timelines and not the room's start.

`console-sessions.ts` serialises `console_sessions` rows for the API and normalises the two backends' time formats (`Date` from Postgres, `"YYYY-MM-DD HH:MM:SS"` from SQLite) — use `dbTimeToIso` rather than `new Date(row.created_at)`. It also owns `SESSION_SOURCE_RANK`: a server-side capture must never overwrite a console row, since the tab was the better witness.

## session-observer.ts / session-capture.ts / capture-settings.ts — recording what no browser saw

A console tab can only record sessions it is in. Everything else — an inbound SIP call, a sandbox app, any client with a token — used to leave nothing behind. These three files are the other path, and it is **off until switched on** in Settings → Project (`capture_config`, one row, `capture-settings.ts`).

The flow, in order: `room_started` webhook → `ensureObserver()` spawns `observer/session-observer.mjs` (detached, PID file in `data/observers`, log in `data/observer-logs`) → the child joins the room **hidden + recorder** with a subscribe-only token → on room close it writes `data/session-captures/<id>.json` (+ `.wav`) → `adoptCaptures()` turns the pair into a `console_sessions` row and pushes the audio through `saveRecording()`.

Load-bearing details:

- **The child holds no dashboard credentials.** It drops files; the server adopts them. That is why there is no machine-auth path into `/api/sessions`, and why a capture survives a dashboard restart.
- **Raw metrics.** The observer stores agent metric payloads exactly as they arrived; `parseConsoleMetric` runs during adoption, so captures cannot drift from the parser the console and the replay share.
- **Two text topics.** Speech arrives as transcription segments that get revised, joined on a segment id. A typed turn arrives on the chat topic (`lk.chat`) as one complete stream and is recorded as its own line with `via: "text"`. It never becomes a transcription, so an observer that only read the transcription topic would record a text conversation as the user having said nothing at all.
- **Claim by rename.** Adoption renames a capture before reading it, so a webhook and a page load cannot both adopt it. A `.claimed` file older than five minutes is reclaimed.
- **A room name is not a session.** `console_sessions` is `UNIQUE(room)`, which holds for console and preview rooms (uniquely named per session) but not for a room name that gets reused — the agent-assist sandbox uses one room per sandbox, and a SIP dispatch rule can funnel every caller into one. Adoption compares `room_sid` (the room *instance*) via `isSameCall` before letting an existing row win; without that check the second call in a room was discarded, transcript and metrics thrown away while its audio overwrote the first call's, leaving a history entry whose recording and transcript came from different conversations. The upsert also refreshes `started_at`, since the row now describes the newest call and every timeline in the replay is plotted against that instant. What this still cannot do is keep *both* calls: one row per room means history holds the most recent. Per-call history needs the unique index moved to `room_sid` (a table rebuild in SQLite) and a per-call recording key.
- **Audio needs S3 to be reachable.** If `saveRecording` throws, the capture is put back and retried on the next pass for up to 24 hours rather than writing a row that claims audio nobody stored.
- **The console wins.** A participant carrying `CONSOLE_PARTICIPANT_ATTRIBUTE` makes the observer drop its audio (two "mixed" recordings would collide on one storage key) and its row loses to the tab's.
- The observer leaves when the room empties for 30 s, and stops recording at the configured cap. Both matter: a hidden participant that never leaves keeps the room alive.

## overview-stats.ts / prometheus.ts — the Overview page's data

LiveKit keeps **no history**. `listRooms()` is a snapshot of what is live this instant, and `webhook_events` is trimmed to the last 500 rows. An Overview built on either reads zero the moment the last call hangs up — which is exactly what it used to do.

So the dashboard keeps its own record. `recordAnalyticsEvent()` folds each `room_started` / `room_finished` / `participant_joined` / `participant_left` webhook into `room_sessions` and `participant_sessions`; `computeOverviewStats()` aggregates those for a time range. **The webhook receiver is the only writer** — an event missed while the dashboard is down is history that no longer exists, so don't move that call behind a condition. `backfillAnalytics()` replays the retained event log, and runs once when the rollup is empty.

Two traps live here:

- Timestamps are `"YYYY-MM-DD HH:MM:SS"` **UTC** in both dialects. `new Date()` reads that as *local* time and silently shifts every bucket — use `parseDbTime` / `toDbTime`.
- A stay with no `left_at` is counted up to *now*, which is right for a live call and badly wrong for one whose `participant_left` never arrived. `staySeconds()` clamps to the room's `ended_at`; without it a single stale row dwarfs every real call.

`prometheus.ts` scrapes the metrics port (`prometheus.port` in `livekit.yaml`, 6789). Read `livekit_packet_bytes{direction}` for media transfer — **not** `livekit_psrpc_bytes_total`, which measures inter-node signalling and barely moves on a single-node server. Connection success is `rtc_success ÷ signal_connected` from `livekit_participant_join_total`, and is `null` rather than 100 when nothing has connected.

Every counter the server exposes runs from its **last boot**, so displaying one directly means a restart looks like the traffic never happened. Each scrape therefore folds the reading into `metric_counters`, a running total that survives restarts of both processes: the delta is added normally, and when a reading comes back *lower* than the last one the server restarted, so the whole reading is added (it is all traffic since the reset). The same rule applies to the per-day chart built from `bandwidth_samples`. Samples are throttled to one a minute — the page polls every 10s, and keeping all of it would be ~500k rows over the 60-day window for no extra resolution, since the chart buckets by day.

What none of this can recover is traffic that flowed while the dashboard was down. The totals are a floor, not an audit, and the UI says so.

Client OS, transport protocol and country are **LiveKit Cloud analytics fields** — the OSS server never emits them on any endpoint. Where the Overview still has a panel for one, it renders an `UNAVAILABLE_SELF_HOSTED` reason rather than a zero; geo-IP has no panel at all, since a card that can only ever say "not reported" earns nothing. The one exception is platform: `/api/livekit/token` stamps `client.platform` from the browser's User-Agent, so sessions the dashboard starts do get counted.

## Others

- `auth.ts` — sessions (random token in DB, `lk_session` httpOnly cookie), bcrypt, role helpers.
- `sandbox.ts` — clones a template into `data/sandboxes/<name>`, writes its `.env.local` (including `NEXT_PUBLIC_AGENT_NAME`, which decides whether the sandbox requests a named agent dispatch), and runs it on a reused free port. It also writes `LIVEKIT_SERVER_URL` and `SANDBOX_NAME`: a template that calls the SDK from its own routes cannot use the browser-facing `LIVEKIT_URL` (under Docker the container may not resolve it), and one that wants a stable room per sandbox needs to know its own name. Three things about it are load-bearing:

  - **A deploy refreshes the template files.** They used to be skipped when present, which froze a sandbox at the template as it was on the day it was created — a fix or a new route in the template could never reach it, and Restart looked like it did nothing. `data/sandboxes/<name>` is a build output; hand edits there are overwritten, and directories are replaced rather than merged so a deleted template file cannot linger as a live route.
  - **The dev server's PID goes in `sandbox.pid`.** `isRunning`/`stopSandbox` used to fall back to scanning `/proc`, which does not exist on macOS, so a dashboard reload left them unable to see or kill a sandbox: every redeploy leaked the old server, moved to a new port, and left the database pointing at a port nothing was listening on — the sandbox reads "not found or not running" while its old copy still serves. Same PID-file pattern as `agent-runner.ts`; the `/proc` scan remains as a legacy fallback.
  - The generated `next.config.ts` sets `devIndicators: false`. Sandboxes always run under `next dev`, and the floating badge sits over the app's own controls in something you hand to another person.

  One dev-server artifact to expect: the first request or two after a restart can be served from a bundle compiled before the new `.env.local` applied, so a route reads its env as empty and then corrects itself. Re-request before concluding the env is wrong.
- `agent-assist.ts` / `agent-assist-config.ts` — the assist worker's deploy path. **The config half is Node-free** and imported by the sandbox pages, same rule as `providers.ts`; the other half reads the worker source and spawns it, and may not be reached from a client component. Nothing is generated: `example/agent-assist-python/src/agent.py` is configured entirely through env vars, so the deployed copy is byte-identical to the repo's and editing the worker means editing one Python file. Multi-line values (the coaching prompt) go into `.env.local` JSON-quoted — it is one pair per line, and python-dotenv reads `"…\n…"` back intact.
- `assist-sim.ts` — a simulated two-speaker call, behind `POST /api/assist-sim`. The assist template needs two *humans* in two browsers, which makes it the one thing here that cannot be exercised by opening a page — and its per-speaker metrics timeline cannot be checked without a call that had two speakers in it. `example/agent-assist-sim/simulate.py` joins the room twice as ordinary participants (standard kind, `assistRole` in the token's attributes), speaks a script through the project's own TTS and reports what came back. Two things it must keep doing: **push real silence** between lines — an absent track gives VAD no frames to hear a pause in, so the whole call reads as one turn — and take its **voice from an agent**, since an assist worker has no TTS of its own to borrow. It writes its summary to a file rather than stdout, because the LiveKit SDK logs from its own threads and the last line of output is whatever raced to it.
- `api-serialize.ts` — protobuf → JSON shapes for API responses. Keep field names stable; pages depend on them.
- `api-keys.ts` / `api-tokens.ts` — issued LiveKit keys (AES-256-GCM, plaintext recoverable for the gateway) and REST bearer tokens (SHA-256 only, never recoverable).
