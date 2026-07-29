# LiveKit UI

Self-hosted dashboard for managing a LiveKit deployment: rooms, agents, telephony, egress/ingress, sandboxes, model providers, secrets, API keys and session history. Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui.

`README.md` is the user-facing setup guide. This file is the working context for editing the code.

## Commands

```bash
npm run dev      # Next dev server. The user runs it on port 3010, not 3000.
npm run build    # next build --webpack — run before claiming a change compiles
npm run lint     # eslint
npm test         # node --test tests/**/*.test.mjs
npm run gateway  # API-key translating proxy on :7885 (see gateway/CLAUDE.md)
```

`npx tsc --noEmit` is the fast correctness check; `npm run build` additionally validates App Router constraints that `tsc` misses (e.g. a page exporting anything but a default component).

## Processes this depends on

The dashboard is a control plane — most pages are only as alive as the services behind them.

| Process | Port | Needed for |
|---|---|---|
| `livekit-server --config livekit.yaml --dev` | 7880 | everything |
| Redis (`livekit-redis` container) | 6399 | SIP, egress, ingress |
| `livekit-sip` (container, `sip.yaml`) | 5060 | telephony pages |
| Deployed agents (`data/agents/<name>/agent.py`) | — | agent preview, SIP calls reaching an agent |
| Sandbox apps (`data/sandboxes/<name>`) | 31xx | `/sandbox/<name>` |
| Session observers (`observer/session-observer.mjs`) | — | history for sessions no browser hosted; one child per live room, only when capture is on |

`livekit-server` reads its config **only at boot**. Editing `livekit.yaml` (adding `redis:`, keys, webhooks) does nothing until it is restarted.

Egress, ingress and SIP register with the server over Redis. Without a `redis:` block the server answers `"sip not connected (redis required)"` — `src/lib/livekit-errors.ts` maps that to a 503 with `serviceAvailable: false` so pages explain themselves instead of showing a raw error. That is a deployment gap, not a bug.

### Two addresses for one server

`LIVEKIT_URL` is the **server-to-server** address (`src/lib/livekit.ts` builds the SDK clients from it). Under Docker it is an internal hostname like `http://livekit:7880`, which a browser cannot resolve.

`LIVEKIT_PUBLIC_URL` is the **browser-facing** one — what the console, the agent preview and generated sandboxes dial. It is resolved per request in `src/lib/runtime-config.ts` and handed to client pages through `RuntimeConfigProvider`, mounted in the dashboard layout. Nothing browser-facing may read `process.env.NEXT_PUBLIC_*` from a client component: `next build` inlines those, so the value freezes at image-build time and one image stops working for a second deployment. `useRuntimeConfig()` throws outside the provider rather than falling back to localhost.

Behind TLS this must be `wss://` — an `https` page cannot open a `ws://` socket. Getting it wrong does not read as a URL problem: the browser reaches whatever LiveKit *is* at that address, shows it a token signed by a key it doesn't have, and the console reports `invalid API key`.

## Architecture

```
Browser ──> Next.js (dashboard + /api/*) ──> livekit-server ──> agents / SIP / egress
                     │                             │
                     │                             └─ room_started webhook
                     │                                     │
                     ├── SQLite or Postgres  (src/lib/db.ts)│
                     └── spawns Python agents, sandbox Next apps, and
                         session observers as child processes ◄──┘
```

Two kinds of state, and the distinction matters constantly:

- **LiveKit-owned** — rooms, participants, SIP trunks, dispatch rules, egress. Read and written through the server SDK. Nothing is mirrored locally; the dashboard is a view.
- **Dashboard-owned** — users, sessions, agents' saved config, providers, secrets, phone numbers, sandbox apps, webhook log, console session history. Lives in our database.

Console session **audio** is the exception to both: the bytes go wherever Settings → Storage points (local disk or an S3-compatible bucket, see `src/lib/storage.ts`), and only the index lives in the database. `/sessions/history/[id]` replays a saved session by joining the two.

### Who writes a session to history

Two writers, and the difference explains most questions about missing sessions:

- **A console tab.** `use-session-persistence.ts` posts what the browser held when the session ends. This is the only writer for sessions the console hosts, and the richer one — it has the local microphone, the config and the agent's metrics stream.
- **A session observer**, when capture is switched on in Settings → Project. The `room_started` webhook spawns `observer/session-observer.mjs`, which joins the room hidden and drops a capture file that `src/lib/session-capture.ts` adopts. This is what puts an inbound SIP call or a sandbox app into the history at all.

