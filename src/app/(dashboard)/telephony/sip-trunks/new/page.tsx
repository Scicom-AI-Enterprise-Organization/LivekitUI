"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { ChevronDown, X, FileText, Copy, PhoneIncoming, PhoneOutgoing } from "lucide-react";

export default function NewTrunkPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"details" | "json">("details");
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [inboundMode, setInboundMode] = useState<"allowed" | "specific">("allowed");
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [trunkName, setTrunkName] = useState("");
  const [numbers, setNumbers] = useState("");
  const [allowedAddresses, setAllowedAddresses] = useState("");
  const [jsonContent, setJsonContent] = useState("{}");

  // Sync form → JSON when switching to JSON tab
  const generateJson = () => {
    const obj: Record<string, unknown> = {};
    if (trunkName) obj.name = trunkName;
    if (direction) obj.direction = direction;
    if (direction === "inbound") obj.inbound_mode = inboundMode;
    if (numbers) obj.numbers = numbers.split(",").map((n) => n.trim()).filter(Boolean);
    if (allowedAddresses) obj.allowed_addresses = allowedAddresses.split(",").map((a) => a.trim()).filter(Boolean);
    return JSON.stringify(obj, null, 2);
  };

  const handleTabSwitch = (tab: "details" | "json") => {
    if (tab === "json") setJsonContent(generateJson());
    setActiveTab(tab);
  };

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
            <button
              onClick={() => handleTabSwitch("details")}
              className={`-mb-px border-b-2 pb-3 pt-1 text-sm font-medium px-1 mr-6 ${
                activeTab === "details"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Trunk details
            </button>
            <button
              onClick={() => handleTabSwitch("json")}
              className={`-mb-px border-b-2 pb-3 pt-1 text-sm font-medium px-1 ${
                activeTab === "json"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              JSON editor
            </button>
          </div>

          {activeTab === "details" && (
            <>
              {/* Trunk name */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Trunk name</label>
                <input
                  type="text"
                  value={trunkName}
                  onChange={(e) => setTrunkName(e.target.value)}
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
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDirection("inbound")}
                    className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                      direction === "inbound"
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/20"
                    }`}
                  >
                    <span className={`flex size-4 items-center justify-center rounded-full border-2 ${direction === "inbound" ? "border-primary" : "border-muted-foreground"}`}>
                      {direction === "inbound" && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <PhoneIncoming className="size-4" />
                    Inbound
                  </button>
                  <button
                    onClick={() => setDirection("outbound")}
                    className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                      direction === "outbound"
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/20"
                    }`}
                  >
                    <span className={`flex size-4 items-center justify-center rounded-full border-2 ${direction === "outbound" ? "border-primary" : "border-muted-foreground"}`}>
                      {direction === "outbound" && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <PhoneOutgoing className="size-4" />
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
                  value={numbers}
                  onChange={(e) => setNumbers(e.target.value)}
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
                  value={allowedAddresses}
                  onChange={(e) => setAllowedAddresses(e.target.value)}
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
                    <label className="text-sm font-medium text-foreground">SIP username</label>
                    <input type="text" className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">SIP password</label>
                    <input type="password" className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">SIP outbound address</label>
                    <input type="text" className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30" />
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === "json" && (
            <>
              {/* Trunk direction */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Trunk direction</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDirection("inbound")}
                    className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                      direction === "inbound"
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/20"
                    }`}
                  >
                    <span className={`flex size-4 items-center justify-center rounded-full border-2 ${direction === "inbound" ? "border-primary" : "border-muted-foreground"}`}>
                      {direction === "inbound" && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <PhoneIncoming className="size-4" />
                    Inbound
                  </button>
                  <button
                    onClick={() => setDirection("outbound")}
                    className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                      direction === "outbound"
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/20"
                    }`}
                  >
                    <span className={`flex size-4 items-center justify-center rounded-full border-2 ${direction === "outbound" ? "border-primary" : "border-muted-foreground"}`}>
                      {direction === "outbound" && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <PhoneOutgoing className="size-4" />
                    Outbound
                  </button>
                </div>
              </div>

              {/* JSON editor */}
              <div className="overflow-hidden rounded-lg border border-border">
                {/* File header */}
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileText className="size-4" />
                    <span>sip-trunk-info.json</span>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(jsonContent)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="size-4" />
                  </button>
                </div>

                {/* Editor area */}
                <div className="relative bg-[#0d1117] min-h-[400px]">
                  <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col items-end pr-2 pt-3 text-xs text-muted-foreground/40 font-mono select-none">
                    {jsonContent.split("\n").map((_, i) => (
                      <div key={i} className="leading-6">{i + 1}</div>
                    ))}
                  </div>
                  <textarea
                    value={jsonContent}
                    onChange={(e) => setJsonContent(e.target.value)}
                    spellCheck={false}
                    className="w-full min-h-[400px] bg-transparent pl-12 pr-4 py-3 text-sm font-mono leading-6 text-[#e6edf3] outline-none resize-none"
                  />
                </div>
              </div>
            </>
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
