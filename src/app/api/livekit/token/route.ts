import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { spawn } from "child_process";
import path from "path";

export async function POST(req: NextRequest) {
  const {
    agentName,
    instructions,
    welcomeMessage,
    sttModel,
    llmModel,
    ttsModel,
    sttLanguage,
  } = await req.json();

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "LiveKit API key/secret not configured" },
      { status: 500 }
    );
  }

  const roomName = `agent-preview-${Date.now()}`;
  const participantName = `user-${Math.random().toString(36).slice(2, 8)}`;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
    name: participantName,
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    roomCreate: true,
  });

  const token = await at.toJwt();

  // Spawn the preview agent process
  const agentScript = path.join(process.cwd(), "agents", "preview_agent.py");
  const agentArgs = [
    agentScript,
    "--room", roomName,
    "--instructions", instructions || "You are a helpful voice assistant.",
    "--welcome", welcomeMessage || "Hey there, how can I help you today?",
    "--stt", sttModel || "deepgram/nova-3",
    "--llm", llmModel || "openai/gpt-4.1-mini",
    "--tts", ttsModel || "cartesia/sonic-3",
    "--language", sttLanguage || "en",
  ];

  const agent = spawn("python3.11", agentArgs, {
    env: {
      ...process.env,
      LIVEKIT_URL: process.env.LIVEKIT_URL || "http://localhost:7880",
      LIVEKIT_API_KEY: apiKey,
      LIVEKIT_API_SECRET: apiSecret,
    },
    stdio: "ignore",
    detached: true,
  });

  // Don't let the agent process block the Next.js server from exiting
  agent.unref();

  return NextResponse.json({
    token,
    room: roomName,
    serverUrl: process.env.LIVEKIT_URL || "ws://localhost:7880",
  });
}
