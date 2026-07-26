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

## Others

- `auth.ts` — sessions (random token in DB, `lk_session` httpOnly cookie), bcrypt, role helpers.
- `sandbox.ts` — clones a template into `data/sandboxes/<name>`, writes its `.env.local` (including `NEXT_PUBLIC_AGENT_NAME`, which decides whether the sandbox requests a named agent dispatch), and runs it on a reused free port.
- `api-serialize.ts` — protobuf → JSON shapes for API responses. Keep field names stable; pages depend on them.
- `api-keys.ts` / `api-tokens.ts` — issued LiveKit keys (AES-256-GCM, plaintext recoverable for the gateway) and REST bearer tokens (SHA-256 only, never recoverable).
- `prometheus.ts` — scrapes the LiveKit metrics port for the Overview page.
