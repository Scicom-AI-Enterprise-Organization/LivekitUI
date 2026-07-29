"""
Agent assist, dual-track — **one participant, two audio tracks, two transcripts.**

## Why this is a separate worker

`agent-assist-python` transcribes a call in which each human is their own LiveKit
participant, and binds an `AgentSession` to each of them with
`RoomOptions.participant_identity`. A phone call cannot be delivered that way.
The far end arrives over SIP at the support agent's *desk*, not into the room, so
the only thing that can put both voices in front of a transcriber is the agent's
own machine — publishing its microphone as one track and the softphone's output,
captured as screen-share audio, as a second.

That shape defeats RoomIO. `_ParticipantAudioInputStream` is constructed with
`track_source=SOURCE_MICROPHONE` and nothing else, so linking a session by
identity picks up the microphone leg and leaves the other one unreachable — there
is no option, on any `RoomOptions` field, that reaches the second track. The
binding therefore has to be per *track*: `TrackAudioInput` below is an
`AudioInput` the session is handed directly, and everything downstream (VAD →
STT → end-of-turn → coaching LLM) is an ordinary `AgentSession` with **no LLM and
no TTS**, exactly as in the per-participant worker. `AgentActivity` returns as
soon as it sees `llm is None`, so a session in that shape is a pure transcriber.

## Which track is whose

**Track name first.** A publication whose name contains `agent` is the support
agent; one containing `customer` is the caller. That is the contract the
`agent-assist-dual-react` sandbox publishes with (`agent_audio` /
`customer_audio`), and it is what a hand-rolled publisher tends to set anyway.

**Track source second**, and only when the name settles nothing: `Microphone` is
whichever role `DUAL_MIC_ROLE` names, and `ScreenShareAudio` is the other one.
This has to be configurable rather than assumed. On a real desk the microphone is
the support agent, but a publisher testing with two audio files has no reason to
put the microphone leg on the side a real desk would — and getting it backwards
produces a transcript that is correct in every respect except who said what,
which nobody notices until the coaching starts answering the wrong person.

A track that matches neither rule is ignored, with a warning. Better a missing
leg than the customer's audio labelled as the agent's.

## What each leg publishes

* `assist.transcript` — role-labelled lines, interim and final. This is the
  role-accurate view and what the sandbox renders.
* `assist.suggestion` — the coaching notes, streamed.
* `lk.metrics` — STT, end-of-turn and noise-cancellation metrics, each **tagged
  with its speaker**, so the dashboard draws a lane per leg rather than merging a
  two-voice call into one.

`lk.transcription` is also published, by RoomIO, because that is what session
capture reads — but both legs necessarily carry the *publisher's* identity as
their sender, since the customer is not a participant. History therefore holds
both sides' words in order under one speaker; the per-leg split lives on
`assist.transcript` and in the metrics lanes.

## Configuration

Everything is read from the environment, so the deployed copy of this file is
byte-identical to the one in the repo and the dashboard only writes `.env.local`.
See `.env.example` for the full list.
"""

from __future__ import annotations

import asyncio
import importlib
import inspect
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, is_dataclass

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    ErrorEvent,
    JobContext,
    JobProcess,
    MetricsCollectedEvent,
    TurnHandlingOptions,
    UserInputTranscribedEvent,
    cli,
    llm,
    metrics,
    utils,
)
from livekit.agents.voice import room_io
from livekit.agents.voice.io import AudioInput
from livekit.plugins import silero

# Before any turn-detector import: the remote detector decides at *import time*
# whether to register a local ONNX runner, and skips it only when
# LIVEKIT_REMOTE_EOT_URL is already set.
load_dotenv(".env.local")

logger = logging.getLogger("agent-assist-dual")

# ── Topics ───────────────────────────────────────────────────────────────────
# `lk.metrics` is what the dashboard console and the session observer read, so
# publishing there gets STT/EOU latency into the console and into session history
# for free. The two `assist.*` topics match the per-participant worker's, which
# is why this sandbox's panels are a straight port of that template's.
CONSOLE_METRICS_TOPIC = "lk.metrics"
TRANSCRIPT_TOPIC = "assist.transcript"
SUGGESTION_TOPIC = "assist.suggestion"

# Typed turns ride LiveKit's standard chat topic, so session capture records them
# as text turns and every client renders them without this worker re-publishing.
CHAT_TOPIC = "lk.chat"

AGENT_ROLE = "agent"
CUSTOMER_ROLE = "customer"
ROLES = (AGENT_ROLE, CUSTOMER_ROLE)

# Attributes the publisher may set on itself. Canonical spelling is camelCase and
# dot-free: livekit-server-sdk camelCases attribute-map keys when it decodes a
# REST `listParticipants` response, so `assist.name` reaches this worker intact
# over the websocket but comes back out of the REST API as `assistName` and then
# fails to match in any JS that reads it again.
AGENT_NAME_ATTRIBUTES = ("assistName", "assist_name")
CUSTOMER_NAME_ATTRIBUTES = ("assistCustomerName", "assist_customer_name")

# Which side a typed line is attributed to, when the sender says. The composer in
# the sandbox sets it so a call can be exercised — and the coaching triggered —
# without a phone on the other end.
CHAT_ROLE_ATTRIBUTES = ("assistRole", "assist_role", "role")

DEFAULT_INSTRUCTIONS = """You are a real-time coach for a human customer-support agent on a live call.

You never speak to the customer. You write short notes only the support agent sees, while they are still on the call.

Rules:
- One or two sentences. The agent is listening to a customer while reading you.
- Say what to do or say next. Lead with the action, not with context the agent already has.
- Quote exact wording when the agent should read something out (a number, a name, a policy line).
- If the customer asked something you cannot answer from the conversation, say what to ask them.
- No pleasantries, no preamble, no markdown, no bullet lists."""


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _env_flag(name: str, default: bool) -> bool:
    raw = _env(name).lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        logger.warning("%s is not a number — using %s", name, default)
        return default


