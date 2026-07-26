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

`console-sessions.ts` serialises `console_sessions` rows for the API and normalises the two backends' time formats (`Date` from Postgres, `"YYYY-MM-DD HH:MM:SS"` from SQLite) — use `dbTimeToIso` rather than `new Date(row.created_at)`. It also owns `SESSION_SOURCE_RANK`: a server-side capture must never overwrite a console row, since the tab was the better witness.

## session-observer.ts / session-capture.ts / capture-settings.ts — recording what no browser saw

A console tab can only record sessions it is in. Everything else — an inbound SIP call, a sandbox app, any client with a token — used to leave nothing behind. These three files are the other path, and it is **off until switched on** in Settings → Project (`capture_config`, one row, `capture-settings.ts`).

The flow, in order: `room_started` webhook → `ensureObserver()` spawns `observer/session-observer.mjs` (detached, PID file in `data/observers`, log in `data/observer-logs`) → the child joins the room **hidden + recorder** with a subscribe-only token → on room close it writes `data/session-captures/<id>.json` (+ `.wav`) → `adoptCaptures()` turns the pair into a `console_sessions` row and pushes the audio through `saveRecording()`.

Load-bearing details:

- **The child holds no dashboard credentials.** It drops files; the server adopts them. That is why there is no machine-auth path into `/api/sessions`, and why a capture survives a dashboard restart.
- **Raw metrics.** The observer stores agent metric payloads exactly as they arrived; `parseConsoleMetric` runs during adoption, so captures cannot drift from the parser the console and the replay share.
- **Claim by rename.** Adoption renames a capture before reading it, so a webhook and a page load cannot both adopt it. A `.claimed` file older than five minutes is reclaimed.
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

Client OS, transport protocol and country are **LiveKit Cloud analytics fields** — the OSS server never emits them on any endpoint. They are surfaced as `UNAVAILABLE_SELF_HOSTED` reasons rather than zeros. The one exception is platform: `/api/livekit/token` stamps `client.platform` from the browser's User-Agent, so sessions the dashboard starts do get counted.

## Others

- `auth.ts` — sessions (random token in DB, `lk_session` httpOnly cookie), bcrypt, role helpers.
- `sandbox.ts` — clones a template into `data/sandboxes/<name>`, writes its `.env.local` (including `NEXT_PUBLIC_AGENT_NAME`, which decides whether the sandbox requests a named agent dispatch), and runs it on a reused free port.
- `api-serialize.ts` — protobuf → JSON shapes for API responses. Keep field names stable; pages depend on them.
- `api-keys.ts` / `api-tokens.ts` — issued LiveKit keys (AES-256-GCM, plaintext recoverable for the gateway) and REST bearer tokens (SHA-256 only, never recoverable).
