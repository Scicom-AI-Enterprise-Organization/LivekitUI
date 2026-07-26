"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useVoiceAssistant,
  useParticipants,
  useLocalParticipant,
  useMediaDeviceSelect,
  BarVisualizer,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2, PhoneOutgoing, PhoneOff, Mic, MicOff } from "lucide-react";
import {
  loopbackOutcome,
  type DispatchRuleSummary,
  type InboundNumber,
} from "@/lib/sip-loopback";

interface OutboundTrunk {
  trunkId: string;
  name: string;
  numbers: string[];
  address?: string;
}

interface ActiveCall {
  room: string;
  callTo: string;
  agent: string | null;
  token: string;
  serverUrl: string;
  sipCallId?: string;
}

/**
 * Mic mute + input picker. Hand-rolled rather than LiveKit's
 * VoiceAssistantControlBar, whose device menu renders unstyled over the dark
 * panel and which ships its own Disconnect button next to our Hang up.
 */
function CallControls() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind: "audioinput" });

  return (
    <div className="flex w-full items-center justify-center gap-2">
      <Button
        size="sm"
        variant={isMicrophoneEnabled ? "secondary" : "destructive"}
        className="gap-1.5"
        onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
      >
        {isMicrophoneEnabled ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
        {isMicrophoneEnabled ? "Mute" : "Unmute"}
      </Button>

      <Select value={activeDeviceId || undefined} onValueChange={(id) => setActiveMediaDevice(id)}>
        <SelectTrigger
          size="sm"
          className="max-w-[220px] border-white/20 bg-white/5 text-xs text-white/80 hover:bg-white/10"
        >
          <SelectValue placeholder="Microphone" />
        </SelectTrigger>
        <SelectContent>
          {devices.map((d, i) => (
            <SelectItem key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Live view of the room the call is placed into. */
function CallSession({ call, onHangUp }: { call: ActiveCall; onHangUp: () => void }) {
  const { state, audioTrack } = useVoiceAssistant();
  const participants = useParticipants();
  // The SIP participant appears once the carrier accepts; it leaves on hangup.
  const sip = participants.find((p) => p.identity.startsWith("sip-"));

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-[#0d1117] p-6">
      <BarVisualizer
        state={state}
        barCount={5}
        trackRef={audioTrack}
        className="h-[70px] w-[140px]"
        options={{ minHeight: 8 }}
      />
      <div className="text-center">
        <p className="font-mono text-sm text-white">{call.callTo}</p>
        <p className="text-xs text-white/50 mt-0.5">
          {sip ? "connected" : "ringing…"}
          {call.agent && ` · agent ${call.agent} (${state})`}
        </p>
        <p className="text-[10px] text-white/30 mt-1 font-mono">{call.room}</p>
      </div>

      <CallControls />

      <Button variant="destructive" size="sm" className="gap-1.5" onClick={onHangUp}>
        <PhoneOff className="size-3.5" />
        Hang up
      </Button>

      <RoomAudioRenderer />
    </div>
  );
}

/**
 * Dials out through an outbound trunk and drops the browser into the same room,
 * so a call can be tested without a softphone or an inbound number.
 */
export function PlaceCallPanel({
  open,
  onOpenChange,
  onCallPlaced,
}: {
  /** Driven by ?call=new on the page, so the dialog is linkable. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCallPlaced?: () => void;
}) {
  const [trunks, setTrunks] = useState<OutboundTrunk[]>([]);
  // Numbers your own inbound trunks answer — dialling one loops the call back
  // through the inbound path (trunk → dispatch rule → agent), which is the
  // quickest way to prove the whole chain without a carrier.
  const [inboundNumbers, setInboundNumbers] = useState<InboundNumber[]>([]);
  // Dispatch rules decide who answers a loopback call — an agent, or nobody.
  const [rules, setRules] = useState<DispatchRuleSummary[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [trunkId, setTrunkId] = useState("");
  const [callTo, setCallTo] = useState("");
  const [agentName, setAgentName] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [call, setCall] = useState<ActiveCall | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/sip-trunks?direction=outbound")
        .then((r) => r.json())
        .then((d) => setTrunks(d.trunks ?? []))
        .catch(() => {}),
      fetch("/api/sip-trunks?direction=inbound")
        .then((r) => r.json())
        .then((d) =>
          setInboundNumbers(
            (d.trunks ?? []).flatMap((t: { name: string; trunkId: string; numbers?: string[] }) =>
              (t.numbers ?? []).map((n: string) => ({
                number: n,
                trunk: t.name || t.trunkId,
                trunkId: t.trunkId,
              }))
            )
          )
        )
        .catch(() => {}),
      fetch("/api/dispatch-rules")
        .then((r) => r.json())
        .then((d) => setRules(d.rules ?? []))
        .catch(() => {}),
      fetch("/api/agents")
        .then((r) => r.json())
        .then((d) =>
          setAgents(
            (d.agents ?? [])
              .filter((a: { running?: boolean }) => a.running)
              .map((a: { agentName: string }) => a.agentName)
          )
        )
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const place = async () => {
    setError("");
    if (!callTo.trim()) return setError("Enter a phone number or SIP address to call");
    if (!direct && !trunkId) return setError("Pick an outbound trunk to dial a phone number");

    setPlacing(true);
    try {
      const res = await fetch("/api/calls/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // An address is dialled directly, so no trunk is involved.
          trunkId: direct ? undefined : trunkId,
          callTo: callTo.trim(),
          // The tone is published into the room. With an agent on the call it
          // is something for the agent to react to, so only ring when the room
          // is just you waiting for a pickup.
          playDialtone: !agentName,
          agentName: agentName || undefined,
          fromNumber: fromNumber || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.reason || data.error || `Call failed (HTTP ${res.status})`);
        return;
      }
      setCall(data);
      toast.success(`Calling ${data.callTo}`, { description: `Room ${data.room}` });
      onCallPlaced?.();
    } catch {
      setError("Could not reach the dashboard API");
    } finally {
      setPlacing(false);
    }
  };

  // Closing the room, not just leaving it — otherwise the SIP leg and the agent
  // stay on the line after the browser disconnects.
  // Dialling one of our own numbers means the far end is governed by a dispatch
  // rule, not by the agent picked here — worth saying, because an agent then
  // answers even with "No agent" selected.
  const selfDialled = inboundNumbers.find((n) => n.number === callTo.trim());
  const outcome = selfDialled ? loopbackOutcome(rules, selfDialled) : null;

  /**
   * `sip:name@host` is dialled straight at that device. LiveKit rejects a full
   * URI in sip_call_to, so the route splits it into an inline outbound config —
   * which is also why no trunk (and no carrier) is needed for one.
   */
  const direct = (() => {
    const trimmed = callTo.trim().replace(/^sips?:/i, "");
    const at = trimmed.lastIndexOf("@");
    return at > 0 && !!trimmed.slice(at + 1).trim();
  })();

  const hangUp = useCallback(
    (room?: string) => {
      const target = room ?? call?.room;
      setCall(null);
      if (target) {
        fetch("/api/calls/place", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: target }),
        }).catch(() => {});
      }
      onCallPlaced?.();
    },
    [call?.room, onCallPlaced]
  );

  const close = () => {
    onOpenChange(false);
    if (call) hangUp(call.room);
    setError("");
  };

  return (
    <>
      <Button size="sm" className="gap-1.5 text-xs" onClick={() => onOpenChange(true)}>
        <PhoneOutgoing className="size-3" />
        Place test call
      </Button>

      <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{call ? "Call in progress" : "Place a test call"}</DialogTitle>
            <DialogDescription>
              {call
                ? "You are in the room with the call. Unmute to talk to the other end."
                : "LiveKit dials out through an outbound trunk. You join the same room, so you can hear both sides."}
            </DialogDescription>
          </DialogHeader>

          {call ? (
            <LiveKitRoom
              token={call.token}
              serverUrl={call.serverUrl}
              connect
              audio
              onDisconnected={() => hangUp()}
            >
              <CallSession call={call} onHangUp={() => hangUp()} />
            </LiveKitRoom>
          ) : loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>
                  Outbound trunk{" "}
                  {direct && (
                    <span className="font-normal text-muted-foreground">(not used for an address)</span>
                  )}
                </Label>
                {/* No trunk is fine: a sip: address is dialled without one. */}
                {trunks.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground">
                    No outbound trunks —{" "}
                    <Link href="/telephony/sip-trunks/new" className="text-primary hover:underline">
                      create one
                    </Link>{" "}
                    pointed at your provider to dial phone numbers.
                  </div>
                ) : (
                  <Select value={trunkId} onValueChange={setTrunkId} disabled={direct}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a trunk" />
                    </SelectTrigger>
                    <SelectContent>
                      {trunks.map((t) => (
                        <SelectItem key={t.trunkId} value={t.trunkId}>
                          {t.name || t.trunkId}
                          {t.address ? ` — ${t.address}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Call</Label>
                <Input
                  value={callTo}
                  onChange={(e) => setCallTo(e.target.value)}
                  placeholder="+15551234567 or sip:you@192.168.1.10"
                  className="font-mono text-sm"
                />
                {inboundNumbers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-xs text-muted-foreground">Your inbound numbers:</span>
                    {inboundNumbers.map(({ number, trunk }) => (
                      <button
                        key={`${trunk}-${number}`}
                        type="button"
                        onClick={() => setCallTo(number)}
                        title={`Fill ${number} — answered by "${trunk}"`}
                        className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-foreground transition-colors hover:border-primary hover:text-primary"
                      >
                        {number}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  A phone number needs a carrier on the trunk. A{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">sip:you@host</code> address —
                  your own softphone, for instance — rings that device directly and needs no trunk at
                  all. Picking one of your own numbers above loops the call back through your inbound
                  trunk and dispatch rule, so an agent answers it.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>
                  Answer with agent <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Select
                  value={agentName || "__none__"}
                  onValueChange={(v) => setAgentName(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No agent — just you on the line</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selfDialled && outcome ? (
                  <p
                    className={
                      outcome.kind === "agent"
                        ? "text-xs text-yellow-600 dark:text-yellow-500"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    This is your own number on trunk{" "}
                    <span className="font-medium">{selfDialled.trunk}</span>, so this setting applies
                    to your side only —{" "}
                    {outcome.kind === "agent" ? (
                      <>
                        the far end is answered by{" "}
                        <span className="font-medium">{outcome.agents.join(", ")}</span> via rule{" "}
                        <span className="font-medium">{outcome.ruleName}</span>.
                      </>
                    ) : outcome.kind === "empty" ? (
                      <>
                        rule <span className="font-medium">{outcome.ruleName}</span> dispatches no
                        agent, so the far end is an empty room and nothing answers.
                      </>
                    ) : (
                      <>no dispatch rule matches it, so the inbound call is rejected.</>
                    )}
                  </p>
                ) : (
                  agents.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No running agents. Deploy one to have it answer.
                    </p>
                  )
                )}
              </div>

              <div className="space-y-1.5">
                <Label>
                  From number <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  placeholder="defaults to the trunk's number"
                  className="font-mono text-sm"
                />
              </div>
            </div>
          )}

          {!call && (
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={place} disabled={placing || (!direct && trunks.length === 0)}>
                {placing ? <Loader2 className="size-4 animate-spin" /> : <PhoneOutgoing className="size-4" />}
                Call
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