AGENT_NAME = _env("DUAL_AGENT_NAME", "agent-assist-dual")
LANGUAGE = _env("DUAL_LANGUAGE")
INSTRUCTIONS = _env("DUAL_INSTRUCTIONS") or DEFAULT_INSTRUCTIONS
TURN_DETECTOR = _env("DUAL_TURN_DETECTOR", "audio").lower()
NOISE_CANCELLATION = _env("DUAL_NOISE_CANCELLATION", "gtcrn").lower()
SUGGEST_FOR = _env("DUAL_SUGGEST_FOR", CUSTOMER_ROLE).lower()

# Which role the `Microphone`-source track belongs to, used only when the track's
# *name* settles nothing. The support agent, on a real desk: their headset is the
# microphone and the caller arrives through a shared softphone tab.
MIC_ROLE = _env("DUAL_MIC_ROLE", AGENT_ROLE).lower()
if MIC_ROLE not in ROLES:
    logger.warning("DUAL_MIC_ROLE=%r is not a role — using %s", MIC_ROLE, AGENT_ROLE)
    MIC_ROLE = AGENT_ROLE
SCREENSHARE_ROLE = CUSTOMER_ROLE if MIC_ROLE == AGENT_ROLE else AGENT_ROLE

# Display names, for a transcript that reads like a conversation rather than like
# two track names. The publisher can override either through its attributes.
AGENT_LABEL = _env("DUAL_AGENT_LABEL", "Support agent")
CUSTOMER_LABEL = _env("DUAL_CUSTOMER_LABEL", "Customer")

# ── How much silence goes to the recogniser ──────────────────────────────────
# Silero's own defaults pad every utterance by about a second — 0.5s kept from
# before speech started, 0.55s of silence waited out before it is called ended —
# and all of it is sent to the STT. Two costs: the transcript arrives later than
# it needs to, and `audio_duration` (which is what puts a bar on the metrics
# timeline) covers noticeably more than the speech you hear.
#
# The prefix is nearly free to cut; the trailing silence is what *ends a turn*,
# and cutting it too far splits one sentence into two utterances, each paying for
# its own STT call, its own turn-detector run and its own trip to the coach.
VAD_PREFIX_PADDING = _env_float("DUAL_VAD_PREFIX_PADDING", 0.2)
VAD_MIN_SILENCE = _env_float("DUAL_VAD_MIN_SILENCE", 0.5)
VAD_MIN_SPEECH = _env_float("DUAL_VAD_MIN_SPEECH", 0.05)
VAD_ACTIVATION = _env_float("DUAL_VAD_ACTIVATION", 0.5)
HISTORY_TURNS = int(_env("DUAL_HISTORY_TURNS", "12") or 12)
TRANSCRIBE_INTERIM = _env_flag("DUAL_INTERIM_TRANSCRIPTS", True)

# GTCRN's native rate. Handing the SDK anything else buys two resampler stages
# whose latency (56 ms) dwarfs the model's own (32 ms), and 16 kHz is what the
# STT and the VAD want anyway.
GTCRN_SAMPLE_RATE = 16000

# Audio handed to the filter per call, and from there to the VAD and the STT.
# 50 ms is the SDK's own default: 800 samples at 16 kHz. It changes how often the
# model is called, never how it works — GTCRN always runs 256-sample hops through
# a 512-point window whatever it is handed.
AUDIO_CHUNK_MS = max(1, int(_env("DUAL_AUDIO_CHUNK_MS", "50") or 50))

# Automatic gain control on the way in. RoomIO applies this to every input it
# builds, and audio arriving as a *screen share* of a softphone is exactly the
# case that needs it — a re-captured phone leg is routinely quieter than the
# headset beside it, and one loud speaker beside one quiet one is a VAD that
# never triggers on half the call.
AUTO_GAIN_CONTROL = _env_flag("DUAL_AUTO_GAIN_CONTROL", True)


# ── Noise cancellation ───────────────────────────────────────────────────────
# `AudioStream.from_track(noise_cancellation=…)` accepts either Krisp's
# Cloud-authorised options or any `rtc.FrameProcessor`, and only the first is
# gated. GTCRN is the second kind: nothing to authorise, no external service.
# Krisp's own plugin on a self-hosted server logs
# `noise cancellation is not authorized (404)` and passes audio through untouched,
# which is why it is not an option here.
NC_METRICS_WINDOW = 5.0
"""Seconds of audio each published noise-cancellation summary covers."""

if NOISE_CANCELLATION != "gtcrn":
    GTCRN = None  # type: ignore[assignment]
    MeteredGTCRN = None  # type: ignore[assignment]
else:
    from stt_api.livekit_plugin.noise_cancellation import GTCRN

    # Defined here rather than at module scope because it has nowhere to inherit
    # from without the plugin: subclassing keeps every `FrameProcessor` hook the
    # SDK may call intact, which a delegating wrapper would silently swallow.
    class MeteredGTCRN(GTCRN):  # type: ignore[misc, valid-type]
        """
        GTCRN, with what it costs published to the Console.

        The filter is the one thing on the audio path that reports nothing about
        itself, so a model falling behind would surface as a slow recogniser and
        nothing else. `_process` is called once per chunk (50 ms by default), on
        the event loop, so the time it takes is latency the call pays for.

        Summarised per window of audio rather than per chunk: 20 metrics a second,
        times two legs, would bury the topic exactly as VAD would.
        """

        def __init__(self, on_metrics) -> None:
            super().__init__()
            self._on_metrics = on_metrics
            self._rate = 0
            self._chunks = 0
            self._audio = 0.0
            self._compute = 0.0
            self._worst = 0.0
            self._window_from = 0.0

        def _process(self, frame: rtc.AudioFrame) -> rtc.AudioFrame:
            if not self._chunks:
                # Wall-clock start of the window, so the bar spans the audio it
                # summarises even when the track was muted for part of it.
                self._window_from = time.time()
            started = time.perf_counter()
            try:
                return super()._process(frame)
            finally:
                elapsed = time.perf_counter() - started
                self._rate = frame.sample_rate
                self._chunks += 1
                self._audio += frame.samples_per_channel / frame.sample_rate
                self._compute += elapsed
                self._worst = max(self._worst, elapsed)
                if self._audio >= NC_METRICS_WINDOW:
                    self._publish()

        def _publish(self) -> None:
            if not self._chunks:
                return
            now = time.time()
            self._on_metrics(
                {
                    "type": "noise_cancellation_metrics",
                    "kind": "NoiseCancellationMetrics",
                    "label": "GTCRN",
                    "timestamp": now,
                    # Compute against audio: the filter's share of one core, and
                    # the number that says whether it is keeping up. At 1.0 it is
                    # no longer removing noise faster than the noise arrives.
                    "duration": self._compute,
                    "audio_duration": self._audio,
                    "window_duration": max(now - self._window_from, self._audio),
                    "rtf": self._compute / self._audio if self._audio else None,
                    "frames": self._chunks,
                    "frame_avg": self._compute / self._chunks,
                    "frame_max": self._worst,
                    "chunk_duration": self._audio / self._chunks,
                    "sample_rate": self._rate,
                }
            )
            self._chunks = 0
            self._audio = 0.0
            self._compute = 0.0
            self._worst = 0.0

        def _close(self) -> None:
            # A stream ending mid-window still reports what it did, or the tail
            # of every call is missing from the plot.
            self._publish()
            super()._close()


