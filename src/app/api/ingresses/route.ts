import { NextRequest, NextResponse } from "next/server";
import { IngressInput } from "@livekit/protocol";
import { getIngressClient } from "@/lib/livekit";
import { getSession } from "@/lib/auth";
import { livekitError } from "@/lib/livekit-errors";
import { serializeIngress } from "@/lib/api-serialize";

/** GET /api/ingresses — list ingresses. ?room=name filters by room. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roomName = request.nextUrl.searchParams.get("room") || undefined;

  try {
    const list = await getIngressClient().listIngress(roomName ? { roomName } : {});
    const ingresses = list.map(serializeIngress);
    return NextResponse.json({ ingresses, total: ingresses.length });
  } catch (error) {
    return livekitError(error, "ingress", "list ingresses");
  }
}

/**
 * POST /api/ingresses — create an ingress that publishes an external stream
 * into a room.
 *
 * Body: { name, room, inputType?: "rtmp" | "whip" | "url", participantIdentity?,
 *         participantName?, url?, reusable? }
 * `url` is required for inputType=url (it pulls that stream); RTMP and WHIP
 * return a streamKey to push to instead.
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
    name?: string;
    room?: string;
    inputType?: string;
    participantIdentity?: string;
    participantName?: string;
    url?: string;
    reusable?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { name, room, inputType = "rtmp", participantIdentity, participantName, url, reusable } = body;
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!room) {
    return NextResponse.json({ error: "room is required" }, { status: 400 });
  }

  const inputTypes: Record<string, IngressInput> = {
    rtmp: IngressInput.RTMP_INPUT,
    whip: IngressInput.WHIP_INPUT,
    url: IngressInput.URL_INPUT,
  };
  const input = inputTypes[inputType.toLowerCase()];
  if (input === undefined) {
    return NextResponse.json(
      { error: 'inputType must be "rtmp", "whip", or "url"' },
      { status: 400 }
    );
  }
  if (input === IngressInput.URL_INPUT && !url) {
    return NextResponse.json({ error: "url is required for inputType=url" }, { status: 400 });
  }

  try {
    const info = await getIngressClient().createIngress(input, {
      name,
      roomName: room,
      participantIdentity: participantIdentity || `ingress-${name}`,
      participantName: participantName || name,
      url: url || undefined,
      ...(reusable !== undefined ? { reusable } : {}),
    });
    return NextResponse.json(serializeIngress(info));
  } catch (error) {
    return livekitError(error, "ingress", "create ingress");
  }
}
