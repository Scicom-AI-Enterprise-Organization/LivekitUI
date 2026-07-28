import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { DEFAULT_TURNS, getSimRun, runSim, type SimTurn } from "@/lib/assist-sim";

/**
 * Runs a simulated two-speaker call, for testing an agent-assist room.
 *
 * The template needs two humans in two browsers, so nothing else here can be
 * exercised end to end without them — and the per-speaker metrics timeline the
 * worker feeds cannot be checked at all. POST joins the room twice, speaks a
 * scripted conversation through the project's TTS, and (with `wait`) returns
 * what came back: the transcript, the coaching notes, and a count of metrics per
 * speaker, which is exactly what the timeline draws lanes from.
 *
 * Admin-only: it spawns a process and joins a room as two participants.
 */

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const turns = Array.isArray(body.turns)
    ? (body.turns as unknown[])
        .map((t) => {
          const turn = (t ?? {}) as Record<string, unknown>;
          const role = turn.role === "agent" ? "agent" : "customer";
          const text = typeof turn.text === "string" ? turn.text.trim() : "";
          return { role, text } as SimTurn;
        })
        .filter((t) => t.text)
    : undefined;

  const num = (value: unknown, fallback: number, max: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
  };

  try {
    const result = await runSim({
      sandbox: typeof body.sandbox === "string" ? body.sandbox : undefined,
      room: typeof body.room === "string" ? body.room : undefined,
      agent: typeof body.agent === "string" ? body.agent : undefined,
      turns,
      gapMs: num(body.gapMs, 1500, 10_000),
      warmupMs: num(body.warmupMs, 6000, 60_000),
      drainMs: num(body.drainMs, 8000, 60_000),
      // Waiting is the default: a run whose result you have to poll for is a
      // worse test than one curl that answers.
      wait: body.wait !== false,
      timeoutMs: num(body.timeoutMs, 240_000, 600_000),
    });
    return NextResponse.json({ run: result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** A run's log, for one started with `wait: false`. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ defaultTurns: DEFAULT_TURNS });
  }
  if (!/^sim-[a-z0-9]+$/.test(id)) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const run = getSimRun(id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}
