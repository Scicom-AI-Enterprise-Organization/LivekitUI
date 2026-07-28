"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { listModels, type Provider } from "@/lib/providers";
import {
  NOISE_CANCELLATION_OPTIONS,
  SUGGEST_FOR_OPTIONS,
  TURN_DETECTOR_OPTIONS,
  assistConfigFromAgent,
  type AssistWorkerConfig,
} from "@/lib/agent-assist-config";

/** Sentinel: a Select item may not carry an empty value. */
const NO_SOURCE = "__manual__";

/**
 * The assist worker's configuration form, shared by the create dialog and the
 * edit dialog so the two cannot drift. Every field maps to one environment
 * variable the worker reads — see `example/agent-assist-python/.env.example`.
 *
 * `agents` enables the copy-from-agent shortcut. A builder agent has already made
 * every one of these decisions except the coaching prompt, so retyping them here
 * is the thing worth avoiding.
 */
export function AssistSettings({
  config,
  providers,
  agents = [],
  onChange,
}: {
  config: AssistWorkerConfig;
  providers: Provider[];
  agents?: { agentName: string }[];
  onChange: (next: AssistWorkerConfig) => void;
}) {
  const [copying, setCopying] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [copyError, setCopyError] = useState("");

  const set = <K extends keyof AssistWorkerConfig>(key: K, value: AssistWorkerConfig[K]) =>
    onChange({ ...config, [key]: value });

  const sttModels = listModels(providers, "stt");
  const llmModels = listModels(providers, "llm");

  const turnHint = TURN_DETECTOR_OPTIONS.find((o) => o.id === config.turnDetector)?.hint;
  const ncHint = NOISE_CANCELLATION_OPTIONS.find((o) => o.id === config.noiseCancellation)?.hint;

  const chooseSource = async (name: string) => {
    setNotes([]);
    setCopyError("");

    if (name === NO_SOURCE) {
      onChange({ ...config, sourceAgent: "" });
      return;
    }

    setCopying(true);
    try {
      const res = await fetch(`/api/agents/by-name?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!res.ok) {
        setCopyError(data.error || `Could not read ${name}`);
        return;
      }
      // Resolve now purely so the form can *show* what will run. The worker
      // resolves it again server-side on every deploy, so this is a preview, not
      // the stored answer — editing the agent changes the worker without anyone
      // reopening this dialog.
      const { config: resolved, notes: whatChanged } = assistConfigFromAgent(
        { ...(data.agent?.config ?? {}), name },
        config
      );
      onChange({ ...resolved, sourceAgent: name });
      setNotes(whatChanged);
    } catch {
      setCopyError(`Could not read ${name}`);
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="space-y-5">
      {agents.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
          <Label className="text-xs">Use an agent&apos;s models</Label>
          <div className="flex items-center gap-2">
            <Select value={config.sourceAgent || NO_SOURCE} onValueChange={chooseSource} disabled={copying}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SOURCE}>Set them here instead</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.agentName} value={a.agentName}>
                    {a.agentName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {copying && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
          </div>
          <p className="text-xs text-muted-foreground">
            {config.sourceAgent ? (
              <>
                <span className="text-foreground">{config.sourceAgent}</span> is the source of truth.
                Its models are re-read every time this worker deploys, so edit them in the builder —
                not here. Deploying that agent redeploys this worker with them.
              </>
            ) : (
              <>
                Point this worker at an agent and it stops having its own copy of these settings.
                Either way the worker runs as its own process: a voice agent binds to whoever joins
                first and replies out loud, so it cannot do this job itself.
              </>
            )}
          </p>
          {copyError && <p className="text-xs text-destructive">{copyError}</p>}
          {notes.map((n) => (
            <p key={n} className="text-xs text-amber-500">
              {n}
            </p>
          ))}
        </div>
      )}
      {config.sourceAgent ? (
        <InheritedSummary config={config} />
      ) : (
        <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Transcription model</Label>
          <ModelSelect
            value={config.sttModel}
            options={sttModels}
            onChange={(v) => set("sttModel", v)}
          />
          <p className="text-xs text-muted-foreground">
            Runs once per person, so a call costs two streams.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Coaching model</Label>
          <ModelSelect
            value={config.llmModel}
            options={llmModels}
            onChange={(v) => set("llmModel", v)}
          />
          <p className="text-xs text-muted-foreground">
            Writes the notes the support agent reads. Never speaks.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Noise cancellation</Label>
          <Select
            value={config.noiseCancellation}
            onValueChange={(v) => set("noiseCancellation", v as AssistWorkerConfig["noiseCancellation"])}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOISE_CANCELLATION_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{ncHint}</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Turn detector</Label>
          <Select
            value={config.turnDetector}
            onValueChange={(v) => set("turnDetector", v as AssistWorkerConfig["turnDetector"])}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TURN_DETECTOR_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{turnHint}</p>
        </div>
      </div>

      {config.turnDetector === "scicom" && (
        <div className="space-y-1.5">
          <Label className="text-xs">End-of-turn endpoint</Label>
          <Input
            value={config.eotUrl}
            onChange={(e) => set("eotUrl", e.target.value)}
            placeholder="http://localhost:8000"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Language</Label>
        <Input
          value={config.language}
          onChange={(e) => set("language", e.target.value)}
          placeholder="auto-detect"
        />
        <p className="text-xs text-muted-foreground">
          An ISO code (<code>en</code>, <code>ms</code>) if the provider needs telling.
        </p>
      </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Suggest</Label>
        <Select
          value={config.suggestFor}
          onValueChange={(v) => set("suggestFor", v as AssistWorkerConfig["suggestFor"])}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUGGEST_FOR_OPTIONS.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Spoken or typed — a typed question gets a note the same way.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Coaching prompt</Label>
        <textarea
          value={config.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          rows={5}
          placeholder="Leave blank to use the worker's built-in prompt."
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        />
      </div>
    </div>
  );
}

/**
 * What the referenced agent currently resolves to, read-only.
 *
 * Read-only on purpose: an editable field here would be a copy, and a copy is
 * what the reference exists to avoid. The worker re-reads the agent on every
 * deploy, so these values are a preview of that, not the stored answer.
 */
function InheritedSummary({ config }: { config: AssistWorkerConfig }) {
  const rows: [string, string][] = [
    ["Transcription", config.sttModel],
    ["Coaching model", config.llmModel],
    ["Noise cancellation", NOISE_CANCELLATION_OPTIONS.find((o) => o.id === config.noiseCancellation)?.label || config.noiseCancellation],
    ["Turn detector", TURN_DETECTOR_OPTIONS.find((o) => o.id === config.turnDetector)?.label || config.turnDetector],
    ["Language", config.language || "auto-detect"],
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b last:border-0">
              <td className="w-40 px-3 py-2 align-top text-xs text-muted-foreground">{label}</td>
              <td className="px-3 py-2 font-mono text-xs break-all text-foreground">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { ref: string; label: string }[];
  onChange: (v: string) => void;
}) {
  // A saved sandbox may point at a model whose provider was since edited away.
  // Keeping the stored ref in the list means opening the dialog does not silently
  // rewrite the worker's model to whatever happens to be first.
  const known = options.some((o) => o.ref === value);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!known && value && <SelectItem value={value}>{value} (unknown provider)</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.ref} value={o.ref}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
