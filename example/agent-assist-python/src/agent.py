"""
Agent assist — live transcription of a call between two *humans*, plus
suggestions whispered to the one taking the call.

This is not a voice agent. Nobody here speaks: the worker joins the room as a
silent participant, transcribes each human separately, and publishes what it
hears (and what it thinks the support agent should say next) on room data
topics. The dashboard's `agent-assist-react` sandbox renders those.

## Why one AgentSession per human

The obvious shape for "transcribe two people" is to subscribe to both tracks and
push each into an STT stream by hand. That is what this started as, and it means
reimplementing — badly — everything `AgentSession` already owns: VAD gating, the
stream adapter that wraps a non-streaming STT, interim vs final transcripts,
noise cancellation on the input, end-of-turn detection, and forwarding
transcripts back to the room so other clients can see them.

So instead there is one `AgentSession` per human participant, each bound to that
participant by identity (`RoomOptions.participant_identity`), each with:

  * `AudioInputOptions.noise_cancellation` — GTCRN, an ONNX model that runs in
    this process. One instance per stream, because its recurrent caches are
    per-stream state. At 16 kHz it adds 32 ms; any other rate adds two resampler
    stages that cost more than the model does.
  * a turn detector — so `on_user_turn_completed` fires when someone has
    actually finished a thought, not every time VAD sees 200 ms of quiet. This
    is the difference between one useful suggestion per turn and a suggestion
    per breath.
  * **no LLM and no TTS.** `AgentActivity` returns early when `llm is None`, so
    a session in this shape is a pure transcriber — it will never try to reply,
    and there is no `StopResponse` dance to remember.

Sessions are created as participants arrive and torn down when they leave, so a
reconnecting caller gets a fresh one rather than a session bound to a dead
identity.

## Who is who

Roles come off the participant, not from track names: the sandbox's token route
stamps `assistRole` (`agent` | `customer`) and `assistName` into the token's
attributes. Identity prefixes (`agent-…`, `customer-…`) and a `{"role": …}`
metadata blob are accepted as fallbacks, so a hand-made token still works.
A participant with no resolvable role is ignored — better a missing transcript
than the customer's audio labelled as the support agent's.

## Configuration

Everything is read from the environment, so the deployed copy of this file is
byte-identical to the one in the repo and the dashboard only writes
`.env.local`. See `.env.example` for the full list.
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
)
from livekit.agents.voice import room_io
from livekit.plugins import silero

# Before any turn-detector import: the remote detector decides at *import time*
# whether to register a local ONNX runner, and skips it only when
# LIVEKIT_REMOTE_EOT_URL is already set.
load_dotenv(".env.local")

logger = logging.getLogger("agent-assist")

# ── Topics ───────────────────────────────────────────────────────────────────
# `lk.metrics` is what the dashboard console and the session observer read, so
# publishing there gets STT/EOU latency into the console and into session
# history for free. The two `assist.*` topics are this worker's own.
CONSOLE_METRICS_TOPIC = "lk.metrics"
TRANSCRIPT_TOPIC = "assist.transcript"
SUGGESTION_TOPIC = "assist.suggestion"

AGENT_ROLE = "agent"
CUSTOMER_ROLE = "customer"
ROLES = (AGENT_ROLE, CUSTOMER_ROLE)

# Typed messages. The standard LiveKit chat topic, so a typed turn is recorded by
# session capture as its own line (`via: "text"`) and every client already knows
# how to read it — this worker does not re-publish them.
CHAT_TOPIC = "lk.chat"

# Canonical spelling is camelCase and dot-free: livekit-server-sdk camelCases
# attribute-map keys when it decodes a REST `listParticipants` response, so
# `assist.role` reaches this worker intact over the websocket but comes back out
# of the REST API as `assistRole`. The other spellings are accepted so a
# hand-written token still works either way.
ROLE_ATTRIBUTES = ("assistRole", "assist.role", "assist_role", "role")
NAME_ATTRIBUTES = ("assistName", "assist.name", "assist_name")

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


AGENT_NAME = _env("ASSIST_AGENT_NAME", "agent-assist")
LANGUAGE = _env("ASSIST_LANGUAGE")
INSTRUCTIONS = _env("ASSIST_INSTRUCTIONS") or DEFAULT_INSTRUCTIONS
TURN_DETECTOR = _env("ASSIST_TURN_DETECTOR", "audio").lower()
NOISE_CANCELLATION = _env("ASSIST_NOISE_CANCELLATION", "gtcrn").lower()
SUGGEST_FOR = _env("ASSIST_SUGGEST_FOR", CUSTOMER_ROLE).lower()

# ── How much silence goes to the recogniser ──────────────────────────────────
# Silero's own defaults pad every utterance by about a second — 0.5s kept from
# before speech started, 0.55s of silence waited out before it is called ended —
# and all of it is sent to the STT. Two costs: the transcript arrives later than
# it needs to, and `audio_duration` (which is what puts a bar on the metrics
# timeline) covers noticeably more than the speech you hear, so a segment reads
# as longer than it was.
#
# The two are not equally safe to cut, which is why they are not cut equally:
#
# * **The prefix is nearly free.** It only decides how much silence is kept from
#   before speech started; 0.2s still covers a first syllable. This is the win.
# * **The trailing silence is what ends a turn.** Cutting it to 0.35s split
#   "Support here, how can I help?" into two utterances on a measured run — the
#   pause between the sentences was longer than the wait — and each fragment then
#   costs its own STT call, its own turn-detector run, and reaches the coaching
#   LLM as a separate turn. 0.5s keeps sentences whole while still trimming.
#
# Together: 1.05s of padding per utterance down to 0.7s. Push `MIN_SILENCE` lower
# for faster coaching if fragmented lines are an acceptable trade.
VAD_PREFIX_PADDING = _env_float("ASSIST_VAD_PREFIX_PADDING", 0.2)
VAD_MIN_SILENCE = _env_float("ASSIST_VAD_MIN_SILENCE", 0.5)
VAD_MIN_SPEECH = _env_float("ASSIST_VAD_MIN_SPEECH", 0.05)
VAD_ACTIVATION = _env_float("ASSIST_VAD_ACTIVATION", 0.5)
HISTORY_TURNS = int(_env("ASSIST_HISTORY_TURNS", "12") or 12)
TRANSCRIBE_INTERIM = _env_flag("ASSIST_INTERIM_TRANSCRIPTS", True)

# GTCRN's native rate. Handing the SDK anything else buys two resampler stages
# whose latency (56 ms) dwarfs the model's own (32 ms), and 16 kHz is what the
# STT and the VAD want anyway.
GTCRN_SAMPLE_RATE = 16000


# ── Noise cancellation ───────────────────────────────────────────────────────
# `AudioInputOptions.noise_cancellation` accepts either Krisp's Cloud-authorised
# options or any `rtc.FrameProcessor`, and only the first is gated. GTCRN is the
# second kind: nothing to authorise, no external service. Krisp's own plugin on
# a self-hosted server logs `noise cancellation is not authorized (404)` and
# passes audio through untouched, which is why it is not an option here.
if NOISE_CANCELLATION == "gtcrn":
    from stt_api.livekit_plugin.noise_cancellation import GTCRN
else:
    GTCRN = None  # type: ignore[assignment]


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
    and drops the number into a debug log — so a call using one showed no turn
    detection on the metrics timeline whatsoever. Timing it from the caller's side
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
    The configured detector, or NOT_GIVEN-ish `None` to fall back to VAD.

    One per session rather than one per worker: both humans' turns run through
    their own detector, and a shared instance would report predictions with no
    way to tell whose turn they ended — which is the whole point of a lane per
    speaker on the metrics timeline.
    """
    if TURN_DETECTOR == "audio":
        # Ships its weights in `livekit-local-inference`, a hard dependency of
        # livekit-agents — no download, no LiveKit Cloud account. Self-hosted
        # always resolves to v1-mini; the full v1 is Cloud-only.
        from livekit.agents import inference

        detector = inference.TurnDetector(version="v1-mini")
        if on_metrics is not None:
            # The session forwards these too, but with no idea which participant
            # they belong to — which is why the session-level handler drops EOT.
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
        logger.warning("%s.%s takes no %s — ignored", spec.plugin, class_name, ", ".join(unsupported))
    return cls(**kwargs)


