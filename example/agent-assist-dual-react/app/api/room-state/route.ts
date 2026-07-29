import { NextResponse } from 'next/server';
import { ParticipantInfo_Kind, TrackSource, TrackType } from '@livekit/protocol';
import { RoomServiceClient } from 'livekit-server-sdk';
import {
  AGENT_NAME_ATTRIBUTE,
  roleFromTrackName,
  type PublishedLeg,
  type Publisher,
  type RoomState,
} from '@/lib/types';
import { defaultRoomName, sandboxConfig, serverApiUrl } from '@/lib/server-config';

export const revalidate = 0;

/** Human-readable source, for a leg the track name did not label. */
const SOURCE_LABEL: Partial<Record<TrackSource, string>> = {
  [TrackSource.MICROPHONE]: 'microphone',
  [TrackSource.SCREEN_SHARE_AUDIO]: 'screen-share audio',
  [TrackSource.UNKNOWN]: 'unknown source',
};

/**
 * What is on air in the room, for the join screen and the monitor view.
 *
 * Once connected, a client learns this from room events instead — this route
 * exists so someone can see whether a call is being captured *before* joining,
 * and so a monitor's first paint is not empty.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const roomName = (url.searchParams.get('room') || '').trim() || defaultRoomName();

  const empty: RoomState = { publishers: [], workerPresent: false };

  const apiUrl = serverApiUrl();
  const { apiKey: key, apiSecret: secret } = sandboxConfig();
  if (!apiUrl || !key || !secret) {
    return NextResponse.json(empty, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const client = new RoomServiceClient(apiUrl, key, secret);
    const participants = await client.listParticipants(roomName);

    const publishers: Publisher[] = [];
    let workerPresent = false;

    for (const p of participants) {
      if (p.kind === ParticipantInfo_Kind.AGENT) {
        workerPresent = true;
        continue;
      }

      const legs: PublishedLeg[] = [];
      for (const track of p.tracks) {
        if (track.type !== TrackType.AUDIO) continue;
        legs.push({
          trackSid: track.sid,
          trackName: track.name || SOURCE_LABEL[track.source] || 'audio',
          source: SOURCE_LABEL[track.source] || String(track.source),
          role: roleFromTrackName(track.name),
          muted: track.muted,
        });
      }

      // Everyone in the room is reported, publishing or not: a monitor with no
      // tracks is exactly what a supervisor watching along looks like, and
      // hiding them would make the room read as empty during a call.
      publishers.push({
        identity: p.identity,
        name: p.attributes?.[AGENT_NAME_ATTRIBUTE] || p.name || p.identity,
        legs,
      });
    }

    return NextResponse.json({ publishers, workerPresent } satisfies RoomState, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    // A room nobody has joined yet does not exist, and listParticipants throws
    // for it. That is the normal first-visit case, not an error worth showing.
    return NextResponse.json(empty, { headers: { 'Cache-Control': 'no-store' } });
  }
}