Capture is **off by default** (`capture_config`, one row). With it off, a session nobody had a tab open for leaves no trace — that is the product's default, not a bug. `console_sessions.source` records which writer won; a capture never overwrites a console row (`SESSION_SOURCE_RANK`).

Phone numbers are the confusing one: that page is a *local registry* only. Adding a number provisions nothing and needs no SIP.

### Reading a session back

The console and the replay at `/sessions/history/[id]` put events, metrics, the transcript and both timelines on **one wall-clock axis**, driven by the session recording: one audio handle per view, and a click anywhere moves every panel. Two facts govern anything drawn there, both detailed in `src/components/CLAUDE.md`:

- A recording's stored `durationMs` is wall-clock, not the length of the audio file. Treating them as the same stretches the whole plot against the playhead.
- A metric's timestamp is when the agent *reported* it, not when the work happened — TTS in particular is still audibly playing after its metric arrives. `metricWindows()` owns that translation.

### Agent assist — an agent with no TTS

The **agent assist** sandbox (`/sandboxes/agent-assist`) is the one room here with two *humans* in it: a support agent and a customer, both arriving on the same link. `example/agent-assist-python` joins silently, transcribes each of them, and publishes coaching notes only the support agent's view renders.

It is an ordinary agent with the speaking half removed. One `AgentSession` **per human participant**, bound by `RoomOptions.participant_identity`, each with STT, VAD and a turn detector — and **no TTS and no LLM**. `AgentActivity` returns as soon as it sees `llm is None`, so a session in that shape is a pure transcriber: `on_user_turn_completed` fires and stops. Everything else (the stream adapter for non-streaming STTs, interim transcripts, `AudioInputOptions.noise_cancellation`, transcript forwarding to `lk.transcription`) comes for free, which is the whole reason not to push raw tracks into an STT by hand.

The coaching LLM is called **outside** the session, on its own topic. Leaving an LLM in the session and merely dropping TTS would also work, but the reply would then be agent *speech* — turn-managed, interruptible, and mixed into the transcript stream that the console and session history read.

Typing is a first-class turn, not a side channel. The composer sends on `lk.chat`, every client renders that topic directly — so a typed line shows with no worker in the room, and nothing has to be de-duplicated — and the worker reads the same topic to coach on typed turns exactly as it does on spoken ones. Session capture already records `lk.chat` as `via: "text"`, so history gets it for free. This is why the sessions run with `text_input=False`: RoomIO would otherwise claim that topic first and the worker's own handler would lose.

Load-bearing details:

