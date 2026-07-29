"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MIC_ROLE_OPTIONS, type DualMicRole } from "@/lib/agent-assist-dual-config";

/**
 * The dual-track worker's one setting that has no equivalent on the
 * per-participant one: which role an *unnamed* `Microphone` track belongs to.
 *
 * Shared by the create page and the list page's edit dialog for the same reason
 * `AssistSettings` is — two copies of a control this fiddly would drift, and the
 * wording is most of its value.
 */
export function MicRoleField({
  value,
  onChange,
}: {
  value: DualMicRole;
  onChange: (next: DualMicRole) => void;
}) {
  const hint = MIC_ROLE_OPTIONS.find((o) => o.id === value)?.hint;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Unnamed microphone track is</Label>
      <Select value={value} onValueChange={(v) => onChange(v as DualMicRole)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MIC_ROLE_OPTIONS.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <p className="text-xs text-muted-foreground">
        Only ever read as a <strong>fallback</strong>. The worker resolves a leg from the track&apos;s
        name first — <code>agent_audio</code> or <code>customer_audio</code>, which is what this
        sandbox publishes — so this matters only for an outside publisher that leaves its tracks
        unnamed. Set it wrong and the transcript is correct in every respect except who said what.
      </p>
    </div>
  );
}
