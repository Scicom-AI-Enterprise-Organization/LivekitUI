import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { PLUGIN_KEY_ENV_VARS, effectiveBaseUrl } from "@/lib/providers";

/**
 * Probes a provider's endpoint so the UI can confirm it is reachable and the
 * credential works before the provider is saved. Each plugin authenticates
 * differently, so every one gets its own read-only listing request; where that
 * request happens to be a model list, the ids come back for the model picker.
 */
interface Probe {
  path: string;
  /** Credential headers — only sent when a key was resolved. */
  authHeaders: (key: string) => Record<string, string>;
  /** Sent on every request, e.g. API version pins. */
  extraHeaders?: Record<string, string>;
  /** Appends the key as a query param instead of a header (Google). */
  keyQueryParam?: string;
  parseModels?: (body: unknown) => string[];
}

const asRecords = (body: unknown, field: string): Record<string, unknown>[] => {
  const list = (body as Record<string, unknown> | null)?.[field];
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
};

const openAiModels = (body: unknown): string[] =>
  asRecords(body, "data")
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

const PROBES: Record<string, Probe> = {
  openai: {
    path: "/models",
    authHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
    parseModels: openAiModels,
  },
  groq: {
    path: "/models",
    authHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
    parseModels: openAiModels,
  },
  anthropic: {
    path: "/models",
    authHeaders: (key) => ({ "x-api-key": key }),
    extraHeaders: { "anthropic-version": "2023-06-01" },
    parseModels: openAiModels,
  },
  google: {
    path: "/models",
    authHeaders: () => ({}),
    keyQueryParam: "key",
    parseModels: (body) =>
      asRecords(body, "models")
        .map((m) => (typeof m.name === "string" ? m.name.replace(/^models\//, "") : undefined))
        .filter((id): id is string => !!id),
  },
  deepgram: {
    path: "/projects",
    authHeaders: (key) => ({ Authorization: `Token ${key}` }),
  },
  cartesia: {
    path: "/voices",
    authHeaders: (key) => ({ "X-API-Key": key }),
    extraHeaders: { "Cartesia-Version": "2024-06-10" },
  },
  elevenlabs: {
    path: "/models",
    authHeaders: (key) => ({ "xi-api-key": key }),
    parseModels: (body) => {
      const list = Array.isArray(body) ? (body as Record<string, unknown>[]) : asRecords(body, "models");
      return list
        .map((m) => m.model_id ?? m.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    },
  },
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { plugin, baseUrl, apiKeySecret } = await request.json();

  const explicit = (baseUrl || "").trim();
  if (explicit && !/^https?:\/\//i.test(explicit)) {
    return NextResponse.json({ ok: false, error: "Base URL must start with http:// or https://" });
  }

  const base = effectiveBaseUrl(plugin, explicit);
  if (!base) {
    return NextResponse.json({
      ok: false,
      error: `No endpoint to test — set a base URL for the "${plugin}" plugin.`,
    });
  }

  const probe = PROBES[plugin];
  if (!probe) {
    // Unknown plugin: nothing to probe, but do not block saving on that.
    return NextResponse.json({
      ok: true,
      endpoint: base,
      keySource: "none",
      warning: `No connection check is available for the "${plugin}" plugin — its settings were not verified.`,
      models: [],
    });
  }

  // Resolve the credential: selected secret > plugin's conventional env var.
  const db = await ensureDb();
  let key = "";
  let keySource = "none";
  if (apiKeySecret) {
    const secret = await db.findSecret(apiKeySecret);
    if (secret?.value) {
      key = secret.value;
      keySource = `secret ${apiKeySecret}`;
    } else if (process.env[apiKeySecret]) {
      key = process.env[apiKeySecret] as string;
      keySource = `environment ${apiKeySecret}`;
    } else {
      return NextResponse.json({
        ok: false,
        endpoint: base,
        error: `No secret or environment variable named ${apiKeySecret} was found. Add it under Settings > Secrets.`,
      });
    }
  } else {
    for (const name of PLUGIN_KEY_ENV_VARS[plugin] || []) {
      if (process.env[name]) {
        key = process.env[name] as string;
        keySource = `environment ${name}`;
        break;
      }
    }
  }

  // A hosted endpoint always needs a credential, so say so plainly instead of
  // relaying whatever error the vendor returns for an anonymous request. A
  // custom base URL is left to the endpoint — local servers often need no key.
  if (!key && !explicit) {
    const envNames = PLUGIN_KEY_ENV_VARS[plugin] || [];
    return NextResponse.json({
      ok: false,
      endpoint: base,
      error: `No API key found for ${base}. Select an API key secret${
        envNames.length ? `, or set ${envNames.join(" or ")} in the environment` : ""
      }.`,
    });
  }

  const url = new URL(`${base}${probe.path}`);
  if (key && probe.keyQueryParam) url.searchParams.set(probe.keyQueryParam, key);
  const headers: Record<string, string> = {
    ...(probe.extraHeaders || {}),
    ...(key && !probe.keyQueryParam ? probe.authHeaders(key) : {}),
  };

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000), cache: "no-store" });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({
        ok: false,
        endpoint: base,
        error: key
          ? `The endpoint rejected the credential from ${keySource} (HTTP ${res.status}).`
          : `The endpoint requires authentication (HTTP ${res.status}). Select an API key secret.`,
      });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({
        ok: false,
        endpoint: base,
        error: `Endpoint returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      });
    }

    const body = await res.json().catch(() => null);
    const models = probe.parseModels && body ? probe.parseModels(body) : [];

    return NextResponse.json({
      ok: true,
      endpoint: base,
      keySource,
      models,
      warning: models.length === 0 && probe.parseModels
        ? "Connected, but the endpoint listed no models — add them by hand."
        : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: false,
      endpoint: base,
      error: `Could not reach ${url.origin}${url.pathname} — ${message}`,
    });
  }
}
