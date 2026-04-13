import { NextResponse } from "next/server";
import { getRoomServiceClient } from "@/lib/livekit";

export async function GET() {
  try {
    const client = getRoomServiceClient();
    const rooms = await client.listRooms();

    const result = rooms.map((room) => ({
      sid: room.sid,
      name: room.name,
      numParticipants: room.numParticipants,
      numPublishers: room.numPublishers,
      maxParticipants: room.maxParticipants,
      creationTime: Number(room.creationTime),
      turnPassword: undefined,
      metadata: room.metadata,
      activeRecording: room.activeRecording,
    }));

    return NextResponse.json({ rooms: result });
  } catch (error) {
    console.error("Failed to list rooms:", error);
    return NextResponse.json(
      { error: "Failed to list rooms", details: String(error) },
      { status: 500 }
    );
  }
}