STT_SPEC = ModelSpec.from_env("ASSIST_STT", default_plugin="openai", default_model="whisper-1")
LLM_SPEC = ModelSpec.from_env("ASSIST_LLM", default_plugin="openai", default_model="gpt-4o-mini")

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


# ── Role resolution ──────────────────────────────────────────────────────────


def _first_attribute(attrs: dict[str, str], keys: tuple[str, ...]) -> str:
    for key in keys:
        if value := (attrs.get(key) or "").strip():
            return value
    return ""


def _participant_role(p: rtc.RemoteParticipant) -> str | None:
    attrs = p.attributes or {}
    raw = _first_attribute(attrs, ROLE_ATTRIBUTES).lower()
    if raw in ROLES:
        return raw

    if p.metadata:
        try:
            meta = json.loads(p.metadata)
        except (ValueError, TypeError):
            meta = None
        if isinstance(meta, dict):
            raw = str(meta.get("role") or "").strip().lower()
            if raw in ROLES:
                return raw

    identity = (p.identity or "").lower()
    for role in ROLES:
        if identity.startswith(f"{role}-") or identity.startswith(f"{role}_"):
            return role
    return None


def _display_name(p: rtc.RemoteParticipant, role: str) -> str:
    attrs = p.attributes or {}
    return (
        _first_attribute(attrs, NAME_ATTRIBUTES) or (p.name or "").strip() or role.capitalize()
    )


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


