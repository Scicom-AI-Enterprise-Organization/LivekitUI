import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSimRun, listSimAgents } from "@/lib/assist-sim";
import { DEFAULT_TURNS, runVoiceSim } from "@/lib/voice-sim";

/**
 * Runs a simulated call against a voice-agent sandbox.
 *
 * A voice agent's timeline is the only one with the whole chain in it — speech
 * recognised, turn ended, model answered, voice synthesised — and it stays empty
 * until somebody talks to the agent. This is that somebody: one synthetic caller,
 * taking turns, publishing no metrics of its own so everything the timeline draws
 * came from the agent.
 *
 * The two-humans case is `/api/assist-sim`. Admin-only, like it: this spawns a
 * process and joins a room.
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
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter((t) => t.length > 0)
    : undefined;

  const num = (value: unknown, fallback: number, max: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
  };

  try {
    const result = await runVoiceSim({
      sandbox: typeof body.sandbox === "string" ? body.sandbox : undefined,
      room: typeof body.room === "string" ? body.room : undefined,
      agent: typeof body.agent === "string" ? body.agent : undefined,
      callerAgent: typeof body.callerAgent === "string" ? body.callerAgent : undefined,
      turns,
      gapMs: num(body.gapMs, 800, 10_000),
      replyTimeoutMs: num(body.replyTimeoutMs, 25_000, 120_000),
      drainMs: num(body.drainMs, 4000, 60_000),
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

/** A run's log, for one started with `wait: false`. Shared store with assist runs. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    // What a caller can choose from, so the UI does not have to guess which
    // agents exist or which of them can lend a voice.
    return NextResponse.json({ defaultTurns: DEFAULT_TURNS, agents: await listSimAgents() });
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