# ── Turn detection ───────────────────────────────────────────────────────────
# Imported at module scope, not inside the entrypoint: the text detectors
# register an inference runner into a global registry, and the inference process
# is forked before any job runs. A lazy import would register too late.
if TURN_DETECTOR == "livekit":
    from livekit.plugins.turn_detector.multilingual import MultilingualModel
elif TURN_DETECTOR == "scicom":
    if url := _env("LIVEKIT_REMOTE_EOT_URL"):
        os.environ.setdefault("LIVEKIT_REMOTE_EOT_URL", url.rstrip("/"))
    from stt_api.livekit_plugin.turn_detector import MultilingualModel  # type: ignore[no-redef]
else:
    MultilingualModel = None  # type: ignore[assignment]


def _eot_metric(elapsed: float, model: str, provider: str) -> dict:
    """
    An `EOTInferenceMetrics`-shaped payload for a text turn detector.

    Only `total_duration` is filled in: that is the round trip the turn actually
    waited on. `detection_delay` — how long after the speech itself the verdict
    landed — is an audio-relative number a text detector cannot know, and
    guessing it would put the bar in the wrong place on the timeline.
    """
    return {
        "type": "eot_inference_metrics",
        "kind": "EOTInferenceMetrics",
        "label": f"{provider}.{model}",
        "timestamp": time.time(),
        "total_duration": elapsed,
        "num_requests": 1,
        "metadata": {"model_name": model, "model_provider": provider},
    }


class _TimedTurnDetector:
    """
    A text turn detector that reports how long each prediction took.

    The audio detector emits `EOTInferenceMetrics` per prediction and the session
    forwards it; the text ones emit nothing at all — the ONNX runner times itself
    and drops the number into a debug log — so a call using one shows no turn
    detection on the metrics timeline whatsoever. Timing from the caller's side
    also measures the right thing: the turn is held open until this returns, IPC
    or network included.

    The audio detector must *not* be wrapped like this. `AgentActivity` picks the
    streaming path by `isinstance`, so a wrapper would silently demote it to
    text-only detection and cost the very latency it was measuring.
    """

    def __init__(self, inner, on_metrics) -> None:
        self._inner = inner
        self._on_metrics = on_metrics

    @property
    def model(self) -> str:
        return getattr(self._inner, "model", "unknown")

    @property
    def provider(self) -> str:
        return getattr(self._inner, "provider", "unknown")

    async def unlikely_threshold(self, language):
        return await self._inner.unlikely_threshold(language)

    async def supports_language(self, language):
        return await self._inner.supports_language(language)

    async def predict_end_of_turn(self, chat_ctx, **kwargs) -> float:
        # **kwargs rather than an explicit `timeout=None`: the plugin's own
        # default is 3 seconds, and forwarding None would remove it.
        started = time.perf_counter()
        try:
            return await self._inner.predict_end_of_turn(chat_ctx, **kwargs)
        finally:
            self._on_metrics(
                _eot_metric(time.perf_counter() - started, self.model, self.provider)
            )


def _build_turn_detection(on_metrics=None):
    """
    The configured detector, or `None` to fall back to VAD silence.

    One per session rather than one per worker: both legs' turns run through their
    own detector, and a shared instance would report predictions with no way to
    tell whose turn they ended — which is the whole point of a lane per speaker on
    the metrics timeline.
    """
    if TURN_DETECTOR == "audio":
        # Ships its weights in `livekit-local-inference`, a hard dependency of
        # livekit-agents — no download, no LiveKit Cloud account. Self-hosted
        # always resolves to v1-mini; the full v1 is Cloud-only.
        from livekit.agents import inference

        detector = inference.TurnDetector(version="v1-mini")
        if on_metrics is not None:
            # **This hook does not fire on a self-hosted deployment**, and the
            # detector still works — only its metric is missing. `v1-mini` resolves
            # to `_LocalTransport`, which runs the ONNX model in-process and calls
            # `_resolve_prediction` with its own `inference_duration`; the
            # `EOTInferenceMetrics` emit lives exclusively in `_CloudTransport`
            # (`inference/eot/transports.py`). So the turn-detector lane is empty
            # for `audio` while the predictions themselves are visible only in a
            # debug log — verified on a real call, and it is true of the
            # per-participant assist worker too.
            #
            # Registered anyway: it is correct against Cloud or the full `v1`, and
            # a text detector (`livekit` / `scicom`) does report, timed from the
            # caller's side by `_TimedTurnDetector`. Choose one of those if the lane
            # matters more than the audio model's accuracy.
            detector.on("metrics_collected", on_metrics)
        return detector
    if MultilingualModel is None:
        return None
    detector = MultilingualModel()
    return _TimedTurnDetector(detector, on_metrics) if on_metrics is not None else detector