class AssistedCall:
    """One room: up to one support agent, one customer, and the notes between."""

    def __init__(self, ctx: JobContext) -> None:
        self._ctx = ctx
        self._sessions: dict[str, AgentSession] = {}
        self._roles: dict[str, str] = {}
        self._history: list[dict[str, str]] = []
        self._llm = _instantiate(LLM_SPEC, "LLM") if SUGGEST_FOR in ROLES else None
        self._suggest_task: asyncio.Task[None] | None = None

        if self._llm is not None:
            # The coaching LLM is called outside any AgentSession, so nothing
            # forwards its metrics the way a voice agent's are forwarded. Without
            # this the timeline showed the two speakers being transcribed and no
            # sign of the model reading them. Untagged on purpose: a note is
            # about the call, not about one speaker.
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
        # speakers. Publishing it would bury everything that matters.
        if "VAD" in type(m).__name__ or getattr(m, "type", "") == "vad_metrics":
            return
        payload = _metrics_to_dict(m)
        # Which of the two people this measures. Both sessions publish onto one
        # room topic, so without this the dashboard can only draw a single STT
        # lane for a conversation that had two speakers in it.
        if speaker is not None:
            payload = {**payload, "speaker": speaker}
        # How much of the segment was never speech. `audio_duration` covers what
        # was *sent* to the recogniser, which is the utterance plus the padding
        # the VAD wraps it in — so a bar drawn from it alone reads as longer than
        # what you hear. These are the numbers that produced it, and the timeline
        # draws the difference.
        if payload.get("type") == "stt_metrics":
            payload = {
                **payload,
                "vadPadding": {"prefix": VAD_PREFIX_PADDING, "silence": VAD_MIN_SILENCE},
            }
        self._publish(CONSOLE_METRICS_TOPIC, payload)

    # -- sessions ------------------------------------------------------------

    async def attach(self, participant: rtc.RemoteParticipant) -> None:
        if participant.identity in self._sessions:
            return
        if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
            return

        role = _participant_role(participant)
        if role is None:
            logger.warning(
                "ignoring participant with no assist role",
                extra={"identity": participant.identity},
            )
            return

        name = _display_name(participant, role)
        logger.info("attaching to %s (%s) as %s", participant.identity, name, role)

        speaker = {"identity": participant.identity, "name": name, "role": role}

        session = AgentSession(
            stt=_instantiate(STT_SPEC, "STT", language=_stt_language()),
            vad=self._ctx.proc.userdata["vad"],
            turn_handling=TurnHandlingOptions(
                turn_detection=_build_turn_detection(
                    lambda m: self._publish_metrics(m, speaker)
                )
            ),
        )

        # Claim the slot before `start()` awaits, so two participants connecting
        # in the same tick cannot both pass the guard above.
        self._sessions[participant.identity] = session
        self._roles[participant.identity] = role

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
                    "id": ev.item_id or f"{participant.identity}-{ev.created_at}",
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
            # microphone works, and the transcript is simply always empty. One
            # rejected language setting can do this to every utterance of a call,
            # so the reason goes to the people on it, not just to this log.
            source = getattr(ev.source, "label", None) or type(ev.source).__name__
            message = str(getattr(ev.error, "error", None) or ev.error)
            logger.error("%s failed for %s: %s", source, role, message)
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
                    participant_identity=participant.identity,
                    audio_input=room_io.AudioInputOptions(
                        sample_rate=GTCRN_SAMPLE_RATE if GTCRN else 24000,
                        # A selector, not one instance: each stream needs its own
                        # recurrent caches, and sharing them across participants
                        # would cross-contaminate the two voices.
                        noise_cancellation=(lambda params: GTCRN()) if GTCRN else None,
                        # This worker joins a call already in progress and there
                        # is a second session on the same room; both make the
                        # pre-connect audio buffer pointless and its byte-stream
                        # handler a duplicate registration.
                        pre_connect_audio=False,
                    ),
                    # Nothing to say and nothing to answer: no published track,
                    # and typed chat is not this worker's business. Leaving text
                    # input on would also mean two RoomIOs fighting over the
                    # `lk.chat` handler.
                    audio_output=False,
                    text_input=False,
                    # One human hanging up must not close the other's session.
                    close_on_disconnect=False,
                ),
            )
        except Exception:
            self._sessions.pop(participant.identity, None)
            self._roles.pop(participant.identity, None)
            logger.exception("failed to attach to %s", participant.identity)
            return

        self._publish(
            TRANSCRIPT_TOPIC,
            {
                "role": role,
                "name": name,
                "identity": participant.identity,
                "event": "joined",
                "ts": int(time.time() * 1000),
            },
        )

    async def detach(self, identity: str) -> None:
        session = self._sessions.pop(identity, None)
        role = self._roles.pop(identity, None)
        if session is None:
            return
        logger.info("detaching from %s (%s)", identity, role)
        try:
            await session.aclose()
        except Exception:
            logger.debug("error closing session for %s", identity, exc_info=True)

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
                f'The customer just said: "{latest}"\n\n'
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
        self._publish(
            SUGGESTION_TOPIC, {"id": suggestion_id, "state": "done", "text": full}
        )

    # -- lifecycle -----------------------------------------------------------

    # -- typed turns ---------------------------------------------------------

    def _register_chat_handler(self) -> None:
        """
        Read the room's chat topic so typing counts as a turn.

        Nothing re-publishes these: every client renders `lk.chat` itself, so the
        two humans see a typed line even with no worker in the room, and echoing it
        onto `assist.transcript` would show it twice. What the worker adds is the
        coaching — a typed question from the customer gets a note just like a
        spoken one.

        Registering this at all is only safe because the sessions run with
        `text_input=False`: RoomIO would otherwise claim the same topic, and the
        second claim loses with a warning.
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

                participant = self._ctx.room.remote_participants.get(participant_identity)
                if participant is None:
                    return
                role = _participant_role(participant)
                if role is None:
                    return

                logger.info("[%s typed] %s", role, text)
                await self._on_turn(role, text)

            asyncio.create_task(_read())

        try:
            self._ctx.room.register_text_stream_handler(CHAT_TOPIC, _on_chat)
        except ValueError:
            # Something else already owns the topic. Speech still works; typing
            # just will not reach the coach.
            logger.warning("chat topic %s already handled — typed turns ignored", CHAT_TOPIC)

    async def run(self) -> None:
        ctx = self._ctx

        # Handlers before `connect()`: someone joining during the handshake
        # would otherwise be missed entirely, and the sweep below only covers
        # who was already in the room when we arrived.
        @ctx.room.on("participant_connected")
        def _on_connected(p: rtc.RemoteParticipant) -> None:
            asyncio.create_task(self.attach(p))

        @ctx.room.on("participant_disconnected")
        def _on_disconnected(p: rtc.RemoteParticipant) -> None:
            asyncio.create_task(self.detach(p.identity))

        self._register_chat_handler()

        # Nothing connects the room for us here. A normal voice agent gets away
        # with letting `session.start()` do it, but this worker may sit in a room
        # with no attachable participant yet — the support agent opens the link
        # first and waits for the customer — and a job that never connects is
        # reaped as a job that did nothing.
        await ctx.connect()

        # Whoever created the room is already here: their join is what triggered
        # the dispatch that started this job.
        for participant in list(ctx.room.remote_participants.values()):
            await self.attach(participant)

        logger.info("listening in %s", ctx.room.name)

    async def aclose(self) -> None:
        if self._suggest_task and not self._suggest_task.done():
            self._suggest_task.cancel()
        for identity in list(self._sessions):
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
    call = AssistedCall(ctx)
    ctx.add_shutdown_callback(call.aclose)
    await call.run()


if __name__ == "__main__":
    cli.run_app(server)
