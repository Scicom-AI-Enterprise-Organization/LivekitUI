import { NextRequest, NextResponse } from "next/server";
import { getRoomServiceClient, getAgentDispatchClient } from "@/lib/livekit";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { stopAgent, deleteAgentFiles } from "@/lib/agent-runner";

export async function GET(request: NextRequest) {
  try {
    const roomClient = getRoomServiceClient();
    const dispatchClient = getAgentDispatchClient();
    const db = await ensureDb();

    // Time range from query param (default 24 hours)
    const hours = parseInt(request.nextUrl.searchParams.get("hours") || "24", 10);

    // Get all rooms to find active agent sessions
    const rooms = await roomClient.listRooms();

    const agentSessions: {
      agentName: string;
      roomName: string;
      roomSid: string;
      participantIdentity: string;
      participantSid: string;
      joinedAt: number;
    }[] = [];

    const agentWorkers = new Map<string, {
      agentName: string;
      concurrentSessions: number;
      rooms: string[];
      status: string;
    }>();

    // First, load all draft agents from DB
    const dbAgents = await db.getAllAgents();
    for (const a of dbAgents) {
      agentWorkers.set(a.name, {
        agentName: a.name,
        concurrentSessions: 0,
        rooms: [],
        status: a.status,
      });
    }

    // Then merge in live data from LiveKit server
    for (const room of rooms) {
      try {
        const dispatches = await dispatchClient.listDispatch(room.name);
        for (const dispatch of dispatches) {
          const name = dispatch.agentName || "agent (auto-dispatch)";
          if (!agentWorkers.has(name)) {
            agentWorkers.set(name, { agentName: name, concurrentSessions: 0, rooms: [], status: "connected" });
          }
        }
      } catch {}

      try {
        const participants = await roomClient.listParticipants(room.name);
        for (const p of participants) {
          if (p.kind === 2) {
            const name = p.name || p.identity || "agent (auto-dispatch)";
            agentSessions.push({
              agentName: name,
              roomName: room.name,
              roomSid: room.sid,
              participantIdentity: p.identity,
              participantSid: p.sid,
              joinedAt: Number(p.joinedAt),
            });

            if (!agentWorkers.has(name)) {
              agentWorkers.set(name, { agentName: name, concurrentSessions: 0, rooms: [], status: "connected" });
            }
            const worker = agentWorkers.get(name)!;
            worker.concurrentSessions++;
            worker.rooms.push(room.name);
            // Mark as connected if it has live sessions
            worker.status = "connected";
          }
        }
      } catch {}
    }

    const agents = Array.from(agentWorkers.values());
    const totalSessions = agentSessions.length;
    const totalAgents = agents.length;

    await db.addAgentSnapshot(totalSessions, totalAgents);

    const snapshots = await db.getAgentSnapshots(hours);
    const history = snapshots.map((s) => ({
      sessions: s.sessions,
      agents: s.agents,
      time: s.created_at,
    }));

    return NextResponse.json({
      agents,
      sessions: agentSessions,
      stats: { totalAgents, totalSessions },
      history,
    });
  } catch (error) {
    console.error("Failed to list agents:", error);
    return NextResponse.json(
      { error: "Failed to list agents", details: String(error) },
      { status: 500 }
    );
  }
}

// Create or upsert an agent
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { name, config, status } = await request.json();

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const db = await ensureDb();
  const existing = await db.findAgentByName(name);

  if (existing) {
    await db.updateAgent(existing.id, name, JSON.stringify(config || {}), status || existing.status);
    return NextResponse.json({ agent: { ...existing, name, config, status: status || existing.status } });
  }

  const created = await db.createAgent(name, JSON.stringify(config || {}), status || "draft");
  return NextResponse.json({
    agent: {
      id: created.id,
      name: created.name,
      config: JSON.parse(created.config),
      status: created.status,
      createdAt: created.created_at,
    },
  });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { name } = await request.json();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Stop running process and remove generated files
  stopAgent(name);
  deleteAgentFiles(name);

  const db = await ensureDb();
  const agent = await db.findAgentByName(name);
  if (agent) {
    await db.deleteAgent(agent.id);
  }

  return NextResponse.json({ success: true });
}
