"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
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
import { Loader2, PhoneOutgoing } from "lucide-react";

interface OutboundTrunk {
  trunkId: string;
  name: string;
  address?: string;
}

/**
 * Dials a phone or SIP endpoint **into an existing room** — the console's live
 * session, for instance — so the agent can be tested over a real audio path
 * instead of the browser microphone.
 */
export function SipDialButton({
  roomName,
  disabled,
  onDialled,
}: {
  /** Room the SIP participant joins. Null disables the control. */
  roomName: string | null;
  disabled?: boolean;
  onDialled?: (info: { callTo: string; sipCallId?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [trunks, setTrunks] = useState<OutboundTrunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [trunkId, setTrunkId] = useState("");
  const [callTo, setCallTo] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [dialling, setDialling] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      fetch("/api/sip-trunks?direction=outbound")
        .then((r) => r.json())
        .then((d) => setTrunks(d.trunks ?? []))
        .catch(() => {})
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const dial = async () => {
    setError("");
    if (!trunkId) return setError("Pick an outbound trunk");
    if (!callTo.trim()) return setError("Enter a phone number or SIP URI");
    if (!roomName) return setError("Start a session first");

    setDialling(true);
    try {
      const res = await fetch("/api/calls/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trunkId,
          callTo,
          // Join the session already in progress; the agent is there already,
          // so no dispatch is requested here.
          roomName,
          fromNumber: fromNumber || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.reason || data.error || `Dial failed (HTTP ${res.status})`);
        return;
      }
      toast.success(`Dialling ${data.callTo}`, { description: `Into ${roomName}` });
      onDialled?.({ callTo: data.callTo, sipCallId: data.sipCallId });
      setOpen(false);
      setCallTo("");
    } catch {
      setError("Could not reach the dashboard API");
    } finally {
      setDialling(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        disabled={disabled || !roomName}
        title={roomName ? "Bring a phone or SIP endpoint into this session" : "Start a session first"}
        onClick={() => setOpen(true)}
      >
        <PhoneOutgoing className="size-3" />
        Dial SIP
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dial into this session</DialogTitle>
            <DialogDescription>
              The call joins <span className="font-mono text-xs">{roomName}</span>, so the agent talks to the
              phone instead of your microphone.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : trunks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No outbound trunks.{" "}
              <Link href="/telephony/sip-trunks/new" className="text-primary hover:underline">
                Create one
              </Link>{" "}
              to dial out.
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Outbound trunk</Label>
                <Select value={trunkId} onValueChange={setTrunkId}>
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
              </div>

              <div className="space-y-1.5">
                <Label>Call</Label>
                <Input
                  value={callTo}
                  onChange={(e) => setCallTo(e.target.value)}
                  placeholder="+15551234567 or sip:you@192.168.1.10"
                  className="font-mono text-sm"
                />
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

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={dial} disabled={dialling || trunks.length === 0}>
              {dialling ? <Loader2 className="size-4 animate-spin" /> : <PhoneOutgoing className="size-4" />}
              Dial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
