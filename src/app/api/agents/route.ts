import { NextRequest, NextResponse } from "next/server";
import { getRoomServiceClient, getAgentDispatchClient } from "@/lib/livekit";
import { ParticipantInfo_Kind } from "@livekit/protocol";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { stopAgent, deleteAgentFiles, isAgentRunning, getAgentPid, getAgentWorkerId } from "@/lib/agent-runner";

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
      running: boolean;
      participantIdentities: string[];
      region: string;
      pid: number | null;
      workerId: string | null;
    }>();

    const defaultRegion = process.env.LIVEKIT_REGION || "local";

    // Case-insensitive alias resolver: LiveKit dispatches/participants often
    // lowercase the agent_name, but the DB keeps the original casing. Map
    // lowercase -> canonical name so we merge both into one worker entry.
    const canonicalByLower = new Map<string, string>();
    const resolveName = (raw: string): string => {
      const key = raw.toLowerCase();
      return canonicalByLower.get(key) || raw;
    };

    // First, load all agents from DB; check the actual process state for each one
    const dbAgents = await db.getAllAgents();
    for (const a of dbAgents) {
      const running = isAgentRunning(a.name);
      const realStatus = a.status === "draft" ? "draft" : running ? "connected" : "offline";
      agentWorkers.set(a.name, {
        agentName: a.name,
        concurrentSessions: 0,
        rooms: [],
        status: realStatus,
        running,
        participantIdentities: [],
        region: defaultRegion,
        pid: getAgentPid(a.name),
        workerId: getAgentWorkerId(a.name),
      });
      canonicalByLower.set(a.name.toLowerCase(), a.name);
    }

    // Then merge in live data from LiveKit server
    for (const room of rooms) {
      // Build a queue of dispatched agent names for this room so we can map
      // auto-generated participant identities (e.g. "agent-AJ_t8j...") back
      // to the human-readable agent_name (e.g. "husein") supplied in code.
      const dispatchedNames: string[] = [];
      try {
        const dispatches = await dispatchClient.listDispatch(room.name);
        for (const dispatch of dispatches) {
          const name = resolveName(dispatch.agentName || "agent (auto-dispatch)");
          dispatchedNames.push(name);
          if (!agentWorkers.has(name)) {
            const running = isAgentRunning(name);
            const status = running ? "connected" : "offline";
            agentWorkers.set(name, { agentName: name, concurrentSessions: 0, rooms: [], status, running, participantIdentities: [], region: defaultRegion, pid: getAgentPid(name), workerId: getAgentWorkerId(name) });
          }
        }
      } catch {}

      try {
        const participants = await roomClient.listParticipants(room.name);
        let dispatchCursor = 0;
        for (const p of participants) {
          if (p.kind === ParticipantInfo_Kind.AGENT) {
            // Prefer participant.name if explicitly set; else draw from the
            // room's dispatch list in order; else fall back to identity.
            let name: string;
            if (p.name && !p.name.startsWith("agent-")) {
              name = resolveName(p.name);
            } else if (dispatchCursor < dispatchedNames.length) {
              name = dispatchedNames[dispatchCursor++];
            } else {
              name = resolveName(p.name || p.identity || "agent (auto-dispatch)");
            }
            agentSessions.push({
              agentName: name,
              roomName: room.name,
              roomSid: room.sid,
              participantIdentity: p.identity,
              participantSid: p.sid,
              joinedAt: Number(p.joinedAt),
            });

            if (!agentWorkers.has(name)) {
              agentWorkers.set(name, { agentName: name, concurrentSessions: 0, rooms: [], status: "connected", running: true, participantIdentities: [], region: defaultRegion, pid: getAgentPid(name), workerId: getAgentWorkerId(name) });
            }
            const worker = agentWorkers.get(name)!;
            worker.concurrentSessions++;
            worker.rooms.push(room.name);
            worker.participantIdentities.push(p.identity);
            const r = (room as unknown as { region?: string }).region;
            if (r) worker.region = r;
            // Live session in a room implies the agent is running
            worker.status = "connected";
            worker.running = true;
          }
        }
      } catch {}
    }

    const agents = Array.from(agentWorkers.values());
    const totalSessions = agentSessions.length;
    const totalAgents = agents.length;

    await db.addAgentSnapshot(totalSessions, totalAgents);

    // Per-agent snapshots so we can chart sessions for one specific agent
    for (const a of agents) {
      try {
        await db.addAgentPerSnapshot(a.agentName, a.concurrentSessions, a.running);
      } catch {}
    }

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

  // Remove any lingering LiveKit dispatches so the agent stops reappearing
  // in the list (the /api/agents GET merges dispatch-derived entries with
  // DB ones). Match case-insensitively since dispatches are often lowercased.
  try {
    const roomClient = getRoomServiceClient();
    const dispatchClient = getAgentDispatchClient();
    const rooms = await roomClient.listRooms();
    const needle = name.toLowerCase();
    for (const room of rooms) {
      try {
        const dispatches = await dispatchClient.listDispatch(room.name);
        for (const d of dispatches) {
          if ((d.agentName || "").toLowerCase() === needle) {
            try { await dispatchClient.deleteDispatch(d.id, room.name); } catch {}
          }
        }
      } catch {}
    }
  } catch {}

  const db = await ensureDb();
  const agent = await db.findAgentByName(name);
  if (agent) {
    await db.deleteAgentVersions(name);
    await db.deleteAgent(agent.id);
  }

  return NextResponse.json({ success: true });
}
