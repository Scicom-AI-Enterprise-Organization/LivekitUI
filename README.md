# LiveKit UI

Self-hosted dashboard for managing [LiveKit](https://livekit.io) infrastructure. Built with Next.js 16, React 19, Tailwind CSS v4, and shadcn/ui.

## Features

- **Overview** — connection stats, participant minutes, data transfer, room sessions
- **Sessions** — live room list with participants, status, and duration from the LiveKit server
- **Agents** — monitor connected agents, active sessions, historical chart, and deploy new agents via the agent builder
- **Telephony** — calls, dispatch rules, phone numbers (manual + Twilio/Vonage/Telnyx import), SIP trunks
- **Egresses / Ingresses** — manage media export and import streams
- **Sandbox** — create and manage sandbox apps from templates, proxied through the dashboard at `/sandbox/{name}`
- **Providers** — register any OpenAI-compatible inference endpoint (vLLM, Ollama, LiteLLM, …) and its models; the agent builder picks its model lists from here
- **Secrets** — project-wide API keys, injected into every deployed agent and selectable as a provider's credential
- **Settings** — project config, team members, API keys, webhooks with live event log
- **Auth** — login, register, invite-based onboarding with role assignment
- **RBAC** — Admin (full access), Member (view-only)

## Quick Start

### 1. Install LiveKit Server

```bash
curl -sSL https://get.livekit.io | bash
livekit-server --config livekit.yaml --dev
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your LiveKit credentials. See `.env.example` for all available options.

### 3. Install and run

```bash
npm install
npm run dev
```

Open http://localhost:3000. The first registered account becomes the **Admin**.

### 4. Docker

```bash
docker compose up --build
```

## Running the Full Stack

Run each in a separate terminal:

| Service | Command | Port |
|---------|---------|------|
| LiveKit Server | `livekit-server --config livekit.yaml --dev` | 7880 |
| Dashboard | `npm run dev` | 3000 |
| Key gateway (optional) | `npm run gateway` | 7885 |
| Voice Agent | `cd example/agent-starter-python && source venv/bin/activate && python src/agent.py dev` | — |
| Agent Frontend | `cd example/agent-starter-react && npx next dev -p 3002` | 3002 |

### How it connects

```
Browser (3002) ──> LiveKit Server (7880) ──> Python Agent
                         |
Dashboard (3000) ────────┘ (monitors rooms, agents, sessions, webhooks)
```

1. The **LiveKit server** manages rooms and media routing
2. The **Python agent** registers with the server and waits for jobs
3. The **React frontend** creates a room — the server auto-dispatches an available agent
4. The **Dashboard** monitors everything via the LiveKit server API and receives webhook events

### Agent Dispatch

Agents can register in two modes:

- **Auto-dispatch** (default) — `@server.rtc_session()` — server sends jobs to any available agent
- **Explicit dispatch** — `@server.rtc_session(agent_name="my-bot")` — only dispatched when requested by name

Sandbox apps use auto-dispatch. For production, use explicit dispatch with [dispatch rules](https://docs.livekit.io/agents/server/agent-dispatch/).

## Webhooks

The dashboard includes a built-in webhook receiver with a live event log. To enable:

1. Add to your `livekit.yaml`:

```yaml
webhook:
  urls:
    - http://localhost:3000/api/webhooks/livekit
  api_key: your_api_key
```

2. Restart the LiveKit server

3. Go to **Settings > Webhooks** to see incoming events (room_started, participant_joined, etc.) in real-time

Events are color-coded, stored in the database, and you can click any event to view the full JSON payload.

## Sandbox

Sandbox apps let you quickly spin up frontend templates for testing agents. Created from **Settings > Sandbox**.

- Apps are proxied through the dashboard at `http://localhost:3000/sandbox/{name}`
- No direct port access needed — the dashboard handles routing
- Each sandbox gets a random available port internally
- Supports the Web Voice Agent and Video Conference templates

To configure a custom domain for production:

```env
NEXT_PUBLIC_SANDBOX_DOMAIN=https://your-domain.com
```

## Model Providers

**Settings > Providers** owns every model the agent builder offers — nothing is hardcoded in the UI. A provider is one inference endpoint:

| Field | Meaning |
|---|---|
| Slug | Short id used in model refs, e.g. `openai` in `openai/gpt-5.4-mini` |
| Plugin | LiveKit Python plugin used in the generated agent (`openai`, `anthropic`, `deepgram`, `cartesia`, `elevenlabs`, `google`, `groq`) |
| Base URL | OpenAI-compatible endpoint. Empty = the plugin's own default |
| API key secret | Name of a secret from **Settings > Secrets**; the agent reads it as `os.getenv("NAME")` |
| Models | One row per model, tagged `llm` / `realtime` / `stt` / `tts` |
| Voices | Optional voice ids for this provider's TTS and realtime models |

On first run the database is seeded with the built-in OpenAI, Anthropic, Deepgram, Cartesia, and ElevenLabs providers. They are ordinary rows — edit, disable, or delete them freely.

The open dialog is reflected in the URL, so a provider form can be linked or bookmarked directly:

| URL | Opens |
|---|---|
| `/settings/providers?provider=new` | The add-provider form |
| `/settings/providers?provider=<slug>` | That provider's edit form |

### Connection test

**Test connection** must pass before a provider can be saved. It sends one read-only listing request to the endpoint using the selected secret — `GET /models` for OpenAI-compatible, Anthropic, Google, and ElevenLabs; `GET /projects` for Deepgram; `GET /voices` for Cartesia — and reports the endpoint reached and which credential was used. Where the response is a model list, the ids come back so you can tick the ones to add.

A key is required when the provider uses the plugin's hosted default endpoint. With a custom base URL the request is attempted without auth too, so an unauthenticated local server passes. The result is tied to the plugin, base URL, and secret: change any of them and the test must be re-run. Editing an existing provider without touching those three keeps **Save** enabled, since those settings were already verified.

### Adding a custom OpenAI-compatible endpoint

1. **Settings > Secrets** → add the API key, e.g. `MY_VLLM_API_KEY`
2. **Settings > Providers** → *Add provider*
   - Plugin: **OpenAI-compatible**
   - Base URL: `http://localhost:8000/v1`
   - API key secret: `MY_VLLM_API_KEY`
   - **Test connection** → tick the models it reports, or add them by hand
3. The models now appear in the agent builder's **Models & Voice** tab, and the generated Python becomes:

```python
llm=openai.LLM(
    model="Qwen/Qwen3-32B",
    base_url="http://localhost:8000/v1",
    api_key=os.getenv("MY_VLLM_API_KEY"),
),
```

## Tools

**Agents > Tools** is a library of reusable tool definitions — HTTP tools, client tools, and MCP servers. Define one once and import it into any agent from the builder's **Actions** tab.

Importing copies the definition into the agent's own config. Editing or deleting a library entry therefore never breaks an agent that already uses it — the trade-off is that library edits don't propagate to existing agents.

Every dialog is reflected in the URL, so a form can be linked or bookmarked:

| URL | Opens |
|---|---|
| `/agents/tools?kind=http&tool=new` | The new-HTTP-tool form (same for `client`, `mcp`) |
| `/agents/tools?kind=http&tool=<name>` | That tool's edit form |
| `/agents/tools?import=openapi` | The OpenAPI importer |

Each new-tool dialog has an **Example** button that fills in a working definition, so a tool can be tried without inventing one.

### Importing from OpenAPI

**Import from OpenAPI** turns an OpenAPI 3.x or Swagger 2.0 document — JSON or YAML, from a URL or pasted — into HTTP tools:

- One tool per operation, named from `operationId` in snake_case (`getPetById` → `get_pet_by_id`), falling back to method and path
- Path and query parameters, plus top-level request body fields, become tool parameters
- Header parameters become headers for you to fill in, not something the model invents
- `$ref`s are resolved, server URL templates are filled from their defaults, and deprecated operations are skipped and reported

The document is fetched server-side, so specs on hosts without CORS headers work. Nothing is saved until you pick which operations to keep.

### Example MCP server

A dependency-free MCP server is included for testing the MCP path end to end:

```bash
npm run mcp:example      # http://localhost:7900
```

It speaks the HTTP+SSE transport the LiveKit agents MCP plugin expects and exposes three tools: `get_current_time`, `roll_dice`, and `echo`. Add an MCP server in **Tools** pointing at `http://localhost:7900/sse` — the **Example** button fills that URL in for you.

## Secrets

**Settings > Secrets** stores project-wide credentials. Every secret is written to each deployed agent's `.env.local` using its name as the environment variable, so a provider's API key reaches the agent process on deploy or restart. Per-agent secrets (agent builder's **Advanced** tab) override project secrets of the same name.

Secret names must be valid environment variable names. Values are masked in the UI and can only be revealed by owners and admins.

## API Keys

**Settings > API Keys** does two things: it shows the LiveKit server's own key pair (from `.env`), and it generates additional keys you can hand to individual agents, sandboxes, or services.

```env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
```

The server secret is hidden by default and can be revealed by admins only.

### Multiple API keys

`livekit-server` reads its API keys **once, at boot** — rewriting `keys:` / `key_file` or sending `SIGHUP` does not reload them. Issuing keys at runtime therefore requires a translation layer, which is what `gateway/server.mjs` is:

```
agent (issued key) ──> gateway :7885 ──(re-signed with server key)──> livekit-server :7880
                            │
                            └── WebRTC media still flows agent <──> server directly
```

The gateway verifies a client's token against the issued key's secret in the database, then re-signs the identical claims — same identity, grants, and expiry — with the server's real key. Only signalling (`/rtc*` and `/twirp/*`) passes through it; media negotiates ICE directly with the SFU.

```bash
npm run gateway
```

Then set in `.env`:

```env
GATEWAY_PORT=7885
NEXT_PUBLIC_LIVEKIT_GATEWAY_URL=ws://localhost:7885
```

Generated keys are handed out with the **gateway** URL. Pointing them at the LiveKit server directly will fail — the server has never heard of them.

- **Generating** a key shows the secret exactly once; only an AES-256-GCM-encrypted copy is stored (the gateway needs the plaintext back to verify signatures, so a hash won't do).
- **Revoking** takes effect on the key's next request. The gateway reads the database per request with no cache, and no restart is involved.
- The server's own key **passes through** the gateway untouched, so internal services can use either URL.

Encryption uses `API_KEYS_ENC_KEY` if set, otherwise a key derived from `SESSION_SECRET`. Changing either makes previously issued secrets unreadable.

## Setting Up Examples

```bash
cd example

# React frontend (v7 branch for server v1.10.x compatibility)
git clone --depth 1 --branch v7 https://github.com/livekit-examples/agent-starter-react.git
cd agent-starter-react
cp .env.example .env.local   # edit with your LiveKit credentials
npm install
cd ..

# Python voice agent
git clone --depth 1 https://github.com/livekit-examples/agent-starter-python.git
cd agent-starter-python
python3 -m venv venv        # any Python 3.10 – 3.14
source venv/bin/activate
pip install "livekit-agents[mcp]~=1.5" \
  livekit-plugins-openai livekit-plugins-anthropic livekit-plugins-google \
  livekit-plugins-groq livekit-plugins-deepgram livekit-plugins-cartesia \
  livekit-plugins-elevenlabs livekit-plugins-silero \
  livekit-plugins-turn-detector livekit-plugins-noise-cancellation \
  python-dotenv aiohttp
python src/agent.py download-files
cp .env.example .env.local   # edit with LiveKit + OpenAI credentials
```

This venv is also what **Deploy agent** runs in the agent builder, so it needs every plugin the builder can generate — one per provider in **Settings > Providers** — plus `silero`, `turn-detector`, and `noise-cancellation` for the voice pipeline and `[mcp]` for MCP tools. A partial install deploys fine but the agent process exits on an `ImportError`; check **View logs** in the builder if an agent goes OFFLINE right after deploying.

If you already have a suitable interpreter elsewhere, point the dashboard at it instead of creating this venv:

```env
AGENT_PYTHON_BIN=/path/to/python3
```

## REST API

Every dashboard feature is reachable over REST — 70 endpoints, documented in-app at **/api-docs** with a curl sample per endpoint.

### Authentication

Two credentials work on every route:

| Credential | For | How |
|---|---|---|
| `lk_session` cookie | The browser | Set by `POST /api/auth/login` |
| `lkui_…` Bearer token | Scripts, CI, agents | Created under **Settings → Access tokens** |

```bash
export BASE=http://localhost:3000
export TOKEN=lkui_your_token_here
curl $BASE/api/auth/me -H "Authorization: Bearer $TOKEN"
```

A token carries the role of whoever created it, so demoting or removing that account applies to its tokens at once. Revoking takes effect on the next request — tokens are looked up per call with no cache. Unauthenticated API calls get a JSON `401`, never a redirect to the login page.

These are **not** the same as the LiveKit keys under Settings → API keys: a token here calls the dashboard, a LiveKit key connects to the media server. Keeping them separate means an agent holding a LiveKit key cannot reach dashboard endpoints.

### Services that need more than the dev server

Egress, ingress, and SIP each run as their own LiveKit process and register over Redis. A single-node `livekit-server --dev` has none of them, so those endpoints answer:

```json
{ "error": "The egress service is not available on this LiveKit deployment",
  "serviceAvailable": false, "reason": "…" }
```

with status `503`, and the matching pages explain the gap instead of showing an error. `/api/calls` and `/api/phone-numbers` work without any of it.

## Tests

```bash
npm run dev          # in one terminal
TEST_EMAIL=you@example.com TEST_PASSWORD=… npm test
```

Integration tests over the real API — actual routes, database, and LiveKit server, no mocks. The suite mints its own Bearer token, cleans up everything it creates, and revokes the token at the end. Set `TEST_API_TOKEN` instead of the credentials to reuse an existing token, or `TEST_BASE_URL` / `TEST_GATEWAY_URL` for a non-default host.

| File | Covers |
|---|---|
| `tests/authz.test.mjs` | Every protected endpoint rejects both no credentials and a forged token, and the public ones stay reachable |
| `tests/auth.test.mjs` | Login, session cookie, Bearer parity, JSON 401s |
| `tests/access-tokens.test.mjs` | Create, list, use, revoke, `lastUsedAt` |
| `tests/livekit-keys.test.mjs` | Issued keys, the key crypto, gateway translation |
| `tests/core.test.mjs` | Agents, rooms, overview, metrics, secrets, providers, sandboxes, webhooks |
| `tests/media.test.mjs` | Egress, ingress, telephony — validation always, data when the services are up |

Tests that need the gateway or an unavailable LiveKit service skip themselves rather than fail.

## Database

SQLite by default (zero config, stored at `./data/livekit.db`). Switch to PostgreSQL:

```env
DB_TYPE=postgres
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=livekit
POSTGRES_PASSWORD=your_password
POSTGRES_DB=livekit
```

Tables are auto-created on first run.

## Telephony Providers

**Phone numbers** is a local registry — a label, provider tag and capability flags per number. Adding one provisions nothing, so that page works with no SIP service and no provider account. To import numbers you already own, add credentials to `.env`:

| Provider | Variables |
|----------|-----------|
| Twilio   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| Vonage   | `VONAGE_API_KEY`, `VONAGE_API_SECRET` |
| Telnyx   | `TELNYX_API_KEY` |

## SIP Service

**SIP trunks**, **dispatch rules** and **calls** are served by `livekit-sip`, a separate process that registers with the server over Redis. A plain `livekit-server --dev` has no Redis, so those pages answer 503 with *"SIP not connected"*. Egress and ingress work the same way.

### 1. Redis

```bash
docker run -d --name livekit-redis -p 6399:6379 --restart unless-stopped redis:7-alpine
```

### 2. Point the server at it

`livekit.yaml`:

```yaml
redis:
  address: localhost:6399
```

Restart `livekit-server` — it reads its config only at boot.

### 3. Run the SIP service

`sip.yaml` in the repo root is ready to use; it must carry the same `api_key`/`api_secret` and Redis address as the server.

```bash
docker run -d --name livekit-sip --restart unless-stopped \
  -p 5060:5060/udp -p 5060:5060/tcp -p 10000-10100:10000-10100/udp \
  -v "$PWD/sip.yaml:/etc/sip.yaml:ro" \
  livekit/sip:latest --config /etc/sip.yaml
```

`docker logs livekit-sip` should show `connecting to redis` then `sip signaling listening on … port 5060`. The telephony pages go live immediately — no dashboard restart needed.

### Placing a test call

An inbound trunk needs the SIP port reachable **from the provider**, which `localhost` is not. Two ways to test:

- **No provider account** — point a softphone (Linphone, Zoiper, or `sipp`) at `sip:<your-lan-ip>:5060` and let a dispatch rule route it into a room. Fastest way to exercise trunks, rules and the calls page end to end.
- **Real number** — buy one from any SIP trunking provider and aim its trunk at your public address. Twilio (Elastic SIP Trunking) and Telnyx are the best-documented with LiveKit; Vonage, Plivo, Signalwire and Bandwidth all speak plain SIP and work the same way. The number must be reachable over the public internet, so run the SIP service on a host with a routable address or forward UDP/TCP 5060 plus the RTP range.

## Roles

| Permission | Admin | Member |
|---|---|---|
| View all pages | Yes | Yes |
| Manage agents, telephony, egress/ingress | Yes | No |
| Manage settings, API keys, webhooks | Yes | No |
| Manage providers and secrets | Yes | No |
| Reveal secret values | Yes | No |
| Invite and remove members | Yes | No |
| Create and delete sandbox apps | Yes | No |

## Project Structure

```
src/
  app/
    (auth)/              Login, register, invite flow
    (dashboard)/         All dashboard pages
      agents/            Agent list, builder
      sessions/          Live room sessions
      telephony/         Calls, dispatch rules, phone numbers, SIP trunks
      egresses/          Media export
      ingresses/         Media import
      settings/          Project, providers, secrets, team members, API keys, webhooks
    api/                 REST endpoints
    sandbox/             Sandbox proxy routes
  components/
    ui/                  shadcn/ui (Button, Card, Badge, Dialog, Select, etc.)
    livekit/             Dashboard components (sidebar, stat-card, charts, data-table, top-bar)
  lib/
    auth.ts              Session management, RBAC helpers
    db.ts                Database abstraction (SQLite + PostgreSQL)
    livekit.ts           LiveKit server SDK clients
    providers.ts         Model provider types, model refs, built-in provider seeds
    sandbox.ts           Sandbox process management
    utils.ts             Tailwind class merge utility
  middleware.ts          Auth guard + sandbox proxy routing
example/
  agent-starter-react/   Web Voice Agent frontend (Next.js)
  agent-starter-python/  Python voice agent (OpenAI STT/LLM/TTS)
  meet/                  Video conference app
```

## Tech Stack

- [Next.js 16](https://nextjs.org) — framework
- [React 19](https://react.dev) — UI
- [Tailwind CSS v4](https://tailwindcss.com) — styling
- [shadcn/ui](https://ui.shadcn.com) + [Radix UI](https://www.radix-ui.com) — components
- [LiveKit Server SDK](https://docs.livekit.io) — room, agent, egress, ingress, SIP APIs
- [LiveKit Components React](https://docs.livekit.io/reference/components/react/) — agent session UI
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) / [pg](https://node-postgres.com) — database
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js) — password hashing
- [Framer Motion](https://www.framer.com/motion) — animations

## License

MIT
