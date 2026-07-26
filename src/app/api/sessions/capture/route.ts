import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  MAX_CAPTURE_MINUTES,
  MIN_CAPTURE_MINUTES,
  clampCaptureMinutes,
  loadCaptureSettings,
  saveCaptureSettings,
} from "@/lib/capture-settings";
import { listObservers } from "@/lib/session-observer";

/**
 * Server-side session capture: the switch, not the sessions.
 *
 * Off by default. With it on, the `room_started` webhook starts an observer for
 * every room — including inbound phone calls and sandbox apps — so the session
 * reaches Sessions → History without a browser tab hosting it.
 *
 * GET also reports the observers running right now, which is the only way to see
 * that capture is actually working rather than merely switched on.
 */

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await loadCaptureSettings();
  const configured = !!process.env.LIVEKIT_API_KEY && !!process.env.LIVEKIT_API_SECRET;

  return NextResponse.json({
    capture: {
      ...settings,
      /** False when the server has no API keys, in which case nothing can join. */
      configured,
      limits: { minMinutes: MIN_CAPTURE_MINUTES, maxMinutes: MAX_CAPTURE_MINUTES },
      observing: listObservers().map((o) => ({
        room: o.room,
        startedAt: new Date(o.startedAt).toISOString(),
      })),
    },
  });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });
  }

  const current = await loadCaptureSettings();
  // Each field is optional, so the switch can be flipped without the form having
  // to resend the rest of the settings.
  const settings = await saveCaptureSettings({
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
    audio: typeof body.audio === "boolean" ? body.audio : current.audio,
    maxMinutes:
      body.maxMinutes === undefined ? current.maxMinutes : clampCaptureMinutes(body.maxMinutes),
  });

  // Observers already running keep going: they are recording live calls, and the
  // switch is about what happens to the next room, not this one.
  return NextResponse.json({ capture: settings });
}
