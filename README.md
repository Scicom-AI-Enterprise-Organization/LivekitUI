# LiveKit UI

Self-hosted dashboard for managing [LiveKit](https://livekit.io) infrastructure. Built with Next.js 16, React 19, Tailwind CSS v4, and shadcn/ui.

## Features

- **Overview** — connection stats, participant minutes, data transfer, room sessions
- **Sessions** — live room list with participants, status, and duration from the LiveKit server
- **Agents** — monitor connected agents, active sessions, historical chart, and deploy new agents via the agent builder
- **Telephony** — calls, dispatch rules, phone numbers (manual + Twilio/Vonage/Telnyx import), SIP trunks
- **Egresses / Ingresses** — manage media export and import streams
- **Sandbox** — create and manage sandbox apps from templates (Web Voice Agent, Video Conference), auto-assigned ports on localhost
- **Settings** — project config, team members, webhooks
- **Auth** — login, register, invite-based onboarding with role assignment
- **RBAC** — Admin (full access), Member (view-only)

## Quick Start

### 1. Install LiveKit Server

```bash
curl -sSL https://get.livekit.io | bash
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
Dashboard (3000) ────────┘ (monitors rooms, agents, sessions)
```

1. The **LiveKit server** manages rooms and media routing
2. The **Python agent** registers with the server and waits for jobs
3. The **React frontend** creates a room — the server auto-dispatches an available agent
4. The **Dashboard** monitors everything via the LiveKit server API

### Agent Dispatch

Agents can register in two modes:

- **Auto-dispatch** (default) — `@server.rtc_session()` — server sends jobs to any available agent
- **Explicit dispatch** — `@server.rtc_session(agent_name="my-bot")` — only dispatched when requested by name

Sandbox apps use auto-dispatch. For production, use explicit dispatch with [dispatch rules](https://docs.livekit.io/agents/server/agent-dispatch/).

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
| Manage settings, webhooks, team members | Yes | No |
| Invite and remove members | Yes | No |
| Create and delete sandbox apps | Yes | No |
| Delete project (danger zone) | Yes | No |

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
      settings/          Project, sandbox, team members, webhooks
    api/                 REST endpoints
  components/
    ui/                  shadcn/ui (Button, Card, Badge, Dialog, Select, etc.)
    livekit/             Dashboard components (sidebar, stat-card, charts, data-table, top-bar)
  lib/
    auth.ts              Session management, RBAC helpers
    db.ts                Database abstraction (SQLite + PostgreSQL)
    livekit.ts           LiveKit server SDK clients
    sandbox.ts           Sandbox process management
    utils.ts             Tailwind class merge utility
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
