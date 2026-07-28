# Simulated two-speaker call

The agent-assist template needs two **humans** in one room — a support agent and a
customer, arriving on the same link. That makes it the one thing in this dashboard
you cannot exercise by opening a page, and its metrics timeline (STT and turn
detection *per speaker*) cannot be read at all without a call that had two
speakers in it.

This joins the room twice as ordinary participants, gives each the `assistRole`
attribute the worker reads, and speaks a scripted conversation through the
project's own TTS. To the worker it is indistinguishable from two people on two
laptops. It then reports what came back on the worker's topics, so a run says
whether transcription, turn detection and coaching all worked.

## Run it

The dashboard does the setup — resolving models, keys and the worker to dispatch —
so one request runs a whole call. It needs a **dashboard API token**: Settings →
Access tokens → New token.

```bash
TOKEN=lkui_…            # Settings → Access tokens

curl -s -X POST http://localhost:3010/api/assist-sim \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sandbox": "test2"}' | jq .run.summary
```

It answers when the call is over (~40s for the default script):

```json
{
  "room": "assist-test2-sim",
  "transcript": [{ "role": "agent", "text": " Support here, how can I help?" }, …],
  "suggestions": ["Ask for the account number…"],
  "errors": [],
  "metrics": {
    "stt_metrics/agent": 2,      "stt_metrics/customer": 1,
    "eot_inference_metrics/agent": 2, "eot_inference_metrics/customer": 1,
    "llm_metrics/-": 1
  }
}
```

`metrics` is the point: it is a count per kind **per speaker**, which is exactly
what the timeline draws lanes from. Empty `stt_metrics` means nothing was
transcribed; no `eot_*` means turn detection is not reporting; no `llm_metrics`
means the coaching model never answered — and `errors` usually says why.

The call lands in Sessions → History like any other, so the same run can be read
back with its audio, transcript and timeline.

### Options

| field | default | |
|---|---|---|
| `sandbox` | — | takes the room, the worker to dispatch and the voice from it |
| `room` | `assist-<sandbox>-sim` | its own room by default: history keeps one row per room name, so running in the sandbox's own `assist-<sandbox>` would replace the record of the last real call made there. Pass it explicitly to aim there anyway |
| `agent` | the sandbox's `assist.sourceAgent` | whose TTS the speakers borrow |
| `turns` | a five-line support call | `[{"role": "agent"\|"customer", "text": "…"}]` |
| `gapMs` | 1500 | silence after each line — this is what ends a turn |
| `warmupMs` | 6000 | the worker loads STT and a turn detector before it can hear |
| `drainMs` | 8000 | transcripts and metrics lag the audio; leaving early loses them |
| `wait` | `true` | `false` returns a run id to poll with `GET /api/assist-sim?id=…` |

## Without the dashboard

The script is standalone; the dashboard only writes its config. Every run keeps
one under `data/sim-runs/`, so the last one can be replayed or edited:

```bash
example/agent-starter-python/venv/bin/python \
  example/agent-assist-sim/simulate.py data/sim-runs/sim-xxxx.json
```

## Two things it must keep doing

- **Push real silence between lines.** An absent track gives the VAD no frames to
  hear a pause in, so the whole call reads as one long turn and nothing ever ends.
- **Take its voice from an agent.** An assist worker has no TTS of its own — it is
  an agent with the speaking half removed — so there is nothing in it to speak
  with.
