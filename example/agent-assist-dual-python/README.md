# Agent assist — dual track

Live transcription and real-time coaching for a call whose two voices arrive as
**two audio tracks on one participant**.

## The problem it solves

`agent-assist-python` assumes each human on the call is their own LiveKit
participant, and binds an `AgentSession` to each of them with
`RoomOptions.participant_identity`. A phone call cannot be delivered that way.
The far end arrives over SIP at the support agent's desk, not into the room, so
the only thing that can put both voices in front of a transcriber is the agent's
own machine:

```
 headset  ──────────────► Microphone track      "agent_audio"     ┐
                                                                  ├─ one participant
 softphone tab ─ screen-share audio ──► ScreenShareAudio track    ┘
                                        "customer_audio"
```

RoomIO cannot split that participant. `_ParticipantAudioInputStream` is
constructed with `track_source=SOURCE_MICROPHONE` and nothing else, so a session
linked by identity gets the microphone leg and the screen-share leg is
unreachable — there is no `RoomOptions` field that changes it.

So the binding is per **track**. `TrackAudioInput` in `src/agent.py` is an
`AudioInput` handed straight to the session (`session.input.audio = …`, which
makes `AgentSession` skip RoomIO's own audio input), and everything downstream is
an ordinary session with **no LLM and no TTS** — a pure transcriber, exactly as in
the per-participant worker.

```
track ─► GTCRN ─► VAD ─► STT ─► end-of-turn ─┬─► assist.transcript
                                             └─► coaching LLM ─► assist.suggestion
```

## Which track is whose

1. **Name.** A publication whose name contains `agent` is the support agent; one
   containing `customer` is the caller. A name that contains both is treated as
   matching neither — a mixed track transcribed as one side is worse than a
   missing leg.
2. **Source**, only when the name settles nothing. `Microphone` is whichever role
   `DUAL_MIC_ROLE` names; `ScreenShareAudio` is the other.

The source mapping has to be configurable. On a real desk the microphone is the
support agent, but a publisher testing with two audio files has no reason to put
the microphone leg on the side a real desk would — and getting it backwards gives
a transcript that is right in every respect except who said what, which nobody
notices until the coaching starts answering the wrong person.

An audio track matching neither rule is ignored, and the room is told so
(`event: "unmatched-track"` on `assist.transcript`) rather than left with a panel
that is empty for no visible reason.

## What it publishes

| Topic | Payload |
|---|---|
| `assist.transcript` | `{role, name, identity, text, final, id, ts}` — interim and final, per leg. The role-accurate view, and what the sandbox renders. |
| `assist.suggestion` | `{id, state, delta?, text?}` — the coaching note, streamed. |
| `lk.metrics` | STT / end-of-turn / noise-cancellation metrics, each tagged with `speaker` so the dashboard draws a lane per leg. |
| `lk.transcription` | Published by RoomIO, because that is what session capture reads. |

**One caveat on `lk.transcription`:** its sender identity is the *publisher* for
both legs, because the customer is not a participant. Session history therefore
holds both sides' words in order under one speaker. The per-leg split lives on
`assist.transcript` and in the per-speaker metrics lanes.

## Typed turns

`lk.chat` is read directly, and a line's side comes from an `assistRole`
attribute on the text stream — the sender's identity cannot say, since the
publisher carries both voices. Anything unstamped is the support agent, who is
the one with a keyboard.

Typing as the **customer** is what makes this testable with no phone on the other
end: one typed line triggers the coaching exactly as a spoken turn would.

## Running it

The dashboard deploys this as an ordinary agent — it appears on `/agents` with
logs, restart and stop — and configures it entirely through `.env.local`, so the
deployed copy is byte-identical to this one. Editing the worker means editing
`src/agent.py`, and a redeploy picks it up.

By hand:

```bash
cp .env.example .env.local     # fill in the keys
uv sync
uv run src/agent.py dev
```

See `.env.example` for every setting.
