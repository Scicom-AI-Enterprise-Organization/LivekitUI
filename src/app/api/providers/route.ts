import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDb, type DbProvider } from "@/lib/db";
import {
  MODEL_KINDS,
  PROVIDER_PLUGINS,
  TTS_AUDIO_FORMATS,
  slugify,
  type ModelKind,
  type Provider,
  type ProviderModel,
  type ProviderVoice,
} from "@/lib/providers";

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function toApiProvider(row: DbProvider): Provider & { secretMissing: boolean } {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    plugin: row.plugin,
    baseUrl: row.base_url,
    apiKeySecret: row.api_key_secret,
    audioFormat: row.audio_format,
    models: parseJson<ProviderModel[]>(row.models, []),
    voices: parseJson<ProviderVoice[]>(row.voices, []),
    builtin: !!row.builtin,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    secretMissing: false,
  };
}

const VALID_KINDS = MODEL_KINDS.map((k) => k.id) as ModelKind[];

/** Normalizes and validates the models / voices arrays coming from the client. */
function sanitizeModels(input: unknown): { models: ProviderModel[]; error?: string } {
  if (!Array.isArray(input)) return { models: [] };
  const models: ProviderModel[] = [];
  for (const raw of input) {
    const m = raw as Partial<ProviderModel>;
    const id = typeof m.id === "string" ? m.id.trim() : "";
    if (!id) continue; // skip blank rows from the editor
    if (!VALID_KINDS.includes(m.kind as ModelKind)) {
      return { models: [], error: `Invalid model type for "${id}"` };
    }
    models.push({
      id,
      label: typeof m.label === "string" && m.label.trim() ? m.label.trim() : undefined,
      kind: m.kind as ModelKind,
    });
  }
  return { models };
}

function sanitizeVoices(input: unknown): ProviderVoice[] {
  if (!Array.isArray(input)) return [];
  const voices: ProviderVoice[] = [];
  for (const raw of input) {
    if (typeof raw === "string") {
      // Accept the shorthand "id" or "id:Display name".
      const [head, ...rest] = raw.split(":");
      const id = head.trim();
      const label = rest.join(":").trim();
      if (id) voices.push({ id, label: label || undefined });
      continue;
    }
    const v = raw as Partial<ProviderVoice>;
    const id = typeof v.id === "string" ? v.id.trim() : "";
    if (!id) continue;
    voices.push({ id, label: typeof v.label === "string" && v.label.trim() ? v.label.trim() : undefined });
  }
  return voices;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDb();
  const rows = await db.getAllProviders();
  const secrets = await db.getAllSecrets();
  const secretNames = new Set(secrets.map((s) => s.name));

  const providers = rows.map((row) => {
    const p = toApiProvider(row);
    // A referenced secret can also come from the process env (e.g. .env file).
    p.secretMissing = !!p.apiKeySecret && !secretNames.has(p.apiKeySecret) && !process.env[p.apiKeySecret];
    return p;
  });

  return NextResponse.json({ providers, plugins: PROVIDER_PLUGINS });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await request.json();
  const id: number | undefined = typeof body.id === "number" ? body.id : undefined;

  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const slug = slugify(body.slug || name);
  if (!slug) {
    return NextResponse.json({ error: "Slug must contain at least one letter or digit" }, { status: 400 });
  }

  const plugin = PROVIDER_PLUGINS.some((p) => p.id === body.plugin) ? body.plugin : "openai";

  const { models, error } = sanitizeModels(body.models);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const baseUrl = (body.baseUrl || "").trim() || null;
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return NextResponse.json({ error: "Base URL must start with http:// or https://" }, { status: 400 });
  }

  const input = {
    slug,
    name,
    plugin,
    // Trailing slashes break the OpenAI client's URL joining.
    baseUrl: baseUrl ? baseUrl.replace(/\/+$/, "") : null,
    apiKeySecret: (body.apiKeySecret || "").trim() || null,
    // Only accept a known container so it cannot inject into generated Python.
    audioFormat: TTS_AUDIO_FORMATS.includes(body.audioFormat) ? body.audioFormat : null,
    models: JSON.stringify(models),
    voices: JSON.stringify(sanitizeVoices(body.voices)),
    enabled: body.enabled !== false,
  };

  const db = await ensureDb();
  const clash = await db.findProviderBySlug(slug);

  if (id !== undefined) {
    const existing = await db.getProvider(id);
    if (!existing) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }
    if (clash && clash.id !== id) {
      return NextResponse.json({ error: `Slug "${slug}" is already used by another provider` }, { status: 409 });
    }
    await db.updateProvider(id, input);
    const updated = await db.getProvider(id);
    return NextResponse.json({ provider: updated ? toApiProvider(updated) : null });
  }

  if (clash) {
    return NextResponse.json({ error: `Slug "${slug}" is already used by "${clash.name}"` }, { status: 409 });
  }

  const created = await db.createProvider(input);
  return NextResponse.json({ provider: toApiProvider(created) });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await request.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  const db = await ensureDb();
  await db.deleteProvider(id);

  return NextResponse.json({ success: true });
}
