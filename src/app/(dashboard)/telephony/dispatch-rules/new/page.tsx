"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Phone, Server, X } from "lucide-react";

export default function NewDispatchRulePage() {
  const router = useRouter();
  const [ruleType, setRuleType] = useState("individual");
  const [inboundTab, setInboundTab] = useState<"phones" | "trunks">("phones");

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
              placeholder=""
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Rule type */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-foreground">Rule type</label>
              <span className="text-muted-foreground text-xs cursor-pointer">&#9432;</span>
            </div>
            <Select value={ruleType} onValueChange={setRuleType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual</SelectItem>
                <SelectItem value="room">Room</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Room prefix */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Room prefix</label>
            <input
              type="text"
              defaultValue=""
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Agent dispatch */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Agent dispatch</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Configure an agent to dispatch to LiveKit rooms and enable inbound calling for your agent.
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Plus className="size-3" />
              Add agent
            </Button>
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
                placeholder={
                  inboundTab === "phones"
                    ? "Search by phone number"
                    : "Search by trunk name"
                }
                className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {/* Empty state */}
            <div className="py-8 text-center text-sm text-muted-foreground">
              {inboundTab === "phones"
                ? "No phone numbers found"
                : "No trunks found"}
            </div>
          </div>

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
              <Button size="sm">Create</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
