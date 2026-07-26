"use client";

import { useState } from "react";
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
import { ChevronDown, Loader2, PhoneIncoming, PhoneOutgoing } from "lucide-react";

const csv = (value: string) => value.split(",").map((v) => v.trim()).filter(Boolean);

/** Create an inbound or outbound SIP trunk. */
export function TrunkDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [trunkName, setTrunkName] = useState("");
  const [numbers, setNumbers] = useState("");
  const [allowedAddresses, setAllowedAddresses] = useState("");
  const [address, setAddress] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  /** Exactly what POST /api/sip-trunks receives. */
  const requestBody = () => {
    const body: Record<string, unknown> = { direction, name: trunkName, numbers: csv(numbers) };
    if (direction === "inbound") {
      if (allowedAddresses) body.allowedAddresses = csv(allowedAddresses);
    } else if (address) {
      body.address = address;
    }
    if (authUsername) body.authUsername = authUsername;
    if (authPassword) body.authPassword = authPassword;
    return body;
  };

  const submit = async () => {
    setError("");
    if (!trunkName.trim()) return setError("Trunk name is required");
    if (csv(numbers).length === 0) return setError("At least one number is required");
    if (direction === "outbound" && !address.trim()) {
      return setError("An outbound trunk needs a SIP address — open Optional settings to set it");
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/sip-trunks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.reason || data.error || `Failed to create trunk (HTTP ${res.status})`);
        return;
      }
      toast.success(`${direction === "inbound" ? "Inbound" : "Outbound"} trunk "${trunkName}" created`, {
        description: data.trunkId ? `ID ${data.trunkId}` : undefined,
      });
      onSaved();
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
          <DialogTitle>Create a new trunk</DialogTitle>
          <DialogDescription>
            A trunk connects your SIP provider to LiveKit. Inbound accepts calls; outbound places them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Trunk name</Label>
            <Input value={trunkName} onChange={(e) => setTrunkName(e.target.value)} placeholder="My Trunk" />
          </div>

          <div className="space-y-2">
            <Label>Trunk direction</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["inbound", "outbound"] as const).map((d) => {
                const Icon = d === "inbound" ? PhoneIncoming : PhoneOutgoing;
                return (
                  <button
                    key={d}
                    onClick={() => setDirection(d)}
                    className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm font-medium capitalize transition-colors ${
                      direction === d
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/20"
                    }`}
                  >
                    <span
                      className={`flex size-4 items-center justify-center rounded-full border-2 ${
                        direction === d ? "border-primary" : "border-muted-foreground"
                      }`}
                    >
                      {direction === d && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <Icon className="size-4" />
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Numbers</Label>
            <p className="text-xs text-muted-foreground">
              Provider numbers this trunk handles, comma separated.
            </p>
            <input
              value={numbers}
              onChange={(e) => setNumbers(e.target.value)}
              placeholder="+1xxxxxxxxxx"
              className={field}
            />
          </div>

          {direction === "inbound" ? (
            <div className="space-y-1.5">
              <Label>Allowed addresses</Label>
              <p className="text-xs text-muted-foreground">
                Only accept calls from these IPs. Use{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">0.0.0.0/0</code> to allow any while
                testing.
              </p>
              <input
                value={allowedAddresses}
                onChange={(e) => setAllowedAddresses(e.target.value)}
                placeholder="xxx.xxx.xxx.xxx"
                className={field}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>
                SIP address <span className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Where calls are placed, e.g.{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">my-trunk.pstn.twilio.com</code>
              </p>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="sip.provider.com"
                className={field}
              />
            </div>
          )}

          <button
            onClick={() => setOptionalOpen(!optionalOpen)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`size-4 transition-transform ${optionalOpen ? "" : "-rotate-90"}`} />
            Optional settings
          </button>

          {optionalOpen && (
            <div className="space-y-4 border-l border-border pl-4">
              <div className="space-y-1.5">
                <Label>SIP username</Label>
                <input value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} className={field} />
              </div>
              <div className="space-y-1.5">
                <Label>SIP password</Label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className={field}
                />
              </div>
            </div>
          )}

          <button
            onClick={() => setPreviewOpen(!previewOpen)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`size-4 transition-transform ${previewOpen ? "" : "-rotate-90"}`} />
            Request preview
          </button>

          {previewOpen && (
            <pre className="max-h-40 overflow-auto rounded-md bg-muted/50 p-3 text-xs font-mono">
              {JSON.stringify(requestBody(), null, 2)}
            </pre>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
