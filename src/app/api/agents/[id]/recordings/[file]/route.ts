import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readRecording } from "@/lib/console-recordings";

/**
 * Parses a single-range `Range: bytes=…` header against a known length.
 *
 * Only one range is honoured; a multi-range request falls back to the whole
 * body, which is a legal response and is what media elements do anyway.
 * Returns `"unsatisfiable"` for a syntactically valid range that falls outside
 * the file, which must be answered with 416 rather than the whole body.
 */
function parseRange(
  header: string | null,
  total: number
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;

  if (rawStart === "") {
    // `bytes=-N` — the final N bytes.
    const suffix = parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === "" ? total - 1 : parseInt(rawEnd, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    end = Math.min(end, total - 1);
  }

  if (start < 0 || start >= total || end < start) return "unsatisfiable";
  return { start, end };
}

/**
 * Streams one saved console recording back to an <audio> element.
 *
 * Range requests are load-bearing, not an optimisation. Without
 * `Accept-Ranges` and a 206, the browser treats the resource as non-seekable:
 * it accepts `currentTime = x` and then plays from wherever it had buffered,
 * so every seek in the replay timeline snaps back to where it started.
 */
export async function GET(
  request: NextRequest,
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

  const total = found.data.byteLength;
  const headers: Record<string, string> = {
    "Content-Type": found.meta.mimeType || "audio/webm",
    // Advertised on every response, including the 200: it is what tells the
    // element the resource can be seeked at all.
    "Accept-Ranges": "bytes",
    // A recording never changes once written, so it is safe to cache — but it
    // must be revalidated rather than served blind. This endpoint previously
    // returned a non-seekable body under `max-age=3600`, and a client holding
    // that copy would keep failing to seek for an hour with no way to know
    // why. Revalidation is a 304 against the ETag, so the bytes are not
    // re-fetched.
    "Cache-Control": "private, no-cache",
    ETag: `"${found.meta.bytes}-${found.meta.durationMs}-${found.meta.startedAt}"`,
    "Content-Disposition": `inline; filename="${decodeURIComponent(file)}"`,
  };

  // A matching validator means the cached copy is current. Ranges are resolved
  // before this so a partial request is never answered with a bare 304.
  const ifNoneMatch = request.headers.get("if-none-match");
  if (!request.headers.get("range") && ifNoneMatch && ifNoneMatch === headers.ETag) {
    return new NextResponse(null, { status: 304, headers });
  }

  const range = parseRange(request.headers.get("range"), total);

  if (range === "unsatisfiable") {
    return new NextResponse(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${total}` },
    });
  }

  if (range) {
    const { start, end } = range;
    return new NextResponse(new Uint8Array(found.data.subarray(start, end + 1)), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new NextResponse(new Uint8Array(found.data), {
    headers: { ...headers, "Content-Length": String(total) },
  });
}
