import { NextRequest, NextResponse } from "next/server";
import { EncodedFileOutput, StreamOutput, StreamProtocol, EncodingOptionsPreset } from "@livekit/protocol";
import { getEgressClient } from "@/lib/livekit";
import { getSession } from "@/lib/auth";
import { livekitError } from "@/lib/livekit-errors";
import { serializeEgress } from "@/lib/api-serialize";

/**
 * GET /api/egresses — list egresses, newest first.
 * ?room=name   only egresses for that room
 * ?active=1    only ones still running
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roomName = request.nextUrl.searchParams.get("room") || undefined;
  const activeOnly = request.nextUrl.searchParams.get("active") === "1";

  try {
    const client = getEgressClient();
    const list = await client.listEgress(roomName ? { roomName, active: activeOnly } : { active: activeOnly });
    const egresses = list
      .map(serializeEgress)
      .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
    return NextResponse.json({ egresses, total: egresses.length });
  } catch (error) {
    return livekitError(error, "egress", "list egresses");
  }
}

/**
 * POST /api/egresses — start a room composite egress.
 *
 * Body: { room, type: "file" | "stream", filepath?, url?, layout?, preset? }
 * "file" writes an MP4 the LiveKit server can reach; "stream" pushes RTMP(S).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: {
    room?: string;
    type?: string;
    filepath?: string;
    url?: string;
    layout?: string;
    audioOnly?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { room, type = "file", filepath, url, layout, audioOnly } = body;
  if (!room) {
    return NextResponse.json({ error: "room is required" }, { status: 400 });
  }
  if (type !== "file" && type !== "stream") {
    return NextResponse.json({ error: 'type must be "file" or "stream"' }, { status: 400 });
  }
  if (type === "file" && !filepath) {
    return NextResponse.json({ error: "filepath is required for type=file" }, { status: 400 });
  }
  if (type === "stream" && !url) {
    return NextResponse.json({ error: "url is required for type=stream" }, { status: 400 });
  }

  try {
    const client = getEgressClient();
    const output =
      type === "file"
        ? { file: new EncodedFileOutput({ filepath }) }
        : { stream: new StreamOutput({ protocol: StreamProtocol.RTMP, urls: [url!] }) };

    const info = await client.startRoomCompositeEgress(room, output, {
      layout: layout || "grid",
      audioOnly: !!audioOnly,
      encodingOptions: EncodingOptionsPreset.H264_720P_30,
    });

    return NextResponse.json(serializeEgress(info));
  } catch (error) {
    return livekitError(error, "egress", "start egress");
  }
}
