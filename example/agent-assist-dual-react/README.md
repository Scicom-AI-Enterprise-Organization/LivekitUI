# Agent assist — dual track (frontend)

One browser tab at a support agent's desk. It publishes **both** sides of a phone
call as two audio tracks on one participant, renders the transcript of each, and
shows the coaching notes the worker writes.

```
┌─ this tab ───────────────────────────────────────────┐
│  microphone      ──► Microphone       "agent_audio"  │
│  shared tab audio ─► ScreenShareAudio "customer_audio"│
└──────────────────────────┬───────────────────────────┘
                           │  one participant, two tracks
                           ▼
                 agent-assist-dual-python
                  (one AgentSession per track)
                           │
              assist.transcript · assist.suggestion
```

The pairing worker is `example/agent-assist-dual-python`, and the reason the whole
thing is shaped like this is in its README: a SIP call arrives at the *desk*, not
in the room, so the desk is the only thing that can put both voices in front of a
transcriber.

## Going on air

Joining publishes nothing. Two separate, deliberate actions do:

- **Unmute** — publishes the microphone as `agent_audio`. Published by hand rather
  than through `setMicrophoneEnabled`, which gives no way to name a track, and the
  name is what the worker resolves the leg from.
- **Share customer audio** — `getDisplayMedia`, publishing only the audio track as
  `customer_audio` with source `ScreenShareAudio`.

A join that publishes neither is a **monitor**: it plays and meters whatever the
desk has on air and renders the same transcript, which is what a supervisor
watching along needs.

### The share, in practice

- Chrome refuses an audio-only display capture, so video is requested and never
  published. The video track is kept alive rather than stopped — stopping it can
  take the whole capture session with it — and its `ended` event is what tells us
  the user pressed the browser's own **Stop sharing**.
- **Pick a tab and tick "Also share tab audio."** A share with no audio track is
  the most common mistake here and the least visible: video arrives, the share
  looks fine, and the customer is simply never transcribed. The app checks for it
  and says so.
- On Windows, "Share system audio" also works, so a desktop softphone can be
  captured. On macOS, Chrome can only capture a *tab* — a desktop softphone needs
  a virtual audio device, or a browser-based softphone.
- Every browser processing option is off on this leg (`echoCancellation`,
  `noiseSuppression`, `autoGainControl`). It is a re-capture of a phone line; the
  worker's own filter is what cleans it up, and browser AGC on a tab capture pumps
  audibly between a talking caller and a silent one.

### Use a headset

Browser echo cancellation only cancels audio *the browser* is playing. The
softphone is a separate application, so on speakers the caller's voice leaks into
the microphone and **both legs transcribe the same words** — which reads as the
agent repeating everything the customer says, and sends the coaching model a
conversation that never happened. A headset removes the problem entirely.

## Typing a turn

The composer sends on `lk.chat` with the side stamped on the stream
(`assistRole`), because the sender's identity cannot say which voice typed — this
participant carries both.

Typing as the **customer** is the way to exercise the worker with no phone on the
other end: one typed line runs the same path a spoken turn does, all the way to a
coaching note.

## Routes

| Route | Does |
|---|---|
| `POST /api/connection-details` | Mints a token carrying the agent's name and the caller's label, and dispatches the worker **explicitly** — a token's `roomConfig` only applies when the room is created, which loses the race against a worker still loading its models. |
| `POST /api/dispatch-worker` | The retry the UI offers when the worker is not in the room. |
| `GET /api/room-state` | Who is in the room and what each of them has on air, for the join screen. |

`?room=<slug>` overrides the room, which is how several desks share one sandbox —
one room each, since a room holds one call.
