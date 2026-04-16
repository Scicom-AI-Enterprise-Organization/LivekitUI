# LiveKit UI

Self-hosted dashboard for managing [LiveKit](https://livekit.io) infrastructure. Built with Next.js 16, React 19, Tailwind CSS v4, and shadcn/ui.

## Features

- **Overview** — connection stats, participant minutes, data transfer, room sessions
- **Sessions** — live room list with participants, status, and duration from the LiveKit server
- **Agents** — monitor connected agents, active sessions, historical chart, and deploy new agents via the agent builder
- **Telephony** — calls, dispatch rules, phone numbers (manual + Twilio/Vonage/Telnyx import), SIP trunks
- **Egresses / Ingresses** — manage media export and import streams
- **Sandbox** — create and manage sandbox apps from templates, proxied through the dashboard at `/sandbox/{name}`
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

## API Keys

The **Settings > API Keys** page shows your LiveKit server credentials (from `.env`). Use these to connect agents and sandbox apps:

```env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
```

The API secret is hidden by default and can be revealed by admins only.

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
python3.10 -m venv venv
source venv/bin/activate
pip install "livekit-agents[openai,silero]~=1.5" python-dotenv
python src/agent.py download-files
cp .env.example .env.local   # edit with LiveKit + OpenAI credentials
```

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

Phone numbers can always be added manually. To import from a provider, add credentials to `.env`:

| Provider | Variables |
|----------|-----------|
| Twilio   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| Vonage   | `VONAGE_API_KEY`, `VONAGE_API_SECRET` |
| Telnyx   | `TELNYX_API_KEY` |

## Roles

| Permission | Admin | Member |
|---|---|---|
| View all pages | Yes | Yes |
| Manage agents, telephony, egress/ingress | Yes | No |
| Manage settings, API keys, webhooks | Yes | No |
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
      settings/          Project, sandbox, team members, API keys, webhooks
    api/                 REST endpoints
    sandbox/             Sandbox proxy routes
  components/
    ui/                  shadcn/ui (Button, Card, Badge, Dialog, Select, etc.)
    livekit/             Dashboard components (sidebar, stat-card, charts, data-table, top-bar)
  lib/
    auth.ts              Session management, RBAC helpers
    db.ts                Database abstraction (SQLite + PostgreSQL)
    livekit.ts           LiveKit server SDK clients
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
