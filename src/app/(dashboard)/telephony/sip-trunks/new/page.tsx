"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { ChevronDown, X } from "lucide-react";

export default function NewTrunkPage() {
  const router = useRouter();
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [inboundMode, setInboundMode] = useState<"allowed" | "specific">("allowed");
  const [optionalOpen, setOptionalOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <TopBar title="SIP trunks" breadcrumb={["husein", "Telephony"]} />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground">
              Create a new trunk
            </h2>
            <button
              onClick={() => router.push("/telephony/sip-trunks")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Tab toggle */}
          <div className="flex border-b border-border">
            <button className="border-b-2 border-primary pb-3 pt-1 text-sm font-medium text-foreground px-1 mr-6">
              Trunk details
            </button>
            <button className="border-b-2 border-transparent pb-3 pt-1 text-sm font-medium text-muted-foreground hover:text-foreground px-1">
              JSON editor
            </button>
          </div>

          {/* Trunk name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Trunk name</label>
            <input
              type="text"
              placeholder="My Trunk"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Trunk direction */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-foreground">Trunk direction</label>
              <span className="text-muted-foreground text-xs cursor-pointer">&#9432;</span>
            </div>
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setDirection("inbound")}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                  direction === "inbound"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={`size-3 rounded-full border-2 ${direction === "inbound" ? "border-primary bg-primary" : "border-muted-foreground"}`} />
                Inbound
              </button>
              {direction === "inbound" && (
                <div className="flex border-l border-border">
                  <button
                    onClick={() => setInboundMode("allowed")}
                    className={`px-3 py-2 text-xs font-medium transition-colors ${
                      inboundMode === "allowed"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Allowed
                  </button>
                  <button
                    onClick={() => setInboundMode("specific")}
                    className={`px-3 py-2 text-xs font-medium transition-colors ${
                      inboundMode === "specific"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Specific
                  </button>
                </div>
              )}
              <button
                onClick={() => setDirection("outbound")}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ml-auto ${
                  direction === "outbound"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={`size-3 rounded-full border-2 ${direction === "outbound" ? "border-primary bg-primary" : "border-muted-foreground"}`} />
                Outbound
              </button>
            </div>
          </div>

          {/* Numbers */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-foreground">Numbers</label>
              <span className="text-muted-foreground text-xs cursor-pointer">&#9432;</span>
            </div>
            <p className="text-xs text-muted-foreground">
              List of provider phone numbers this trunk accepts calls for. If none are specified, it accepts calls to any number.
            </p>
            <input
              type="text"
              placeholder="+1xxxxxxxxxx"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Allowed addresses */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-foreground">Allowed addresses</label>
              <span className="text-muted-foreground text-xs cursor-pointer">&#9432;</span>
            </div>
            <p className="text-xs text-muted-foreground">
              For better security, only allow IP addresses you trust. Draft entries or set to &quot;0.0.0.0/0&quot;, all IP addresses will be allowed.
            </p>
            <input
              type="text"
              placeholder="xxx.xxx.xxx.xxx"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Optional settings */}
          <button
            onClick={() => setOptionalOpen(!optionalOpen)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={`size-4 transition-transform ${optionalOpen ? "" : "-rotate-90"}`}
            />
            Optional settings
          </button>

          {optionalOpen && (
            <div className="space-y-4 pl-6 border-l border-border">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  SIP username
                </label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  SIP password
                </label>
                <input
                  type="password"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  SIP outbound address
                </label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
              </div>
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
                onClick={() => router.push("/telephony/sip-trunks")}
              >
                Cancel
              </Button>
              <Button size="sm">Create</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