- Roles come from participant attributes, `assistRole` / `assistName`. **Not** `assist.role`: `livekit-server-sdk` camelCases attribute-map keys when it decodes a REST `listParticipants` response, so a dotted key survives the token, reaches the Python worker intact, and then fails to match in any JS code that reads it back.
- The worker is deployed by the sandbox, not the builder (`src/lib/agent-assist.ts`), and is a normal `agents` row — so `/agents` gives it logs, restart and stop with no extra code.
- **A sandbox can reference an agent instead of restating its config.** `assist.sourceAgent` holds an agent's name and `buildAssistEnv` re-reads that agent on every deploy, so the builder stays the one place its models live; deploying that agent redeploys the workers pointing at it (`redeployWorkersSourcedFrom`). The coaching prompt is the exception — a persona for talking to a customer is the wrong prompt for writing notes to a colleague.
- **Dispatch happens on every join, not just at room creation.** A token's `roomConfig` only applies when the room is created, which loses the race that matters: deploy a sandbox, open the link seconds later, and the Python worker is still loading models — the dispatch finds no worker, the room now exists, and no later join ever asks again. The call then runs with nothing transcribing it. `/api/connection-details` therefore dispatches explicitly, and `/api/dispatch-worker` is the retry the UI offers.
- It calls `ctx.connect()` itself. A voice agent can let `session.start()` do that, but this worker may sit in a room with nobody attachable yet (the support agent opens the link first), and a job that never connects is reaped as one that did nothing.
- An empty transcript panel must say *why* — no worker in the room, no worker configured, transcription failing, or genuinely nothing said yet. "Say something" while the real problem was that nothing had been dispatched cost real debugging time. The worker forwards its own `AgentSession` `error` events to the room for the same reason.
- **`sttLanguage: "multi"` is a builder-only value.** The builder never passes `language` to `openai.STT`, so its multilingual agents work; this worker inherited the value and sent it, and the endpoint answered `Unsupported language: 'multi'` with a 400 on *every* utterance — a call where nothing is ever transcribed and the only trace is the worker's log. `multi`/`auto` now mean "send no language", in both the resolver and the worker.
- The sandbox reads its identity from `sandbox.json`, not `process.env`. A bundler may constant-fold `process.env.AGENT_NAME` to what it knew at compile time, and a sandbox is recompiled on every deploy while its environment changes underneath. That failure is vicious: the process holds the right value, a newly added route reads it correctly, and the existing route reads empty — so the app dispatches no worker and transcribes nothing, with no error anywhere. A `readFileSync` cannot be folded away.
- The level meter is not decoration. An empty transcript cannot distinguish a microphone that never opened from a worker that never joined, so both roles get bars for themselves and the other person, and a refused microphone says so instead of failing the join.
- **Every metric it publishes names its speaker.** Both sessions publish onto one room topic, so a payload without `speaker` leaves the dashboard drawing a single STT lane for a conversation that had two people in it. The turn detector is therefore built **per session** rather than per worker — a shared instance reports predictions with no way to tell whose turn they ended.
- **A text turn detector reports nothing about itself.** The audio detector emits `EOTInferenceMetrics` per prediction and the session forwards it; the text models emit none at all — the ONNX runner times itself and drops the number into a debug log — so a call using one showed no turn detection on the timeline whatsoever. `_TimedTurnDetector` times `predict_end_of_turn` from the caller's side, which is what the turn actually waited on. The audio detector must **not** be wrapped: `AgentActivity` picks its streaming path by `isinstance`, so a wrapper would quietly demote it to text-only detection.
- **The coaching LLM's metrics need subscribing to.** It is called outside any `AgentSession`, so nothing forwards them the way a voice agent's are; the worker attaches to the LLM's own `metrics_collected`. Untagged, since a note is about the call rather than one speaker.
- **Testing it needs two humans, so there is a simulator.** `POST /api/assist-sim` runs `example/agent-assist-sim/simulate.py`, which joins the room twice as ordinary participants and speaks a script through the project's TTS — the only way to check what the metrics timeline draws for such a call without two browsers. See `src/lib/CLAUDE.md`.

### Agent assist, dual track — two tracks on one participant

The **dual-track** sandbox (`/sandboxes/agent-assist-dual`) is the same job for the shape a *phone* call actually arrives in. A SIP leg reaches the support agent's **desk**, not the room, so the desk is the only thing that can put both voices in front of a transcriber: one browser publishes its microphone as `agent_audio` (source `Microphone`) and the softphone's audio, captured with `getDisplayMedia`, as `customer_audio` (source `ScreenShareAudio`). One participant, two audio tracks.

**That defeats RoomIO, which is the whole reason this is a second worker.** `_ParticipantAudioInputStream` is constructed with `track_source=SOURCE_MICROPHONE` and nothing else, so a session linked by `participant_identity` gets the microphone leg and the screen-share leg is unreachable — no `RoomOptions` field changes it. `example/agent-assist-dual-python` therefore binds per **track**: `TrackAudioInput` is an `AudioInput` handed straight to the session, and setting `session.input.audio` *before* `session.start(room=…)` makes `AgentSession` skip RoomIO's own audio input. Everything downstream is unchanged — VAD → STT → end-of-turn → coaching LLM, no LLM and no TTS in the session itself.

Load-bearing details, all verified on a real call:

