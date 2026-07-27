# Single image — LivekitUI needs to spawn Python agents and
# sandbox dev servers at runtime, so everything lives together.

# Node 24, not 20: the key gateway (gateway/server.mjs) imports the dashboard's
# src/lib/api-keys.ts directly so the crypto has a single source of truth. That
# needs native TypeScript type stripping, which landed unflagged in Node 23.6 —
# on Node 20 the import fails with `Unknown file extension ".ts"`.
FROM node:24-bookworm-slim

# ── System deps ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3-pip \
    curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Make python3.11 the default python3
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# ── Python agent dependencies ──
# One plugin per provider the code generator can emit (Settings > Providers),
# plus the voice-pipeline pieces and the MCP extra for tool servers. A missing
# plugin deploys fine and then the agent process dies on an ImportError.
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    "livekit-agents[mcp]~=1.5" \
    "livekit-plugins-openai~=1.5" \
    "livekit-plugins-anthropic~=1.5" \
    "livekit-plugins-google~=1.5" \
    "livekit-plugins-groq~=1.5" \
    "livekit-plugins-deepgram~=1.5" \
    "livekit-plugins-cartesia~=1.5" \
    "livekit-plugins-elevenlabs~=1.5" \
    "livekit-plugins-silero~=1.5" \
    "livekit-plugins-turn-detector~=1.5" \
    "livekit-plugins-noise-cancellation~=0.2" \
    python-dotenv aiohttp

WORKDIR /app

# ── Next.js app dependencies ──
COPY package.json package-lock.json* ./
RUN npm ci

# ── Sandbox: agent-starter-react ──
COPY example/agent-starter-react/package.json example/agent-starter-react/package-lock.json* ./example/agent-starter-react/
RUN cd example/agent-starter-react && (npm ci || npm install)

# ── Sandbox: meet ──
COPY example/meet/package.json example/meet/package-lock.json* ./example/meet/
RUN cd example/meet && (npm ci || npm install)

# ── Copy source and build ──
COPY . .

# NEXT_PUBLIC_* are inlined into the client bundles by `next build`, not read at
# runtime — they are used from client components (agents/[id]/console,
# agents/builder, sandboxes). Setting them as ENV below the build would leave the
# browser dialling ws://localhost:7880. They must be present here, as build args.
ARG NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
ARG NEXT_PUBLIC_LIVEKIT_GATEWAY_URL=ws://localhost:7885
ARG NEXT_PUBLIC_SANDBOX_DOMAIN=http://localhost:3000
ARG NEXT_PUBLIC_LIVEKIT_REGION=local
ENV NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL
ENV NEXT_PUBLIC_LIVEKIT_GATEWAY_URL=$NEXT_PUBLIC_LIVEKIT_GATEWAY_URL
ENV NEXT_PUBLIC_SANDBOX_DOMAIN=$NEXT_PUBLIC_SANDBOX_DOMAIN
ENV NEXT_PUBLIC_LIVEKIT_REGION=$NEXT_PUBLIC_LIVEKIT_REGION

RUN npm run build

# ── Data directories ──
RUN mkdir -p data/agents data/agent-logs data/sandbox-logs

# ── Runtime config ──
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DB_TYPE=postgres
ENV LIVEKIT_URL=http://localhost:7880
ENV LIVEKIT_PROMETHEUS_URL=http://localhost:6789/metrics
ENV GATEWAY_PORT=7885
# No venv in the image — agents run on the system interpreter that got the
# plugins above. Without this, deploying an agent fails looking for a venv.
ENV AGENT_PYTHON_BIN=/usr/bin/python3

EXPOSE 3000 7885

# `next start` from /app, not the standalone server. The standalone bundle
# chdir()s into .next/standalone, and everything this app resolves at runtime is
# relative to process.cwd() — data/ (agent code, sandboxes, logs),
# observer/session-observer.mjs, and example/<template> for sandbox scaffolding.
# Under standalone those all point at a tree where the sandbox templates have no
# node_modules, and .next/static + public are never copied in either, so every
# asset 404s. Staying in /app keeps all of it addressable.
CMD ["npm", "start"]
