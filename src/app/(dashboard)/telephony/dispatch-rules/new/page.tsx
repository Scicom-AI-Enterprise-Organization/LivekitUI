"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, Phone, Server, X } from "lucide-react";

interface InboundTrunk {
  trunkId: string;
  name: string;
  numbers: string[];
}

export default function NewDispatchRulePage() {
  const router = useRouter();
  // "individual" = a room per caller; "direct" = every caller in one room.
  const [ruleType, setRuleType] = useState<"individual" | "direct">("individual");
  const [inboundTab, setInboundTab] = useState<"phones" | "trunks">("phones");
  const [ruleName, setRuleName] = useState("");
  const [roomPrefix, setRoomPrefix] = useState("call-");
  const [roomName, setRoomName] = useState("");
  const [search, setSearch] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agents, setAgents] = useState<string[]>([]);
  const [trunks, setTrunks] = useState<InboundTrunk[]>([]);
  const [trunksLoading, setTrunksLoading] = useState(true);
  const [selectedTrunks, setSelectedTrunks] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // The rule is scoped by trunk, so both tabs drive the same trunk selection —
  // picking a number selects the trunk that owns it.
  const loadTrunks = useCallback(
    () =>
      fetch("/api/sip-trunks?direction=inbound")
        .then((r) => r.json())
        .then((d) => setTrunks(d.trunks ?? []))
        .catch(() => {})
        .finally(() => setTrunksLoading(false)),
    []
  );

  const loadAgents = useCallback(
    () =>
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
    []
  );

  useEffect(() => {
    loadTrunks();
    loadAgents();
  }, [loadTrunks, loadAgents]);

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

    setSubmitting(true);
    try {
      const res = await fetch("/api/dispatch-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: ruleType,
          name: ruleName.trim() || undefined,
          ...(ruleType === "individual" ? { roomPrefix } : { roomName }),
          // Empty means the rule applies to every trunk.
          trunkIds: selectedTrunks.size ? [...selectedTrunks] : undefined,
          agentName: agentName || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.reason || data.error || `Failed to create rule (HTTP ${res.status})`);
        return;
      }
      toast.success(`Dispatch rule ${ruleName ? `"${ruleName}" ` : ""}created`, {
        description: data.ruleId ? `ID ${data.ruleId}` : undefined,
      });
      router.push("/telephony/dispatch-rules");
    } catch {
      setError("Could not reach the dashboard API");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Dispatch rules" breadcrumb={[{ label: "Telephony", href: "/telephony/calls" }]} />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground">
              Create a new dispatch rule
            </h2>
            <button
              onClick={() => router.push("/telephony/dispatch-rules")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Tab toggle */}
          <div className="flex border-b border-border">
            <button className="border-b-2 border-primary pb-3 pt-1 text-sm font-medium text-foreground px-1 mr-6">
              Dispatch rule details
            </button>
            <button className="border-b-2 border-transparent pb-3 pt-1 text-sm font-medium text-muted-foreground hover:text-foreground px-1">
              JSON editor
            </button>
          </div>

          {/* Rule name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Rule name</label>
            <input
              type="text"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="Support line"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Rule type */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-foreground">Rule type</label>
              <span className="text-muted-foreground text-xs cursor-pointer">&#9432;</span>
            </div>
            <Select value={ruleType} onValueChange={(v) => setRuleType(v as "individual" | "direct")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual — a room per caller</SelectItem>
                <SelectItem value="direct">Direct — every caller in one room</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Room naming */}
          {ruleType === "individual" ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Room prefix</label>
              <p className="text-xs text-muted-foreground">
                Each caller lands in its own room named with this prefix.
              </p>
              <input
                type="text"
                value={roomPrefix}
                onChange={(e) => setRoomPrefix(e.target.value)}
                placeholder="call-"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Room name</label>
              <p className="text-xs text-muted-foreground">Every caller joins this single room.</p>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="support"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </div>
          )}

          {/* Agent dispatch */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Agent dispatch</h3>
              <p className="text-xs text-muted-foreground mt-1">
                The agent that answers these calls. Agents deployed from the builder register for explicit
                dispatch, so without one here the caller reaches an empty room.
              </p>
            </div>
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
              </SelectContent>
            </Select>
            {agents.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No agents found. Deploy one from the{" "}
                <span
                  className="text-primary cursor-pointer hover:underline"
                  onClick={() => router.push("/agents/builder")}
                >
                  agent builder
                </span>
                .
              </p>
            )}
          </div>

          {/* Inbound routing */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Inbound routing</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Configure automation by setting up how inbound calls will be dispatched to LiveKit rooms by matching phone numbers and specific trunks. If no number or trunk is selected, the rule will be applied to all.
              </p>
            </div>

            {/* Phone numbers / Trunks tabs */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setInboundTab("phones")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                  inboundTab === "phones"
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Phone className="size-3.5" />
                Phone numbers
              </button>
              <button
                onClick={() => setInboundTab("trunks")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                  inboundTab === "trunks"
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Server className="size-3.5" />
                Trunks
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  inboundTab === "phones"
                    ? "Search by phone number"
                    : "Search by trunk name"
                }
                className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {trunksLoading ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : trunks.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No inbound trunks yet. The rule will apply to every call — or{" "}
                <span
                  className="text-primary cursor-pointer hover:underline"
                  onClick={() => router.push("/telephony/sip-trunks/new")}
                >
                  create a trunk
                </span>{" "}
                to scope it.
              </div>
            ) : inboundTab === "phones" ? (
              <div className="max-h-56 overflow-y-auto space-y-1">
                {filteredNumbers.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No phone numbers found</p>
                )}
                {filteredNumbers.map(({ number, trunk }) => (
                  <label
                    key={`${trunk.trunkId}-${number}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedTrunks.has(trunk.trunkId)}
                      onCheckedChange={() => toggleTrunk(trunk.trunkId)}
                    />
                    <span className="font-mono text-xs">{number}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {trunk.name || trunk.trunkId}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1">
                {filteredTrunks.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No trunks found</p>
                )}
                {filteredTrunks.map((t) => (
                  <label
                    key={t.trunkId}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedTrunks.has(t.trunkId)}
                      onCheckedChange={() => toggleTrunk(t.trunkId)}
                    />
                    <span>{t.name || t.trunkId}</span>
                    <span className="text-xs text-muted-foreground ml-auto font-mono">
                      {t.numbers.join(", ") || "any number"}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {selectedTrunks.size === 0
                ? "Nothing selected — the rule applies to all inbound calls."
                : `Scoped to ${selectedTrunks.size} trunk${selectedTrunks.size > 1 ? "s" : ""}.`}
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            <span className="text-xs text-primary cursor-pointer hover:underline">
              Learn more in the docs
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/telephony/dispatch-rules")}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="size-3 animate-spin" />}
                Create
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
