"""
Preview agent — spawned automatically by the dashboard when
the user clicks "Start Call" in the agent builder.

Usage:
    python3.11 preview_agent.py \
        --room <room_name> \
        --instructions "..." \
        --welcome "..." \
        --stt deepgram/nova-3 \
        --llm openai/gpt-4.1-mini \
        --tts cartesia/sonic-3

Connects to the LiveKit server defined by LIVEKIT_URL,
LIVEKIT_API_KEY, and LIVEKIT_API_SECRET env vars.
"""

import argparse
import asyncio
import logging
import os
import sys

from dotenv import load_dotenv

load_dotenv()

from livekit import api, rtc
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    cli,
    inference,
    room_io,
)
from livekit.plugins import silero

logger = logging.getLogger("preview-agent")


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--room", required=True)
    p.add_argument("--instructions", default="You are a helpful voice assistant.")
    p.add_argument("--welcome", default="Hey there, how can I help you today?")
    p.add_argument("--stt", default="deepgram/nova-3")
    p.add_argument("--llm", default="openai/gpt-4.1-mini")
    p.add_argument("--tts", default="cartesia/sonic-3")
    p.add_argument("--language", default="en")
    return p.parse_known_args()


async def main():
    args, _ = parse_args()

    lk_url = os.environ.get("LIVEKIT_URL", "http://localhost:7880")
    lk_key = os.environ.get("LIVEKIT_API_KEY", "")
    lk_secret = os.environ.get("LIVEKIT_API_SECRET", "")

    if not lk_key or not lk_secret:
        logger.error("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set")
        sys.exit(1)

    # Generate a token for the agent
    token = (
        api.AccessToken(lk_key, lk_secret)
        .with_identity("preview-agent")
        .with_name("Preview Agent")
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=args.room,
                can_publish=True,
                can_subscribe=True,
            )
        )
    )
    jwt = token.to_jwt()

    # Connect to the room
    room = rtc.Room()
    await room.connect(lk_url.replace("http://", "ws://").replace("https://", "wss://"), jwt)
    logger.info(f"Connected to room {args.room}")

    class PreviewAgent(Agent):
        def __init__(self):
            super().__init__(
                instructions=args.instructions,
            )

        async def on_enter(self):
            self.session.generate_reply(
                instructions=args.welcome
            )

    session = AgentSession(
        stt=inference.STT(args.stt, language=args.language),
        llm=inference.LLM(args.llm),
        tts=inference.TTS(args.tts),
        vad=silero.VAD.load(),
    )

    await session.start(
        agent=PreviewAgent(),
        room=room,
    )

    # Stay alive until the room is disconnected or user leaves
    disconnect_event = asyncio.Event()
    room.on("disconnected", lambda: disconnect_event.set())
    room.on(
        "participant_disconnected",
        lambda p: disconnect_event.set()
        if p.identity != "preview-agent"
        else None,
    )

    try:
        await asyncio.wait_for(disconnect_event.wait(), timeout=300)
    except asyncio.TimeoutError:
        logger.info("Preview session timed out (5 min)")
    finally:
        await room.disconnect()
        logger.info("Disconnected")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