# ── Model wiring ─────────────────────────────────────────────────────────────


@dataclass
class ModelSpec:
    plugin: str
    model: str
    base_url: str | None
    api_key: str | None

    @classmethod
    def from_env(cls, prefix: str, *, default_plugin: str, default_model: str) -> ModelSpec:
        key_env = _env(f"{prefix}_API_KEY_ENV")
        return cls(
            plugin=_env(f"{prefix}_PLUGIN", default_plugin),
            model=_env(f"{prefix}_MODEL", default_model),
            base_url=_env(f"{prefix}_BASE_URL") or None,
            api_key=(_env(key_env) or None) if key_env else None,
        )


def _instantiate(spec: ModelSpec, class_name: str, **extra: object):
    """
    Build `livekit.plugins.<plugin>.<class_name>` from a spec.

    Only kwargs the constructor actually accepts are passed: `base_url` and
    `language` are near-universal but not universal, and a plugin that does not
    take one should still be usable rather than raising TypeError at start-up.
    """
    module = importlib.import_module(f"livekit.plugins.{spec.plugin}")
    cls = getattr(module, class_name)
    candidates: dict[str, object] = {"model": spec.model}
    if spec.base_url:
        candidates["base_url"] = spec.base_url
    if spec.api_key:
        candidates["api_key"] = spec.api_key
    candidates.update(extra)

    params = inspect.signature(cls.__init__).parameters
    accepts_kwargs = any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())
    supplied = {k: v for k, v in candidates.items() if v is not None}
    kwargs = {k: v for k, v in supplied.items() if accepts_kwargs or k in params}
    # Only warn about a value that was set and then thrown away — an unset
    # option is not a misconfiguration.
    if unsupported := [k for k in supplied if k not in kwargs]:
        logger.warning(
            "%s.%s takes no %s — ignored", spec.plugin, class_name, ", ".join(unsupported)
        )
    return cls(**kwargs)


STT_SPEC = ModelSpec.from_env("DUAL_STT", default_plugin="openai", default_model="whisper-1")
LLM_SPEC = ModelSpec.from_env("DUAL_LLM", default_plugin="openai", default_model="gpt-4o-mini")

# Values that mean "let the provider decide", which is expressed by not sending a
# language at all. The dashboard's builder offers `multi` for its multilingual
# models, and passing that string straight through is a 400 on *every* utterance
# ("Unsupported language: 'multi'") — a call where nothing is ever transcribed and
# the only clue is in the worker's log.
_AUTO_LANGUAGES = frozenset({"", "multi", "multilingual", "auto", "any"})


def _stt_language() -> str | None:
    return None if LANGUAGE.strip().lower() in _AUTO_LANGUAGES else LANGUAGE


def _metrics_to_dict(m: object) -> dict:
    """Best-effort dict for a metrics object across livekit-agents versions."""
    # Already a payload: the metrics this worker measures itself (see
    # `_eot_metric`) are built as dicts, and `vars()` below raises on one.
    if isinstance(m, dict):
        return m
    if is_dataclass(m) and not isinstance(m, type):
        data = asdict(m)
    elif hasattr(m, "model_dump"):
        data = m.model_dump()
    else:
        data = {k: v for k, v in vars(m).items() if not k.startswith("_")}
    data["kind"] = type(m).__name__
    return data


# ── Which track is whose ─────────────────────────────────────────────────────


def _first_attribute(attrs: dict[str, str] | None, keys: tuple[str, ...]) -> str:
    for key in keys or ():
        if value := ((attrs or {}).get(key) or "").strip():
            return value
    return ""


def track_role(publication: rtc.TrackPublication) -> str | None:
    """
    `"agent"`, `"customer"`, or None for a track this worker will not transcribe.

    Name before source, and a name that matches *both* roles is treated as having
    matched neither — `agent-and-customer-mixed` is a mixed track, and
    transcribing it as one side would be worse than ignoring it.
    """
    name = (publication.name or "").lower()
    matched = [role for role in ROLES if role in name]
    if len(matched) == 1:
        return matched[0]
    if len(matched) > 1:
        logger.warning(
            "track name %r names both roles — falling back to its source", publication.name
        )

    if publication.source == rtc.TrackSource.SOURCE_MICROPHONE:
        return MIC_ROLE
    if publication.source == rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO:
        return SCREENSHARE_ROLE
    return None


def role_label(role: str, participant: rtc.RemoteParticipant) -> str:
    """
    What to call this leg on screen.

    The agent leg is a person in the room, so their participant name is the best
    answer. The customer is not in the room at all — only the publisher can say
    who is on the phone, which it does through an attribute.
    """
    if role == AGENT_ROLE:
        return (
            _first_attribute(participant.attributes, AGENT_NAME_ATTRIBUTES)
            or (participant.name or "").strip()
            or AGENT_LABEL
        )
    return _first_attribute(participant.attributes, CUSTOMER_NAME_ATTRIBUTES) or CUSTOMER_LABEL


# ── One track, as a session's audio input ────────────────────────────────────


