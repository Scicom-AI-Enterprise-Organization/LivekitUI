import { NextResponse } from 'next/server';
import { defaultRoomName } from '@/lib/server-config';
import { ensureWorkerDispatched } from '../connection-details/route';

export const revalidate = 0;

/**
 * Retry dispatching the assist worker into a room that already exists.
 *
 * The case this exists for: the desk is on air, but the worker was still loading
 * its models when the room was created, so nothing is transcribing. Deploying or
 * restarting the worker does not fix that by itself — something has to ask for it
 * again, and only the server holds the API key.
 */
export async function POST(req: Request) {
  let body: { room?: string } = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is fine; fall back to this sandbox's default room.
  }

  const roomName = (body.room || '').trim() || defaultRoomName();
  const result = await ensureWorkerDispatched(roomName);

  return NextResponse.json(
    { roomName, ...result },
    { status: result.ok ? 200 : 502, headers: { 'Cache-Control': 'no-store' } }
  );
}
