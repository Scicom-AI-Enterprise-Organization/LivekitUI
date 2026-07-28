"""
Two synthetic speakers on one call.

An agent-assist room needs two *humans* in it — that is the whole point of the
template — which makes it the one thing here that cannot be exercised by opening
a page. This joins the room twice as ordinary participants, gives each the
`assistRole` attribute the worker reads, and speaks a scripted conversation
through the project's own TTS. To the worker it is indistinguishable from two
people on two laptops: standard participants publishing microphone tracks.

It is also the only way to test what the metrics timeline draws for such a call —
STT and turn detection per speaker, plus the coaching LLM — so it listens on the
worker's own topics and prints what arrived. A run either reports metrics per
speaker or it does not, with no browser and nobody talking.

    python simulate.py run.json

Config (see `/api/assist-sim`, which writes one of these and runs it):

    url, apiKey, apiSecret   the LiveKit server, server-side address
    room                     room name; created by joining
    dispatch                 agent name to dispatch into the room, optional
    tts                      plugin, model, baseUrl, apiKey, format, voices
    turns                    [{role, text}] — "agent" or "customer"
    gapMs                    silence after each line, so end-of-turn fires
"""

from __future__ import annotations

import asyncio
import importlib
import inspect
import json
import logging
import os
import sys
import time
from collections import Counter

from livekit import api, rtc

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("assist-sim")

# The worker's own topics, plus the two the dashboard reads.
TRANSCRIPT_TOPIC = "assist.transcript"
SUGGESTION_TOPIC = "assist.suggestion"
METRICS_TOPIC = "lk.metrics"

ROLE_ATTRIBUTE = "assistRole"
NAME_ATTRIBUTE = "assistName"

# 10 ms of audio per frame — what the SDK's own capture path uses.
FRAME_MS = 10


def _load_config() -> dict:
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            return json.load(f)
    raw = os.environ.get("SIM_CONFIG")
    if not raw:
        raise SystemExit("usage: simulate.py <config.json>  (or set SIM_CONFIG)")
    return json.loads(raw)


def _build_tts(spec: dict):
    """`livekit.plugins.<plugin>.TTS`, passing only kwargs it accepts.

    Same reasoning as the worker's `_instantiate`: `base_url`, `voice` and
    `response_format` are near-universal but not universal, and a plugin that
    does not take one should still be usable.
    """
    module = importlib.import_module(f"livekit.plugins.{spec.get('plugin', 'openai')}")
    candidates = {
        "model": spec.get("model"),
        "base_url": spec.get("baseUrl") or None,
        "api_key": spec.get("apiKey") or None,
        "voice": spec.get("voice") or None,
        "response_format": spec.get("format") or None,
    }
    params = inspect.signature(module.TTS.__init__).parameters
    accepts_kwargs = any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())
    kwargs = {
        k: v for k, v in candidates.items() if v is not None and (accepts_kwargs or k in params)
    }
    return module.TTS(**kwargs)


class Speaker:
    """One end of the call: a participant, a microphone track, and a voice."""

    def __init__(self, cfg: dict, role: str, name: str, voice: str | None) -> None:
        self._cfg = cfg
        self.role = role
        self.name = name
        self.identity = f"sim-{role}-{int(time.time() * 1000) % 100000}"
        self.room = rtc.Room()
        self._tts = _build_tts({**cfg["tts"], "voice": voice})
        self._source: rtc.AudioSource | None = None

    def _token(self) -> str:
        return (
            api.AccessToken(self._cfg["apiKey"], self._cfg["apiSecret"])
            .with_identity(self.identity)
            .with_name(self.name)
            # The role the worker reads. Camel-cased, not `assist.role`:
            # livekit-server-sdk camel-cases attribute keys when it decodes a
            # REST response, so a dotted key survives the token and then fails
            # to match anywhere the dashboard reads it back.
            .with_attributes({ROLE_ATTRIBUTE: self.role, NAME_ATTRIBUTE: self.name})
            .with_grants(
                api.VideoGrants(
                    room_join=True,
                    room=self._cfg["room"],
                    can_publish=True,
                    can_subscribe=True,
                    can_publish_data=True,
                )
            )
            .to_jwt()
        )

    async def join(self) -> None:
        await self.room.connect(self._cfg["url"], self._token())
        source = rtc.AudioSource(self._tts.sample_rate, self._tts.num_channels)
        track = rtc.LocalAudioTrack.create_audio_track(f"{self.role}-voice", source)
        await self.room.local_participant.publish_track(
            track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        )
        self._source = source
        logger.info("%s joined as %s (%s)", self.name, self.identity, self.role)

    async def say(self, text: str) -> None:
        assert self._source is not None
        logger.info("[%s] %s", self.role, text)
        async for ev in self._tts.synthesize(text):
            await self._source.capture_frame(ev.frame)
        # capture_frame returns once the frame is queued, not once it has been
        # sent — without this the silence below starts while the line is still
        # going out, and the worker sees one long turn instead of two.
        await self._source.wait_for_playout()

    async def be_quiet(self, seconds: float) -> None:
        """Real silence, not an absent track: VAD needs frames to hear a pause in."""
        assert self._source is not None
        samples = int(self._tts.sample_rate * FRAME_MS / 1000)
        frame = rtc.AudioFrame.create(self._tts.sample_rate, self._tts.num_channels, samples)
        for _ in range(int(seconds * 1000 / FRAME_MS)):
            await self._source.capture_frame(frame)

    async def leave(self) -> None:
        await self.room.disconnect()


