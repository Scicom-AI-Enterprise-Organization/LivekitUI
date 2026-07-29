"""
One synthetic caller for a voice agent.

A voice agent's timeline is the only one with the whole chain in it — the caller's
speech recognised, the turn ended, the model answering, the voice synthesised —
and every link of it needs someone to actually talk to the agent. This joins the
room as an ordinary participant, speaks through the project's TTS, and waits for
the agent to finish replying before saying the next line, the way a person does.

It is deliberately **mute about itself**: it publishes no metrics and no
transcriptions. Everything on the room's metric topic came from the agent, so the
timeline reads exactly as it would for a human caller — which is the whole point
of using it to check that timeline.

    python simulate.py run.json

Config (see `/api/voice-sim`, which writes one of these and runs it):

    url, apiKey, apiSecret   the LiveKit server, server-side address
    room                     room name; created by joining
    dispatch                 agent name to dispatch; empty means auto-dispatch
    tts                      plugin, model, baseUrl, apiKey, format, voice
    turns                    ["line", …] — what the caller says
    replyTimeoutMs           how long to wait for the agent to finish a reply
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
logger = logging.getLogger("voice-sim")

METRICS_TOPIC = "lk.metrics"
TRANSCRIPTION_TOPIC = "lk.transcription"
# How the agent says what it is doing. Set by RoomIO on its own participant.
AGENT_STATE_ATTRIBUTE = "lk.agent.state"

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
    """`livekit.plugins.<plugin>.TTS`, passing only kwargs it accepts."""
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


class Caller:
    """The person on the phone: a participant, a microphone, and a voice."""

    def __init__(self, cfg: dict) -> None:
        self._cfg = cfg
        self.identity = f"sim-user-{int(time.time() * 1000) % 100000}"
        self.room = rtc.Room()
        self._tts = _build_tts(cfg["tts"])
        self._source: rtc.AudioSource | None = None

    def _token(self) -> str:
        return (
            api.AccessToken(self._cfg["apiKey"], self._cfg["apiSecret"])
            .with_identity(self.identity)
            .with_name(self._cfg.get("callerName", "Sim Caller"))
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
        track = rtc.LocalAudioTrack.create_audio_track("caller-voice", source)
        await self.room.local_participant.publish_track(
            track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        )
        self._source = source
        logger.info("joined %s as %s", self._cfg["room"], self.identity)

    async def say(self, text: str) -> None:
        assert self._source is not None
        logger.info("[caller] %s", text)
        async for ev in self._tts.synthesize(text):
            await self._source.capture_frame(ev.frame)
        # capture_frame queues rather than sends; without this the silence below
        # begins while the line is still going out and the turn never ends.
        await self._source.wait_for_playout()

    async def be_quiet(self, seconds: float) -> None:
        """Real silence, not an absent track: VAD needs frames to hear a pause in."""
        assert self._source is not None
        samples = int(self._tts.sample_rate * FRAME_MS / 1000)
        frame = rtc.AudioFrame.create(self._tts.sample_rate, self._tts.num_channels, samples)
        for _ in range(max(0, int(seconds * 1000 / FRAME_MS))):
            await self._source.capture_frame(frame)

    def agent_participant(self) -> rtc.RemoteParticipant | None:
        for p in self.room.remote_participants.values():
            if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
                return p
        # A worker that never set its kind still is not us.
        for p in self.room.remote_participants.values():
            if p.identity != self.identity:
                return p
        return None

    def agent_state(self) -> str:
        agent = self.agent_participant()
        return (agent.attributes or {}).get(AGENT_STATE_ATTRIBUTE, "") if agent else ""

    async def wait_for_agent(self, timeout: float) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.agent_participant() is not None:
                return True
            await self.be_quiet(0.1)
        return False

    async def wait_for_reply(self, timeout: float) -> str:
        """
        Hold the line until the agent has finished answering.

        Turn-taking is the whole reason this is not a fixed sleep: talk over the
        agent and the run measures interruptions instead of a clean chain, and
        wait too long and every turn costs seconds it did not need. The agent says
        which it is doing on its own participant attributes; a deployment that
        does not publish them falls back to the timeout, which is why this reports
        what it saw.
        """
        spoke = False
        settled_for = 0.0
        deadline = time.time() + timeout
        while time.time() < deadline:
            state = self.agent_state()
            if state in ("thinking", "speaking"):
                spoke = True
                settled_for = 0.0
            elif spoke and state in ("listening", "idle", ""):
                # Two ticks of quiet, so a gap between sentences is not read as
                # the end of the reply.
                settled_for += 0.2
                if settled_for >= 0.4:
                    return "replied"
            await self.be_quiet(0.2)
        return "replied" if spoke else "timeout"

    async def leave(self) -> None:
        await self.room.disconnect()


async def main() -> int:
    cfg = _load_config()
    turns = [t for t in (cfg.get("turns") or []) if str(t).strip()]
    if not turns:
        raise SystemExit("nothing to say: config has no turns")

    caller = Caller(cfg)

    metrics: list[dict] = []
    transcript: list[dict] = []

    @caller.room.on("data_received")
    def _on_data(packet: rtc.DataPacket) -> None:
        if packet.topic != METRICS_TOPIC:
            return
        try:
            metrics.append(json.loads(packet.data.decode()))
        except Exception:
            pass

    def _on_transcription(reader: rtc.TextStreamReader, identity: str) -> None:
        async def collect() -> None:
            text = ""
            async for chunk in reader:
                text += chunk
            line = text.strip()
            # Transcription arrives as revisions: an interim stream and then the
            # final one carry the same words, and both land here.
            if line and not (
                transcript and transcript[-1]["from"] == identity and transcript[-1]["text"] == line
            ):
                transcript.append({"from": identity, "text": line})

        asyncio.create_task(collect())

    await caller.join()
    # Registered after joining, same as a browser would.
    caller.room.register_text_stream_handler(TRANSCRIPTION_TOPIC, _on_transcription)

    # Explicit dispatch when the sandbox names an agent; the starter template
    # otherwise relies on auto-dispatch, which needs no request.
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

    joined = await caller.wait_for_agent(float(cfg.get("joinTimeoutMs", 20000)) / 1000)
    if not joined:
        logger.warning("no agent joined the room")

    # A voice agent greets first; let it, or the first line lands on an agent that
    # is still talking and the run starts with an interruption.
    greeting = await caller.wait_for_reply(float(cfg.get("greetingTimeoutMs", 15000)) / 1000)
    logger.info("greeting: %s", greeting)

    replies: list[str] = []
    for line in turns:
        await caller.say(str(line))
        await caller.be_quiet(float(cfg.get("gapMs", 800)) / 1000)
        replies.append(await caller.wait_for_reply(float(cfg.get("replyTimeoutMs", 25000)) / 1000))

    # Metrics trail the audio: TTS reports after it has finished playing.
    await caller.be_quiet(float(cfg.get("drainMs", 4000)) / 1000)

    kinds: Counter[str] = Counter()
    for m in metrics:
        kinds[str(m.get("type") or m.get("kind") or "?")] += 1

    summary = {
        "room": cfg["room"],
        "agentJoined": joined,
        "spoken": turns,
        "replies": replies,
        "transcript": transcript,
        "metrics": dict(sorted(kinds.items())),
    }
    if result_file := cfg.get("resultFile"):
        with open(result_file, "w") as f:
            json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))

    await caller.leave()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
