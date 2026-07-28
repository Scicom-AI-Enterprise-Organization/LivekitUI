import { NextResponse } from 'next/server';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { RoomServiceClient } from 'livekit-server-sdk';
import { isRole, NAME_ATTRIBUTE, ROLE_ATTRIBUTE, type RoomState, type Seat } from '@/lib/types';
import { defaultRoomName, sandboxConfig, serverApiUrl } from '@/lib/server-config';

export const revalidate = 0;

/**
 * Who is in the room, for the join screen. Once a participant is connected the
 * client learns this from room events instead — this route exists only so the
 * form can show a seat as taken *before* anyone joins.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const roomName = (url.searchParams.get('room') || '').trim() || defaultRoomName();

  const empty: RoomState = { seats: [], workerPresent: false };

  const apiUrl = serverApiUrl();
  const { apiKey: key, apiSecret: secret } = sandboxConfig();
  if (!apiUrl || !key || !secret) {
    return NextResponse.json(empty, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const client = new RoomServiceClient(apiUrl, key, secret);
    const participants = await client.listParticipants(roomName);

    const seats: Seat[] = [];
    let workerPresent = false;

    for (const p of participants) {
      if (p.kind === ParticipantInfo_Kind.AGENT) {
        workerPresent = true;
        continue;
      }
      const role = p.attributes?.[ROLE_ATTRIBUTE];
      if (!isRole(role)) continue;
      seats.push({
        role,
        name: p.attributes?.[NAME_ATTRIBUTE] || p.name || p.identity,
        identity: p.identity,
      });
    }

    return NextResponse.json(
      { seats, workerPresent } satisfies RoomState,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    // A room nobody has joined yet does not exist, and listParticipants throws
    // for it. That is the normal first-visit case, not an error worth showing.
    return NextResponse.json(empty, { headers: { 'Cache-Control': 'no-store' } });
  }
}
