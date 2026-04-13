import { NextRequest, NextResponse } from "next/server";
import { getRoomServiceClient, getAgentDispatchClient } from "@/lib/livekit";
import { ensureDb } from "@/lib/db";

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
    }>();

    for (const room of rooms) {
      try {
        const dispatches = await dispatchClient.listDispatch(room.name);
        for (const dispatch of dispatches) {
          const name = dispatch.agentName || "agent (auto-dispatch)";
          if (!agentWorkers.has(name)) {
            agentWorkers.set(name, { agentName: name, concurrentSessions: 0, rooms: [] });
          }
        }
      } catch {
        // dispatch listing may not be available for all rooms
      }

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
              agentWorkers.set(name, { agentName: name, concurrentSessions: 0, rooms: [] });
            }
            const worker = agentWorkers.get(name)!;
            worker.concurrentSessions++;
            worker.rooms.push(room.name);
          }
        }
      } catch {
        // room may have closed
      }
    }

    const agents = Array.from(agentWorkers.values());
    const totalSessions = agentSessions.length;
    const totalAgents = agents.length;

    // Save a snapshot
    await db.addAgentSnapshot(totalSessions, totalAgents);

    // Get history for the chart
    const snapshots = await db.getAgentSnapshots(hours);
    const history = snapshots.map((s) => ({
      sessions: s.sessions,
      agents: s.agents,
      time: s.created_at,
    }));

    return NextResponse.json({
      agents,
      sessions: agentSessions,
      stats: {
        totalAgents,
        totalSessions,
      },
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
