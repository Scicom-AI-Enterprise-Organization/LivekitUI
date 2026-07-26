import { NextRequest, NextResponse } from "next/server";
import { ParticipantInfo_Kind } from "@livekit/protocol";
import { getRoomServiceClient } from "@/lib/livekit";
import { getSession } from "@/lib/auth";
import { livekitError } from "@/lib/livekit-errors";

/**
 * GET /api/calls — active telephony calls.
 *
 * LiveKit has no "list calls" API: a call *is* a SIP participant in a room, so
 * we walk the rooms and pick those out. LiveKit stamps details onto the
 * participant's attributes (sip.callID, sip.phoneNumber, …), which is where the
 * caller and trunk numbers come from.
 *
 * ?room=name narrows to one room.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roomFilter = request.nextUrl.searchParams.get("room");

  try {
    const client = getRoomServiceClient();
    const rooms = (await client.listRooms()).filter((r) => !roomFilter || r.name === roomFilter);
    const now = Date.now();

    const calls = (
      await Promise.all(
        rooms.map(async (room) => {
          let participants;
          try {
            participants = await client.listParticipants(room.name);
          } catch {
            return [];
          }
          return participants
            .filter((p) => p.kind === ParticipantInfo_Kind.SIP)
            .map((p) => {
              const attrs = p.attributes || {};
              const joinedAtMs = Number(p.joinedAt) * 1000;
              return {
                callId: attrs["sip.callID"] || p.sid,
                roomName: room.name,
                roomSid: room.sid,
                participantIdentity: p.identity,
                participantName: p.name || null,
                // Present for inbound calls; outbound ones carry the dialled number.
                from: attrs["sip.phoneNumber"] || null,
                to: attrs["sip.trunkPhoneNumber"] || null,
                direction: attrs["sip.callDirection"] || null,
                status: attrs["sip.callStatus"] || "active",
                trunkId: attrs["sip.trunkID"] || null,
                startedAt: joinedAtMs ? new Date(joinedAtMs).toISOString() : null,
                durationSeconds: joinedAtMs ? Math.round((now - joinedAtMs) / 1000) : null,
              };
            });
        })
      )
    ).flat();

    calls.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
    return NextResponse.json({ calls, total: calls.length });
  } catch (error) {
    return livekitError(error, "SIP", "list calls");
  }
}
