# agent-assist-python

A silent worker that sits in a call between two **humans** — a support agent and
a customer — transcribes each of them separately, and coaches the support agent
in real time.

Nobody here speaks. There is no TTS and the worker publishes no audio track. What
it publishes is data:

| Topic | Payload |
|---|---|
| `assist.transcript` | `{role, name, identity, text, final, id, ts}` per partial and final utterance, plus `{event: "joined"}` |
| `assist.suggestion` | `{id, state: "thinking"}`, then `{id, delta}` per token, then `{id, state: "done", text}` |
| `lk.transcription` | standard LiveKit transcription, attributed to the human who spoke — this is what the dashboard console, session history and any LiveKit client already understand |
| `lk.metrics` | STT and end-of-turn metrics, in the shape the dashboard console reads |

The dashboard's `agent-assist-react` sandbox is the front end for the first two.
The last two mean a call recorded by session capture replays with both sides'
transcripts, without this worker doing anything special.

## How it works

One `AgentSession` per human participant, bound by identity, each with **no LLM
and no TTS**. That last part is what makes it a transcriber: `AgentActivity`
returns early when `llm is None`, so a completed turn fires
`on_user_turn_completed` and stops there.

Doing it that way — rather than pushing raw tracks into an STT by hand — is what
gets noise cancellation, VAD gating, the stream adapter for non-streaming STTs,
interim transcripts, end-of-turn detection and transcript forwarding for free.

Two pieces are configured on purpose:

- **Noise cancellation.** `GTCRN`, a 48 K-parameter ONNX model, one instance per
  stream (its recurrent caches are per-stream state). It runs entirely in this
  process, so unlike Krisp it needs no LiveKit Cloud entitlement. Input is
  requested at 16 kHz because that is the model's native rate — anything else
  adds two resampler stages that cost more latency than the model itself.
- **Turn detection.** Without it, `on_user_turn_completed` fires on every VAD
  pause and the customer gets a suggestion per breath. `ASSIST_TURN_DETECTOR=audio`
  (the default) runs LiveKit's own end-of-turn model in-process with no
  download; `livekit` and `scicom` are the text detectors.

## Who is the agent and who is the customer

From the participant, never from track names. The token needs attributes:

```
assistRole = agent | customer
assistName = "Aina"             # optional, for display
```

Accepted fallbacks: an identity prefixed `agent-` / `customer-`, or metadata
`{"role": "agent"}`. A participant with no resolvable role is skipped and logged
— a missing transcript is better than the customer's words attributed to the
support agent.

## Running it

The dashboard deploys this for you: create an **Agent assist** sandbox at
`/sandboxes` and it generates `data/agents/<name>-assist/`, writes `.env.local`
from Settings → Providers and Settings → Secrets, and runs it. Logs, restart and
stop then work from `/agents` like any other agent.

By hand:

```bash
cp .env.example .env.local        # then fill in keys
uv sync
uv run src/agent.py dev
```

Or with the venv the dashboard already uses:

```bash
../agent-starter-python/venv/bin/python src/agent.py dev
```

Every knob is an environment variable (see `.env.example`), so the deployed copy
of `src/agent.py` is byte-identical to this one.
