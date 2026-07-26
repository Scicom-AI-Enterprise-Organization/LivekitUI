import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readRecording } from "@/lib/console-recordings";

/** Streams one saved console recording back to an <audio> element. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, file } = await params;

  let found: Awaited<ReturnType<typeof readRecording>>;
  try {
    found = await readRecording(decodeURIComponent(id), decodeURIComponent(file));
  } catch (err) {
    // A storage backend that is misconfigured or unreachable is worth saying
    // out loud — the alternative is an <audio> element that silently fails.
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith("Invalid") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
  if (!found) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(found.data), {
    headers: {
      "Content-Type": found.meta.mimeType || "audio/webm",
      "Content-Length": String(found.data.byteLength),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${decodeURIComponent(file)}"`,
    },
  });
}
