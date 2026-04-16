# Single image — LivekitUI needs to spawn Python agents and
# sandbox dev servers at runtime, so everything lives together.

FROM node:20-bookworm-slim

# ── System deps ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3-pip \
    curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Make python3.11 the default python3
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# ── Python agent dependencies ──
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    "livekit-agents[openai,silero,turn-detector]~=1.5" \
    "livekit-plugins-noise-cancellation~=0.2" \
    "livekit-plugins-cartesia~=1.5" \
    "livekit-plugins-deepgram~=1.5" \
    python-dotenv

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
ENV NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880

EXPOSE 3000

CMD ["node", ".next/standalone/server.js"]