async def main() -> int:
    cfg = _load_config()
    turns = cfg.get("turns") or []
    if not turns:
        raise SystemExit("nothing to say: config has no turns")

    gap = max(0.2, float(cfg.get("gapMs", 1500)) / 1000)
    voices = cfg.get("tts", {}).get("voices", {})

    support = Speaker(cfg, "agent", cfg.get("agentName", "Sim Agent"), voices.get("agent"))
    customer = Speaker(cfg, "customer", cfg.get("customerName", "Sim Customer"), voices.get("customer"))
    speakers = {"agent": support, "customer": customer}

    # What came back, collected from the support agent's connection — the one a
    # real support agent's browser would be.
    transcript: list[dict] = []
    suggestions: list[dict] = []
    metrics: list[dict] = []

    @support.room.on("data_received")
    def _on_data(packet: rtc.DataPacket) -> None:
        try:
            payload = json.loads(packet.data.decode())
        except Exception:
            return
        if packet.topic == TRANSCRIPT_TOPIC:
            transcript.append(payload)
        elif packet.topic == SUGGESTION_TOPIC:
            suggestions.append(payload)
        elif packet.topic == METRICS_TOPIC:
            metrics.append(payload)

    await support.join()
    await customer.join()

    # Dispatch after joining, for the same reason the sandbox does: a token's
    # `roomConfig` only applies when the room is created, and the worker may
    # still be loading models when the room comes up.
    if agent_name := cfg.get("dispatch"):
        async with api.LiveKitAPI(
            cfg["url"].replace("ws://", "http://").replace("wss://", "https://"),
            cfg["apiKey"],
            cfg["apiSecret"],
        ) as lk:
            try:
                await lk.agent_dispatch.create_dispatch(
                    api.CreateAgentDispatchRequest(room=cfg["room"], agent_name=agent_name)
                )
                logger.info("dispatched %s", agent_name)
            except Exception as e:
                logger.warning("dispatch of %s failed: %s", agent_name, e)

    # The worker joins, then loads STT and a turn detector before it can hear
    # anything. Talking through that costs the first turn of every run.
    await asyncio.sleep(float(cfg.get("warmupMs", 6000)) / 1000)

    for turn in turns:
        speaker = speakers.get(turn.get("role", "customer"))
        if speaker is None or not turn.get("text"):
            continue
        await speaker.say(turn["text"])
        # Both sides go quiet: the pause is what ends a turn, and the other
        # speaker's track must not go dead while it waits.
        await asyncio.gather(*(s.be_quiet(gap) for s in speakers.values()))

    # Transcription and coaching lag the audio, and the metrics arrive after
    # that; leaving immediately would report a call that had barely started.
    await asyncio.gather(*(s.be_quiet(float(cfg.get("drainMs", 8000)) / 1000) for s in speakers.values()))

    lines = [t for t in transcript if t.get("text") and t.get("final") is not False]
    by_speaker: Counter[str] = Counter()
    for m in metrics:
        kind = str(m.get("type") or m.get("kind") or "?")
        who = (m.get("speaker") or {}).get("role") or "-"
        by_speaker[f"{kind}/{who}"] += 1

    summary = {
        "room": cfg["room"],
        "spoken": len(turns),
        "transcript": [{"role": t.get("role"), "text": t.get("text")} for t in lines],
        "suggestions": [s.get("text") for s in suggestions if s.get("state") == "done"],
        "errors": [t for t in transcript if t.get("event") == "error"]
        + [s.get("error") for s in suggestions if s.get("state") == "error"],
        "metrics": dict(sorted(by_speaker.items())),
    }

    # A file, not just stdout: the LiveKit SDK logs from its own threads, so the
    # last line of output is whatever raced to it, and the caller ended up
    # parsing a summary with log lines glued to the end of it.
    if result_file := cfg.get("resultFile"):
        with open(result_file, "w") as f:
            json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))

    await asyncio.gather(support.leave(), customer.leave())
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
