# LiveKit UI

Self-hosted dashboard for managing [LiveKit](https://livekit.io) infrastructure. Built with Next.js 16, React 19, Tailwind CSS v4, and shadcn/ui.

## Features

- **Overview** — connection stats, participant minutes, data transfer, room sessions
- **Sessions** — browse and filter room sessions
- **Agents** — deploy and monitor voice/video agents, agent builder
- **Telephony** — calls, dispatch rules, phone numbers (manual + Twilio/Vonage/Telnyx import), SIP trunks
- **Egresses / Ingresses** — manage media export and import streams
- **Settings** — project config, sandbox apps, team members, API keys, webhooks
- **Auth** — login, register, invite-based onboarding, cookie-based sessions
- **RBAC** — Owner, Admin (manage resources), Member (view-only)

## Getting Started

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your LiveKit server URL and credentials. See `.env.example` for all options.

### 2. Install and run

```bash
npm install
npm run dev
```

Open http://localhost:3000. Register your first account — it will be created as **Owner**.

### 3. Docker

```bash
docker compose up --build
```

## Database

SQLite by default (zero config, stored at `./data/livekit.db`). Switch to PostgreSQL by setting in `.env`:

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

| Permission | Owner | Admin | Member |
|---|---|---|---|
| View all pages | Yes | Yes | Yes |
| Manage agents, telephony, egress/ingress | Yes | Yes | No |
| Manage settings, API keys, webhooks | Yes | Yes | No |
| Invite & remove team members | Yes | No | No |
| Delete project (danger zone) | Yes | No | No |

## Project Structure

```
src/
  app/
    (auth)/          Login, register
    (dashboard)/     All dashboard pages
    api/             REST endpoints (auth, phone-numbers, api-keys, webhooks)
  components/
    ui/              shadcn/ui components (Button, Card, Badge, Dialog, etc.)
    livekit/         Dashboard components (sidebar, stat-card, charts, data-table)
  lib/
    auth.ts          Session management, RBAC helpers
    db.ts            Database abstraction (SQLite + PostgreSQL)
    utils.ts         Tailwind class merge utility
```

## Tech Stack

- [Next.js 16](https://nextjs.org) — framework
- [React 19](https://react.dev) — UI
- [Tailwind CSS v4](https://tailwindcss.com) — styling
- [shadcn/ui](https://ui.shadcn.com) + [Radix UI](https://www.radix-ui.com) — components
- [LiveKit SDK](https://docs.livekit.io) — server SDK + React components
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) / [pg](https://node-postgres.com) — database
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js) — password hashing
- [Framer Motion](https://www.framer.com/motion) — animations
