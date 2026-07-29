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

# Scicom's drop-in turn detector, selectable in the agent builder. Same
# MultilingualModel API as the stock plugin, but each prediction goes to a vLLM
# endpoint instead of a local ONNX runner. Installed unconditionally because the
# builder can emit either variant at any time. Pulls transformers, which it uses
# for the tokenizer; `git` is already in the system deps above for this.
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    "stt-api @ git+https://github.com/Scicom-AI-Enterprise-Organization/STT-API.git"

# ── Turn-detector model weights ──
# For the two TEXT turn detectors only. The builder's default is now the audio
# v1-mini model, whose weights are compiled into livekit-local-inference (a
# livekit-agents dependency) and which downloads nothing — so this layer could
# go the day the text options are retired, but not before.
#
# The stock text plugin loads its weights with local_files_only=True and will
# NEVER fetch them at run time. Without this step an agent using it logs
# `Could not find file "model_q8.onnx"` and the inference proc dies; the worker
# still registers, so it looks healthy while turn detection is broken.
#
# This also serves the Scicom variant, which needs no ONNX of its own but does
# load the same repo's tokenizer at the same revision — already in this cache.
#
# HF_HOME is pinned so the build-time cache is the one the agent reads later,
# rather than depending on $HOME being identical in both phases.
#
# Costs ~460 MB and both halves earn their place. english.py registers its
# runner at import scope with no condition, so ANY import of the package — the
# Scicom variant imports .base — pulls the 67 MB English model in and the
# inference proc initialises it. The 393 MB intl model is conditional: its
# runner is skipped when LIVEKIT_REMOTE_EOT_URL is set. Two registered runners
# is also why a broken image logs the model_q8.onnx traceback twice.
# A non-zero exit fails the build, which is right: the alternative is shipping
# an image whose agents cannot detect end-of-turn.
ENV HF_HOME=/opt/hf-cache
RUN python3 -m livekit.agents download-files

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

# No NEXT_PUBLIC_* build args. The browser-facing addresses used to be inlined
# into the client bundles here, which froze them at image-build time: an image
# built without the right build arg shipped a bundle that dialled
# ws://localhost:7880 from a public hostname, and the resulting failure surfaced
# as a misleading "invalid API key". They are runtime env now — see
# src/lib/runtime-config.ts — so one image works for every deployment.
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
# Browser-facing addresses. LIVEKIT_URL above is the server-to-server one and
# is usually an internal hostname, so the browser needs its own. Override these
# on the running container — behind TLS they must be wss://, because an https
# page cannot open a ws:// socket.
ENV LIVEKIT_PUBLIC_URL=ws://localhost:7880
ENV LIVEKIT_GATEWAY_PUBLIC_URL=ws://localhost:7885
ENV SANDBOX_DOMAIN=http://localhost:3000
ENV LIVEKIT_REGION=local
# Shown in the sidebar footer. Pass `--build-arg APP_VERSION=<git short sha>`;
# defaults to "dev" for a local build.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
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
