import { NextResponse } from "next/server";
import { getRoomServiceClient } from "@/lib/livekit";
import { ParticipantInfo_Kind } from "@livekit/protocol";

export async function GET() {
  try {
    const client = getRoomServiceClient();
    const rooms = await client.listRooms();

    let totalParticipants = 0;
    let totalAgents = 0;
    let totalDurationSec = 0;
    const countries = new Map<string, number>();
    const platforms = new Map<string, number>();
    const connectionTypes = new Map<string, number>();
    const now = Math.floor(Date.now() / 1000);

    for (const room of rooms) {
      totalParticipants += room.numParticipants || 0;
      const created = Number(room.creationTime);
      if (created > 0) totalDurationSec += Math.max(0, now - created);

      try {
        const participants = await client.listParticipants(room.name);
        for (const p of participants) {
          if (p.kind === ParticipantInfo_Kind.AGENT) totalAgents++;
          const attrs = p.attributes || {};
          const country = attrs["client.country"] || attrs["country"];
          if (country) countries.set(country, (countries.get(country) || 0) + 1);
          const platform = attrs["client.os"] || attrs["sdk"] || attrs["client.sdk"];
          if (platform) platforms.set(platform, (platforms.get(platform) || 0) + 1);
          const conn = attrs["client.protocol"] || attrs["protocol"];
          if (conn) connectionTypes.set(conn, (connectionTypes.get(conn) || 0) + 1);
        }
      } catch {}
    }

    const totalRooms = rooms.length;
    const averageRoomSize = totalRooms > 0 ? totalParticipants / totalRooms : 0;
    const averageRoomDurationMin = totalRooms > 0 ? totalDurationSec / totalRooms / 60 : 0;
    const participantMinutes = totalDurationSec > 0 ? (totalDurationSec / 60) * Math.max(1, averageRoomSize) : 0;

    const topCountries = Array.from(countries.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([country, count]) => ({ country, count }));

    return NextResponse.json({
      rooms: {
        total: totalRooms,
        averageSize: Number(averageRoomSize.toFixed(2)),
        averageDurationMin: Number(averageRoomDurationMin.toFixed(1)),
      },
      participants: {
        total: totalParticipants,
        minutes: Math.round(participantMinutes),
      },
      agents: {
        activeSessions: totalAgents,
      },
      topCountries,
      platforms: Array.from(platforms.entries()).map(([label, value]) => ({ label, value })),
      connectionTypes: Array.from(connectionTypes.entries()).map(([label, value]) => ({ label, value })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
