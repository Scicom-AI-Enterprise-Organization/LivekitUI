import { NextRequest, NextResponse } from "next/server";
// js-yaml v5 is ESM with named exports only — there is no default export.
import { load as parseYaml } from "js-yaml";
import { getSession } from "@/lib/auth";
import { parseOpenApi } from "@/lib/openapi";

/** Refuse to buffer an unbounded document from a remote host. */
const MAX_SPEC_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/tools/openapi — parse an OpenAPI document into HTTP tool
 * definitions. Nothing is saved: the caller picks which operations to keep and
 * POSTs those to /api/tools.
 *
 * Body: { url } to fetch, or { spec } as raw JSON/YAML text.
 *
 * Fetching happens here rather than in the browser so that specs on hosts
 * without CORS headers still work.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { url?: string; spec?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { url, spec } = body;
  if (!url && !spec?.trim()) {
    return NextResponse.json({ error: "Provide either url or spec" }, { status: 400 });
  }

  let text: string;

  if (url) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: "url is not a valid URL" }, { status: 400 });
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: "url must be http or https" }, { status: 400 });
    }

    try {
      const res = await fetch(parsedUrl, {
        headers: { accept: "application/json, application/yaml, text/yaml, text/plain" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Could not fetch the spec (${res.status} from ${parsedUrl.host})` },
          { status: 502 }
        );
      }
      const length = Number(res.headers.get("content-length") || 0);
      if (length > MAX_SPEC_BYTES) {
        return NextResponse.json({ error: "That spec is larger than 5 MB" }, { status: 413 });
      }
      text = await res.text();
      if (text.length > MAX_SPEC_BYTES) {
        return NextResponse.json({ error: "That spec is larger than 5 MB" }, { status: 413 });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Could not fetch the spec: ${message}` },
        { status: 502 }
      );
    }
  } else {
    text = spec!;
    if (text.length > MAX_SPEC_BYTES) {
      return NextResponse.json({ error: "That spec is larger than 5 MB" }, { status: 413 });
    }
  }

  // JSON first, then YAML — a JSON document is also valid YAML, but the JSON
  // parser gives far better error messages.
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    try {
      document = parseYaml(text);
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return NextResponse.json(
        { error: `Could not parse the spec as JSON or YAML: ${message}` },
        { status: 400 }
      );
    }
  }

  try {
    const parsed = parseOpenApi(document);
    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read the spec" },
      { status: 400 }
    );
  }
}