- **A leg comes from the track, not the participant.** Name first (`agent`/`customer` as a substring), source second. A name containing *both* words matches neither — a mixed track transcribed as one side is worse than a missing leg. The source fallback is a **setting** (`micRole` → `DUAL_MIC_ROLE`), not an assumption: on a real desk the microphone is the support agent, but a publisher streaming two test files has no reason to match that, and inverting it yields a transcript that is right in every respect except who said what.
- **An external publisher works unchanged** if it uses those two track names — which is why the sandbox page is also a monitor: joining publishes nothing until you unmute and share.
- **`_close_stream` must close the AudioStream before the noise filter.** Closing the stream is async and the filter's `_close()` is not, so closing the filter first leaves the SDK's read loop calling `_process` on a GTCRN whose ONNX caches were cleared — it dies with `Required inputs (['conv_cache', …]) are missing`, inside `livekit.rtc`, so it reads as an SDK bug rather than a teardown race. It fires on any republish, and a mute/unmute mid-call is an unpublish followed by a publish.
- **The audio turn detector reports no metrics self-hosted.** `EOTInferenceMetrics` is emitted only by `_CloudTransport` (`inference/eot/transports.py`); `v1-mini` resolves to `_LocalTransport`, which runs the ONNX model in-process and emits nothing. Detection works and the timing is invisible — the turn-detector lane is simply empty, with the predictions visible only in a debug log. **This is true of the per-participant assist worker too.** A text detector (`livekit`/`scicom`) does report, timed from the caller's side by `_TimedTurnDetector`, which is the choice to make when the lane matters more than the audio model's accuracy.
- **`lk.transcription` cannot separate the legs.** RoomIO stamps it with `sender_identity = the transcribed participant`, and both legs *are* that participant — so session history holds both sides' words in order under one speaker. The role-accurate view is `assist.transcript`; the per-leg split on the metrics timeline survives because those payloads carry `speaker`.
- **A typed turn names its own side.** The composer stamps `assistRole` on the `lk.chat` stream, since the sender's identity cannot say which voice typed. Typing as the *customer* is how the whole chain gets exercised with no phone on the other end.
- **`/api/assist-sim` does not apply.** It joins as two participants carrying roles in their attributes — exactly what this worker does not read — so both of their microphones would land on one leg. One browser is enough here, which is the point.
- **AGC is on by default** (`DUAL_AUTO_GAIN_CONTROL`). A phone leg re-captured through a screen share is routinely quieter than the headset beside it, and one loud speaker next to one quiet one is a VAD that never fires on half the call. The browser's own processing is switched **off** on that leg — the worker's filter is what cleans it up, and browser AGC on a tab capture pumps audibly.
- **Echo is the one thing the stack cannot fix.** Browser echo cancellation only cancels what the browser plays; the softphone is another application, so on speakers the caller leaks into the microphone and *both* legs transcribe the same words. The UI says "use a headset" because nothing else can.

## Conventions

- **Every API route** starts with `getSession()` → 401, then `session.role === "member"` → 403 for writes. Members are view-only.
- **Auth guard** lives in `src/app/(dashboard)/layout.tsx`, not middleware. Middleware only sees whether a cookie *exists* (no DB access from the edge), so a stale cookie would otherwise render the whole dashboard with every fetch 401ing.
- **Dashboard pages are client components** that fetch from `/api/*`. They do not read the database directly.
- **Feedback is a toast** (`sonner`, mounted in the root layout), not a modal. Long errors use `duration: Infinity` + `closeButton`.
- Prefer deriving state from the URL over mirroring it in `useState` — see `?provider=<slug>` on the providers page and `?setting=<tab>` in the agent builder.
- `eslint` runs `react-hooks/set-state-in-effect` as an **error**. Calling a function that sets state synchronously at the top of an effect trips it; fetch-then-`.then(setX)` does not.

## Known rough edges

- Several pre-existing lint errors (`set-state-in-effect`, unescaped entities) exist in older pages. Compare error counts before/after a change rather than assuming a clean baseline.
- **The noise filter times itself.** `AudioInputOptions.noise_cancellation` has no metrics hook, so a filter falling behind used to read as a slow recogniser and nothing else. Builder agents and the assist worker both wrap GTCRN in a subclass that times `_process` — called once per chunk, on the event loop — and publish a summary per ~5 s of audio onto `lk.metrics` as an `NC` lane — hidden by default in the metrics panel, since those windows tile the whole call. Per *window*, not per chunk: 20 metrics a second per speaker would bury the topic exactly as VAD would. Subclass rather than a delegating wrapper, so every `FrameProcessor` hook the SDK may call survives; and the instance is built in the selector, which is the only place the stream's owner is known, so a room with two people draws two lanes. The chunk itself is a setting on both (`frame_size_ms`, 50 ms default = 800 samples at 16 kHz; `src/lib/audio-input.ts` owns the sizes, the assist worker reads `ASSIST_AUDIO_CHUNK_MS`). It changes how often the model is called, never how it works — GTCRN always runs 256-sample hops through a 512-point window and adds its own 32 ms at 16 kHz.
- Noise cancellation no longer goes through Krisp. `noise_cancellation.BVC()` is a LiveKit Cloud feature — self-hosted it authorised against Cloud, logged `noise cancellation is not authorized (404)` and passed audio through untouched. Generated agents now use `GTCRN` from `stt_api.livekit_plugin.noise_cancellation`, an ONNX model run as an `rtc.FrameProcessor` in the agent process (that half of `AudioInputOptions.noise_cancellation` is not Cloud-gated). Agents deployed before this keep the old line until redeployed, which is why `livekit-plugins-noise-cancellation` is still installed.
- The agent builder's live preview dispatches the **deployed** agent, so it tests what is deployed, not unsaved edits.
