"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Phone } from "lucide-react";

export default function PhoneNumbersPage() {
  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Phone numbers"
        breadcrumb={["husein", "Telephony"]}
        actions={
          <Button size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            Buy a number
          </Button>
        }
      />

      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center text-center p-8 space-y-4">
            <div className="flex items-center justify-center size-16 rounded-full border bg-card">
              <Phone className="size-7 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Phone numbers</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Purchase phone numbers directly from LiveKit for your voice agents to answer inbound calls, no external SIP trunk configuration required.
            </p>
            <Button className="gap-1.5">
              Buy a number
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
