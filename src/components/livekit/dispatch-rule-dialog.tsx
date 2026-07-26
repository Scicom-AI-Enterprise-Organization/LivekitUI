"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Phone, Search, Server } from "lucide-react";

interface InboundTrunk {
  trunkId: string;
  name: string;
  numbers: string[];
}

export interface DispatchRule {
  ruleId: string;
  name: string;
  trunkIds: string[];
  type: string | null;
  roomName: string | null;
  roomPrefix: string | null;
  agents: string[];
}

/**
 * Create or replace a SIP dispatch rule.
 *
 * Editing replaces rather than patches: LiveKit's update API has no field for
 * `roomConfig`, so the agent assignment — the thing most worth changing — can
 * only be set at creation. Saving therefore replaces the rule and its ID changes.
 *
 * The old rule must go *first*: LiveKit rejects a second rule covering the same
 * trunk, number and PIN, so creating before deleting fails on every edit that
 * keeps the same scope. If the create then fails, the original is put back so
 * the number is never left unrouted.
 */
export function DispatchRuleDialog({
  rule,
  onClose,
  onSaved,
}: {
  /** null = create a new rule. */
  rule: DispatchRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!rule;
  const [ruleName, setRuleName] = useState(rule?.name ?? "");
  const [ruleType, setRuleType] = useState<"individual" | "direct">(
    rule?.type === "dispatchRuleDirect" ? "direct" : "individual"
  );
  const [roomPrefix, setRoomPrefix] = useState(rule?.roomPrefix || "call-");
  const [roomName, setRoomName] = useState(rule?.roomName || "");
  const [agentName, setAgentName] = useState(rule?.agents?.[0] ?? "");
  const [selectedTrunks, setSelectedTrunks] = useState<Set<string>>(new Set(rule?.trunkIds ?? []));

  const [inboundTab, setInboundTab] = useState<"phones" | "trunks">("phones");
  const [search, setSearch] = useState("");
  const [trunks, setTrunks] = useState<InboundTrunk[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      Promise.all([
        fetch("/api/sip-trunks?direction=inbound")
          .then((r) => r.json())
          .then((d) => setTrunks(d.trunks ?? []))
          .catch(() => {}),
        fetch("/api/agents")
          .then((r) => r.json())
          .then((d) =>
            setAgents(
              (d.agents ?? [])
                .map((a: { agentName: string }) => a.agentName)
                .filter((n: string) => n && !n.startsWith("agent ("))
            )
          )
          .catch(() => {}),
      ]).finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const toggleTrunk = (id: string) =>
    setSelectedTrunks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const numberRows = trunks.flatMap((t) => t.numbers.map((n) => ({ number: n, trunk: t })));
  const filteredTrunks = trunks.filter((t) =>
    (t.name || t.trunkId).toLowerCase().includes(search.toLowerCase())
  );
  const filteredNumbers = numberRows.filter((r) => r.number.includes(search));

  const submit = async () => {
    setError("");
    if (ruleType === "individual" && !roomPrefix.trim()) {
      return setError("A room prefix is required — each caller gets its own room named with it");
    }
    if (ruleType === "direct" && !roomName.trim()) {
      return setError("A room name is required — every caller joins this one room");
    }

    const body = {
      type: ruleType,
      name: ruleName.trim() || undefined,
      ...(ruleType === "individual" ? { roomPrefix } : { roomName }),
      trunkIds: selectedTrunks.size ? [...selectedTrunks] : undefined,
      agentName: agentName || undefined,
    };

    const post = (payload: unknown) =>
      fetch("/api/dispatch-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

    setSubmitting(true);
    try {
      // Free the trunk scope before claiming it again.
      if (editing && rule) {
        const del = await fetch(`/api/dispatch-rules/${encodeURIComponent(rule.ruleId)}`, {
          method: "DELETE",
        });
        if (!del.ok) {
          const d = await del.json().catch(() => ({}));
          setError(d.reason || d.error || `Could not replace the rule (HTTP ${del.status})`);
          return;
        }
      }

      const res = await post(body);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.reason || data.details || data.error || `Failed to save the rule (HTTP ${res.status})`);
        // Put the original back rather than leaving the number unrouted.
        if (editing && rule) {
          const restored = await post({
            type: rule.type === "dispatchRuleDirect" ? "direct" : "individual",
            name: rule.name || undefined,
            ...(rule.type === "dispatchRuleDirect"
              ? { roomName: rule.roomName }
              : { roomPrefix: rule.roomPrefix }),
            trunkIds: rule.trunkIds?.length ? rule.trunkIds : undefined,
            agentName: rule.agents?.[0] || undefined,
          });
          if (restored.ok) {
            toast.warning("Change rejected — previous rule restored", {
              description: "Its ID changed, but routing is back as it was.",
            });
            onSaved();
          } else {
            toast.error("The rule was deleted and could not be recreated", {
              description: "Calls to its numbers are unrouted. Recreate the rule.",
              duration: Infinity,
              closeButton: true,
            });
            onSaved();
          }
        }
        return;
      }

      toast.success(`Dispatch rule ${ruleName ? `"${ruleName}" ` : ""}${editing ? "replaced" : "created"}`, {
        description: data.ruleId ? `ID ${data.ruleId}` : undefined,
      });
      onSaved();
    } catch {
      setError("Could not reach the dashboard API");
    } finally {
      setSubmitting(false);
    }
  };

  const field =
    "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit dispatch rule" : "Create a new dispatch rule"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Saving replaces the rule, so its ID changes — LiveKit cannot patch a rule's agent."
              : "Decides which room an inbound call lands in, and which agent answers it."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Rule name</Label>
            <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Support line" />
          </div>

          <div className="space-y-1.5">
            <Label>Rule type</Label>
            <Select value={ruleType} onValueChange={(v) => setRuleType(v as "individual" | "direct")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual — a room per caller</SelectItem>
                <SelectItem value="direct">Direct — every caller in one room</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {ruleType === "individual" ? (
            <div className="space-y-1.5">
              <Label>Room prefix</Label>
              <p className="text-xs text-muted-foreground">
                Each caller lands in its own room named with this prefix.
              </p>
              <input
                value={roomPrefix}
                onChange={(e) => setRoomPrefix(e.target.value)}
                placeholder="call-"
                className={field}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Room name</Label>
              <p className="text-xs text-muted-foreground">Every caller joins this single room.</p>
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="support"
                className={field}
              />
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label>Agent dispatch</Label>
            <p className="text-xs text-muted-foreground">
              Agents deployed from the builder register for explicit dispatch, so without one here the
              caller reaches an empty room.
            </p>
            <Select value={agentName || "__none__"} onValueChange={(v) => setAgentName(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No agent — leave the room empty</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
                {agentName && !agents.includes(agentName) && (
                  <SelectItem value={agentName}>{agentName} (not running)</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Inbound routing</Label>
            <p className="text-xs text-muted-foreground">
              Which calls this rule applies to. Nothing selected means all of them.
            </p>

            <div className="flex overflow-hidden rounded-lg border border-border">
              {(["phones", "trunks"] as const).map((t) => {
                const Icon = t === "phones" ? Phone : Server;
                return (
                  <button
                    key={t}
                    onClick={() => setInboundTab(t)}
                    className={`flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium capitalize transition-colors ${
                      inboundTab === t
                        ? "border-b-2 border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-3.5" />
                    {t === "phones" ? "Phone numbers" : "Trunks"}
                  </button>
                );
              })}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={inboundTab === "phones" ? "Search by phone number" : "Search by trunk name"}
                className={`${field} pl-9`}
              />
            </div>

            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : trunks.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No inbound trunks — the rule will apply to every call.{" "}
                <Link href="/telephony/sip-trunks?trunk=new" className="text-primary hover:underline">
                  Create a trunk
                </Link>
              </p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {inboundTab === "phones"
                  ? filteredNumbers.map(({ number, trunk }) => (
                      <label
                        key={`${trunk.trunkId}-${number}`}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedTrunks.has(trunk.trunkId)}
                          onCheckedChange={() => toggleTrunk(trunk.trunkId)}
                        />
                        <span className="font-mono text-xs">{number}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {trunk.name || trunk.trunkId}
                        </span>
                      </label>
                    ))
                  : filteredTrunks.map((t) => (
                      <label
                        key={t.trunkId}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedTrunks.has(t.trunkId)}
                          onCheckedChange={() => toggleTrunk(t.trunkId)}
                        />
                        <span>{t.name || t.trunkId}</span>
                        <span className="ml-auto font-mono text-xs text-muted-foreground">
                          {t.numbers.join(", ") || "any number"}
                        </span>
                      </label>
                    ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {selectedTrunks.size === 0
                ? "Applies to all inbound calls."
                : `Scoped to ${selectedTrunks.size} trunk${selectedTrunks.size > 1 ? "s" : ""}.`}
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