class TrackAudioInput(AudioInput):
    """
    A single remote audio track, fed to an `AgentSession` as its microphone.

    This is the piece RoomIO cannot supply. `_ParticipantAudioInputStream` is
    built with `track_source=SOURCE_MICROPHONE`, so a session linked by identity
    to a participant publishing two audio tracks always gets the microphone one
    and the screen-share leg is unreachable — no `RoomOptions` field changes that.

    Everything it does is something RoomIO also does, and each piece is here
    because leaving it out breaks something specific:

    * `AudioStream.from_track(sample_rate=…, frame_size_ms=…,
      noise_cancellation=…)` — the same call RoomIO makes. It owns the
      resampling, the chunking, and running the filter on each chunk.
    * `AudioProcessingModule(auto_gain_control=True)` — a phone leg re-captured
      through a screen share is routinely quieter than the headset beside it, and
      one loud speaker next to one quiet one is a VAD that never fires on half
      the call.
    * a trailing half-second of silence when the track goes away, so the
      recogniser flushes the utterance in flight instead of dropping it. This is
      why hanging up mid-sentence still lands that sentence in the transcript.
    * re-binding on republish. The agent muting and unmuting, or restarting the
      tab share mid-call, unpublishes and republishes — a stream that only ever
      attached once would go silent for the rest of the call.

    `_attached` mirrors RoomIO's own behaviour: the session detaches an input
    while its activity is not running, and frames arriving then are dropped rather
    than queued into a backlog that replays as a burst of stale speech.
    """

    def __init__(
        self,
        room: rtc.Room,
        *,
        identity: str,
        role: str,
        sample_rate: int,
        frame_size_ms: int,
        num_channels: int = 1,
        auto_gain_control: bool = True,
        noise_cancellation=None,
    ) -> None:
        super().__init__(label=f"dual-track:{role}")
        self._room = room
        self._identity = identity
        self._role = role
        self._sample_rate = sample_rate
        self._num_channels = num_channels
        self._frame_size_ms = frame_size_ms
        self._noise_cancellation = noise_cancellation

        self._ch = utils.aio.Chan[rtc.AudioFrame]()
        self._attached = True
        self._closed = False
        self._publication: rtc.RemoteTrackPublication | None = None
        self._stream: rtc.AudioStream | None = None
        self._processor: rtc.FrameProcessor | None = None
        self._forward_task: asyncio.Task[None] | None = None
        # Silence flushes, which are safe to abandon...
        self._tasks: set[asyncio.Task[None]] = set()
        # ...and stream/filter teardown, which is not: cancelling one leaves the
        # ONNX session unreleased and the last metrics window unpublished.
        self._shutdowns: set[asyncio.Task[None]] = set()

        self._apm = rtc.AudioProcessingModule(auto_gain_control=True) if auto_gain_control else None

        room.on("track_subscribed", self._on_track_subscribed)
        room.on("track_unpublished", self._on_track_unpublished)
        room.on("track_muted", self._on_track_muted)

    # -- the AudioInput contract ---------------------------------------------

    async def __anext__(self) -> rtc.AudioFrame:
        return await self._ch.__anext__()

    def on_attached(self) -> None:
        self._attached = True

    def on_detached(self) -> None:
        self._attached = False

    # -- binding -------------------------------------------------------------

    def adopt(
        self,
        track: rtc.RemoteTrack,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> bool:
        """Take this track as our source, if it is ours. True when adopted."""
        if self._closed:
            return False
        if participant.identity != self._identity:
            return False
        if publication.kind != rtc.TrackKind.KIND_AUDIO:
            return False
        if track_role(publication) != self._role:
            return False
        if self._publication is not None and self._publication.sid == publication.sid:
            return False

        self._close_stream()

        # A filter instance per stream, built here rather than shared: GTCRN's
        # recurrent caches are per-stream state, and one instance across two legs
        # would smear one voice into the other's noise estimate.
        processor = self._noise_cancellation() if self._noise_cancellation else None
        self._processor = processor
        self._publication = publication
        self._stream = rtc.AudioStream.from_track(
            track=track,
            sample_rate=self._sample_rate,
            num_channels=self._num_channels,
            frame_size_ms=self._frame_size_ms,
            noise_cancellation=processor,
            # We own the processor's lifetime — it has to survive this stream so
            # `_close` can publish the window it was part-way through.
            auto_close_noise_cancellation=False,
        )
        logger.info(
            "%s leg bound to %s (%s) from %s",
            self._role,
            publication.name or "<unnamed>",
            rtc.TrackSource.Name(publication.source),
            participant.identity,
        )
        self._forward_task = asyncio.create_task(self._forward(self._forward_task, self._stream))
        return True

    def bind_existing(self, participant: rtc.RemoteParticipant) -> bool:
        """Adopt a track this participant had already published before we existed."""
        for publication in participant.track_publications.values():
            if publication.track and self.adopt(publication.track, publication, participant):
                return True
        return False

    @property
    def bound(self) -> bool:
        return self._publication is not None

    def _on_track_subscribed(self, track, publication, participant) -> None:
        self.adopt(track, publication, participant)

    def _on_track_unpublished(self, publication, participant) -> None:
        if (
            self._publication is None
            or self._publication.sid != publication.sid
            or participant.identity != self._identity
        ):
            return
        logger.info("%s leg lost its track (%s)", self._role, publication.name or "<unnamed>")
        self._close_stream()
        # The other leg may have been republished under a new sid in the same
        # tick; take it if so, rather than waiting for another event.
        self.bind_existing(participant)

    def _on_track_muted(self, publication, participant) -> None:
        # Muting does not unpublish, so nothing is rebound — but the recogniser
        # should not be left holding a half-finished utterance while the agent
        # takes their headset off.
        if (
            self._publication is not None
            and self._publication.sid == publication.sid
            and participant.identity == self._identity
        ):
            self._flush()

    # -- the audio path ------------------------------------------------------

    async def _forward(
        self, previous: asyncio.Task[None] | None, stream: rtc.AudioStream
    ) -> None:
        if previous:
            await utils.aio.cancel_and_wait(previous)
        try:
            async for event in stream:
                if not self._attached or self._closed:
                    continue
                frame = event.frame
                if self._apm is not None:
                    self._apm.process_stream(frame)
                await self._ch.send(frame)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("%s leg stopped reading its track", self._role)

    def _flush(self) -> None:
        """
        Half a second of silence, so the recogniser finalises what it is holding.

        A one-shot STT behind the VAD needs a pause to call the utterance over. A
        track that simply stops delivering frames never provides one, so the last
        thing said before a mute or a hang-up would otherwise never be
        transcribed — the exact turn most worth having.
        """
        if self._closed:
            return
        samples = int(self._sample_rate * 0.5)
        frame = rtc.AudioFrame(
            b"\x00\x00" * samples * self._num_channels,
            sample_rate=self._sample_rate,
            num_channels=self._num_channels,
            samples_per_channel=samples,
        )
        task = asyncio.create_task(self._ch.send(frame))
        task.add_done_callback(self._tasks.discard)
        self._tasks.add(task)

    def _close_stream(self) -> None:
        stream, processor = self._stream, self._processor
        self._stream = None
        self._processor = None
        had_track = self._publication is not None
        self._publication = None

        if stream is not None or processor is not None:
            # **Order matters, and getting it wrong is not quiet.** Closing the
            # stream is async, so it cannot be done from here; closing the filter
            # is synchronous. Doing the second while the first is still draining
            # leaves the SDK's read loop calling `_process` on a GTCRN whose ONNX
            # caches `_close()` has already cleared, and it dies with
            # `Required inputs (['conv_cache', …]) are missing` — inside
            # livekit.rtc, so it reads as an SDK bug rather than a teardown race.
            # It fires on any republish too: a mute/unmute mid-call is an
            # unpublish followed by a publish.
            async def _shutdown() -> None:
                if stream is not None:
                    await stream.aclose()
                if processor is not None:
                    try:
                        # Publishes the part-window it was in the middle of, then
                        # releases the session. A per-stream instance is not
                        # reusable on the next one.
                        processor._close()
                    except Exception:
                        logger.debug("closing the noise filter failed", exc_info=True)

            task = asyncio.create_task(_shutdown())
            task.add_done_callback(self._shutdowns.discard)
            self._shutdowns.add(task)

        if had_track:
            self._flush()

    async def aclose(self) -> None:
        self._room.off("track_subscribed", self._on_track_subscribed)
        self._room.off("track_unpublished", self._on_track_unpublished)
        self._room.off("track_muted", self._on_track_muted)
        self._close_stream()
        self._closed = True

        # Waited on, not cancelled — see `_close_stream`. Bounded, because a
        # stream whose close hangs must not hold up the whole job's shutdown.
        if self._shutdowns:
            _, pending = await asyncio.wait(self._shutdowns, timeout=5)
            for task in pending:
                logger.warning("%s leg: teardown did not finish in time", self._role)
                task.cancel()

        if self._forward_task:
            await utils.aio.cancel_and_wait(self._forward_task)
        # These only ever push silence into a channel nobody is reading any more.
        for task in list(self._tasks):
            task.cancel()
        self._ch.close()


# ── The call ─────────────────────────────────────────────────────────────────


class Transcriber(Agent):
    """
    A do-nothing agent whose only job is to notice completed turns.

    The session it belongs to has no LLM, so `AgentActivity` returns right after
    this hook and never generates a reply. The instructions are never sent
    anywhere; they exist because `Agent` requires them.
    """

    def __init__(self, role: str, on_turn) -> None:
        super().__init__(instructions=f"Transcribe the {role} on this call. Never speak.")
        self._role = role
        self._on_turn = on_turn

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        text = (new_message.text_content or "").strip()
        if text:
            await self._on_turn(self._role, text)


class DualTrackCall:
    """One room: one publisher carrying two voices, and the notes between them."""

    def __init__(self, ctx: JobContext) -> None:
        self._ctx = ctx
        # Keyed on (identity, role). Two publishers in one room is not the shape
        # this is for, but keying on the pair means the second one gets its own
        # lanes instead of silently losing its audio to the first one's session.
        self._sessions: dict[tuple[str, str], AgentSession] = {}
        self._inputs: dict[tuple[str, str], TrackAudioInput] = {}
        self._history: list[dict[str, str]] = []
        self._llm = _instantiate(LLM_SPEC, "LLM") if SUGGEST_FOR in ROLES else None
        self._suggest_task: asyncio.Task[None] | None = None

        if self._llm is not None:
            # The coaching LLM is called outside any AgentSession, so nothing
            # forwards its metrics the way a voice agent's are forwarded. Without
            # this the timeline showed the two legs being transcribed and no sign
            # of the model reading them. Untagged on purpose: a note is about the
            # call, not about one speaker.
            @self._llm.on("metrics_collected")
            def _on_llm_metrics(m: object) -> None:
                metrics.log_metrics(m)
                self._publish_metrics(m)

    # -- publishing ----------------------------------------------------------

    def _publish(self, topic: str, payload: dict) -> None:
        data = json.dumps(payload).encode()

        async def _send() -> None:
            try:
                await self._ctx.room.local_participant.publish_data(
                    data, topic=topic, reliable=True
                )
            except Exception:
                # A dropped note must never take the transcription down with it.
                logger.debug("publish to %s failed", topic, exc_info=True)

        asyncio.create_task(_send())

    def _publish_metrics(self, m: object, speaker: dict | None = None) -> None:
        # VAD fires a couple of times a second for the whole call, times two
        # legs. Publishing it would bury everything that matters.
        if "VAD" in type(m).__name__ or getattr(m, "type", "") == "vad_metrics":
            return
        payload = _metrics_to_dict(m)
        # Which leg this measures. Both sessions publish onto one room topic, so
        # without this the dashboard can only draw a single STT lane for a
        # conversation that had two people in it.
        if speaker is not None:
            payload = {**payload, "speaker": speaker}
        # How much of the segment was never speech. `audio_duration` covers what
        # was *sent* to the recogniser, which is the utterance plus the padding
        # the VAD wraps it in — so a bar drawn from it alone reads as longer than
        # what you hear. These are the numbers that produced it.
        if payload.get("type") == "stt_metrics":
            payload = {
                **payload,
                "vadPadding": {"prefix": VAD_PREFIX_PADDING, "silence": VAD_MIN_SILENCE},
            }
        self._publish(CONSOLE_METRICS_TOPIC, payload)

    # -- sessions ------------------------------------------------------------

    async def on_track(
        self,
        track: rtc.RemoteTrack,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        """
        A track arrived. Start a session for its leg, or hand it to the existing one.

        Sessions are created per *track role*, lazily, because the role is a
        property of the track and not of the participant — there is nothing to
        attach to until something is published. An audio track whose role cannot
        be resolved is reported rather than guessed at.
        """
        if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
            return
        if publication.kind != rtc.TrackKind.KIND_AUDIO:
            return

        role = track_role(publication)
        if role is None:
            logger.warning(
                "ignoring an audio track with no resolvable role",
                extra={
                    "identity": participant.identity,
                    "name": publication.name,
                    "source": rtc.TrackSource.Name(publication.source),
                },
            )
            self._publish(
                TRANSCRIPT_TOPIC,
                {
                    "event": "unmatched-track",
                    "identity": participant.identity,
                    "track": publication.name or "",
                    "source": rtc.TrackSource.Name(publication.source),
                    "ts": int(time.time() * 1000),
                },
            )
            return

        key = (participant.identity, role)
        # A leg that already has a session rebinds inside its own input — the
        # stream's `track_subscribed` handler has already seen this event.
        if key in self._sessions:
            return

        await self._start_leg(role, publication, participant)

    async def _start_leg(
        self,
        role: str,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        key = (participant.identity, role)
        name = role_label(role, participant)
        speaker = {"identity": participant.identity, "name": name, "role": role}

        def on_metrics(m: object) -> None:
            self._publish_metrics(m, speaker)

        audio = TrackAudioInput(
            self._ctx.room,
            identity=participant.identity,
            role=role,
            sample_rate=GTCRN_SAMPLE_RATE if GTCRN else 24000,
            frame_size_ms=AUDIO_CHUNK_MS,
            auto_gain_control=AUTO_GAIN_CONTROL,
            noise_cancellation=(lambda: MeteredGTCRN(on_metrics)) if GTCRN else None,
        )

        session = AgentSession(
            stt=_instantiate(STT_SPEC, "STT", language=_stt_language()),
            vad=self._ctx.proc.userdata["vad"],
            turn_handling=TurnHandlingOptions(turn_detection=_build_turn_detection(on_metrics)),
        )
        # Set before `start()`: `AgentSession` disables RoomIO's own audio input
        # when `input.audio` is already present, which is exactly what we want —
        # RoomIO would otherwise bind the microphone leg to both sessions.
        session.input.audio = audio

        # Claim the slot before anything awaits, so two tracks arriving in the
        # same tick cannot both pass the guard in `on_track`.
        self._sessions[key] = session
        self._inputs[key] = audio

        @session.on("user_input_transcribed")
        def _on_transcribed(ev: UserInputTranscribedEvent) -> None:
            if not ev.is_final and not TRANSCRIBE_INTERIM:
                return
            self._publish(
                TRANSCRIPT_TOPIC,
                {
                    "role": role,
                    "name": name,
                    "identity": participant.identity,
                    "text": ev.transcript,
                    "final": ev.is_final,
                    "id": ev.item_id or f"{participant.identity}-{role}-{ev.created_at}",
                    "ts": int(ev.created_at * 1000),
                },
            )

        @session.on("metrics_collected")
        def _on_metrics(ev: MetricsCollectedEvent) -> None:
            metrics.log_metrics(ev.metrics)
            # EOT arrives here as well when the audio detector is in use, but
            # anonymously; the detector hook publishes it with its speaker.
            if getattr(ev.metrics, "type", "") == "eot_inference_metrics":
                return
            self._publish_metrics(ev.metrics, speaker)

        @session.on("error")
        def _on_error(ev: ErrorEvent) -> None:
            # A failing STT is otherwise invisible: the worker is in the room, the
            # level meters move, and the transcript is simply always empty. One
            # rejected language setting can do this to every utterance of a call,
            # so the reason goes to the people on it, not just to this log.
            source = getattr(ev.source, "label", None) or type(ev.source).__name__
            message = str(getattr(ev.error, "error", None) or ev.error)
            logger.error("%s failed for the %s leg: %s", source, role, message)
            self._publish(
                TRANSCRIPT_TOPIC,
                {
                    "role": role,
                    "name": name,
                    "identity": participant.identity,
                    "event": "error",
                    "source": source,
                    "error": message[:400],
                    "ts": int(time.time() * 1000),
                },
            )

        try:
            await session.start(
                agent=Transcriber(role, self._on_turn),
                room=self._ctx.room,
                room_options=room_io.RoomOptions(
                    # `input.audio` above is the real source; saying so here keeps
                    # the SDK from logging that it ignored its own.
                    audio_input=False,
                    # Nothing to say and nothing to answer.
                    audio_output=False,
                    # This worker owns `lk.chat` itself — a typed line has to be
                    # attributed to a *side*, which RoomIO has no way to do here,
                    # and two RoomIOs would fight over the same handler anyway.
                    text_input=False,
                    # `lk.transcription`, which is what session capture reads.
                    # Both legs are published as the publisher, since the customer
                    # is not a participant: history gets the words in order under
                    # one speaker, and `assist.transcript` above is the
                    # role-accurate view.
                    participant_identity=participant.identity,
                    # One leg going away must not close the other's session, and
                    # the publisher leaving must not close either before their
                    # last utterance has been flushed.
                    close_on_disconnect=False,
                ),
            )
        except Exception:
            self._sessions.pop(key, None)
            self._inputs.pop(key, None)
            await audio.aclose()
            logger.exception("failed to start the %s leg", role)
            return

        # The stream is created by the room event that got us here, which the
        # input's own handler may have already seen — but on the sweep at
        # connect() there is no event to see, so bind what is already published.
        if not audio.bound:
            audio.bind_existing(participant)

        self._publish(
            TRANSCRIPT_TOPIC,
            {
                "role": role,
                "name": name,
                "identity": participant.identity,
                "event": "leg-started",
                "track": publication.name or "",
                "source": rtc.TrackSource.Name(publication.source),
                "ts": int(time.time() * 1000),
            },
        )

    async def detach(self, identity: str) -> None:
        """Tear down both legs of a publisher that left."""
        for key in [k for k in self._sessions if k[0] == identity]:
            session = self._sessions.pop(key)
            audio = self._inputs.pop(key, None)
            logger.info("detaching the %s leg of %s", key[1], identity)
            if audio is not None:
                await audio.aclose()
            try:
                await session.aclose()
            except Exception:
                logger.debug("error closing the %s session", key[1], exc_info=True)

    # -- suggestions ---------------------------------------------------------

    async def _on_turn(self, role: str, text: str) -> None:
        self._history.append({"role": role, "text": text})
        logger.info("[%s] %s", role, text)

        if self._llm is None or role != SUGGEST_FOR:
            return

        # The last suggestion is stale the moment the customer says something
        # else — cancel it rather than letting two answers race onto the topic.
        if self._suggest_task and not self._suggest_task.done():
            self._suggest_task.cancel()
        self._suggest_task = asyncio.create_task(self._suggest(text))

    async def _suggest(self, latest: str) -> None:
        assert self._llm is not None
        suggestion_id = f"s{int(time.time() * 1000)}"
        recent = self._history[-HISTORY_TURNS:]
        transcript = "\n".join(f"{t['role'].upper()}: {t['text']}" for t in recent)

        chat_ctx = llm.ChatContext.empty()
        chat_ctx.add_message(role="system", content=INSTRUCTIONS)
        chat_ctx.add_message(
            role="user",
            content=(
                f"Call so far:\n{transcript}\n\n"
                f'The {SUGGEST_FOR} just said: "{latest}"\n\n'
                "What should the support agent do or say next?"
            ),
        )

        self._publish(SUGGESTION_TOPIC, {"id": suggestion_id, "state": "thinking"})
        buffer: list[str] = []
        try:
            stream = self._llm.chat(chat_ctx=chat_ctx)
            try:
                async for chunk in stream:
                    delta = chunk.delta.content if chunk.delta else None
                    if not delta:
                        continue
                    buffer.append(delta)
                    self._publish(SUGGESTION_TOPIC, {"id": suggestion_id, "delta": delta})
            finally:
                await stream.aclose()
        except asyncio.CancelledError:
            self._publish(SUGGESTION_TOPIC, {"id": suggestion_id, "state": "superseded"})
            raise
        except Exception as e:
            logger.error("suggestion failed: %s", e)
            self._publish(
                SUGGESTION_TOPIC, {"id": suggestion_id, "state": "error", "error": str(e)}
            )
            return

        full = "".join(buffer).strip()
        if not full:
            # Seen in the wild: a 200 with `finish_reason: stop` and no content at
            # all. Publishing it as `done` would put an empty card on the agent's
            # screen, which reads as the coach having nothing to say rather than
            # as a failed call.
            logger.warning("suggestion came back empty")
            self._publish(
                SUGGESTION_TOPIC,
                {"id": suggestion_id, "state": "error", "error": "the model returned nothing"},
            )
            return

        logger.info("suggestion: %s", full)
        self._publish(SUGGESTION_TOPIC, {"id": suggestion_id, "state": "done", "text": full})

    # -- typed turns ---------------------------------------------------------

    def _register_chat_handler(self) -> None:
        """
        Read the room's chat topic so typing counts as a turn.

        A typed line has to be attributed to a *side*, and in this shape the
        sender's identity cannot say which — the publisher carries both voices. So
        the sender says: the composer stamps `assistRole` on the text stream, and
        anything unstamped is the support agent, who is the one with a keyboard.

        Being able to type as the *customer* is what makes this worker testable
        without a phone on the other end: one typed line triggers the coaching
        exactly as a spoken turn would.

        Nothing is re-published — every client renders `lk.chat` itself, and
        session capture already records it as a text turn. Registering this at all
        is only safe because the sessions run with `text_input=False`.
        """

        def _on_chat(reader, participant_identity: str) -> None:
            async def _read() -> None:
                try:
                    text = (await reader.read_all()).strip()
                except Exception:
                    logger.debug("could not read a chat message", exc_info=True)
                    return
                if not text:
                    return

                attrs = getattr(reader.info, "attributes", None) or {}
                claimed = _first_attribute(attrs, CHAT_ROLE_ATTRIBUTES).lower()
                role = claimed if claimed in ROLES else AGENT_ROLE

                logger.info("[%s typed] %s", role, text)
                await self._on_turn(role, text)

            asyncio.create_task(_read())

        try:
            self._ctx.room.register_text_stream_handler(CHAT_TOPIC, _on_chat)
        except ValueError:
            # Something else already owns the topic. Speech still works; typing
            # just will not reach the coach.
            logger.warning("chat topic %s already handled — typed turns ignored", CHAT_TOPIC)

    # -- lifecycle -----------------------------------------------------------

    async def run(self) -> None:
        ctx = self._ctx

        # Handlers before `connect()`: a track published during the handshake
        # would otherwise be missed entirely, and the sweep below only covers
        # what was already there when we arrived.
        @ctx.room.on("track_subscribed")
        def _on_track(track, publication, participant) -> None:
            asyncio.create_task(self.on_track(track, publication, participant))

        @ctx.room.on("participant_disconnected")
        def _on_disconnected(p: rtc.RemoteParticipant) -> None:
            asyncio.create_task(self.detach(p.identity))

        self._register_chat_handler()

        # Nothing connects the room for us here. A normal voice agent lets
        # `session.start()` do it, but this worker may sit in a room with nothing
        # published yet — the agent opens the page and only then shares the
        # softphone tab — and a job that never connects is reaped as one that did
        # nothing.
        await ctx.connect()

        # Whoever created the room is already here: their join is what triggered
        # the dispatch that started this job.
        for participant in list(ctx.room.remote_participants.values()):
            for publication in list(participant.track_publications.values()):
                if publication.track is not None:
                    await self.on_track(publication.track, publication, participant)

        logger.info("listening in %s", ctx.room.name)

    async def aclose(self) -> None:
        if self._suggest_task and not self._suggest_task.done():
            self._suggest_task.cancel()
        for identity in {key[0] for key in self._sessions}:
            await self.detach(identity)


server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=VAD_MIN_SPEECH,
        min_silence_duration=VAD_MIN_SILENCE,
        prefix_padding_duration=VAD_PREFIX_PADDING,
        activation_threshold=VAD_ACTIVATION,
    )


server.setup_fnc = prewarm


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    call = DualTrackCall(ctx)
    ctx.add_shutdown_callback(call.aclose)
    await call.run()


if __name__ == "__main__":
    cli.run_app(server)
