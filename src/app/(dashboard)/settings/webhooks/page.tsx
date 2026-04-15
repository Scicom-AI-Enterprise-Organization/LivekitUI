"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Copy, Check, ExternalLink, RefreshCw, Trash2, Loader2, Eye } from "lucide-react";

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="rounded-lg border bg-muted/50 p-4 text-xs font-mono overflow-x-auto whitespace-pre">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-2 right-2"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
      </Button>
    </div>
  );
}

interface WebhookEvent {
  id: number;
  event: string;
  room: string | null;
  participant: string | null;
  payload: string;
  createdAt: string;
}

const EVENT_COLORS: Record<string, string> = {
  room_started: "bg-green-500/10 text-green-500",
  room_finished: "bg-red-500/10 text-red-500",
  participant_joined: "bg-blue-500/10 text-blue-500",
  participant_left: "bg-orange-500/10 text-orange-500",
  track_published: "bg-purple-500/10 text-purple-500",
  track_unpublished: "bg-purple-500/10 text-purple-400",
  egress_started: "bg-cyan-500/10 text-cyan-500",
  egress_ended: "bg-cyan-500/10 text-cyan-400",
  ingress_started: "bg-teal-500/10 text-teal-500",
  ingress_ended: "bg-teal-500/10 text-teal-400",
};

export default function WebhooksPage() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null);

  const [receiverUrl, setReceiverUrl] = useState("/api/webhooks/livekit");

  useEffect(() => {
    setReceiverUrl(`${window.location.origin}/api/webhooks/livekit`);
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/webhooks?limit=100");
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 5000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const handleClear = async () => {
    if (!confirm("Clear all webhook events?")) return;
    await fetch("/api/webhooks", { method: "DELETE" });
    fetchEvents();
  };

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Webhooks"
        breadcrumb={[{ label: "Settings", href: "/settings/project" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchEvents}>
              <RefreshCw className="size-3" />
              Refresh
            </Button>
            {events.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleClear} className="text-destructive hover:text-destructive">
                <Trash2 className="size-3" />
                Clear
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Webhooks</h2>
          <p className="text-sm text-muted-foreground">
            Receive real-time notifications when events occur in your LiveKit server.{" "}
            <a
              href="https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Learn more <ExternalLink className="size-3" />
            </a>
          </p>
        </div>

        {/* Setup */}
        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add this to your <code className="rounded bg-muted px-1.5 py-0.5 text-xs">livekit.yaml</code> and restart the server:
            </p>
            <CopyBlock code={`webhook:
  urls:
    - ${receiverUrl}
  api_key: <your-api-key>`} />
          </CardContent>
        </Card>

        {/* Event log */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                Event log
                {events.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">{events.length}</Badge>
                )}
              </CardTitle>
              <span className="text-xs text-muted-foreground">Auto-refreshes every 5s</span>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : events.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <p className="text-sm text-muted-foreground">No webhook events received yet.</p>
                <p className="text-xs text-muted-foreground">
                  Configure your <code className="rounded bg-muted px-1 py-0.5">livekit.yaml</code> and start a session to see events here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Event</th>
                      <th className="px-4 py-2.5 font-medium">Room</th>
                      <th className="px-4 py-2.5 font-medium">Participant</th>
                      <th className="px-4 py-2.5 font-medium">Time</th>
                      <th className="px-4 py-2.5 font-medium w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-accent/50 transition-colors">
                        <td className="px-4 py-2.5">
                          <Badge
                            variant="secondary"
                            className={`font-mono text-xs ${EVENT_COLORS[e.event] || ""}`}
                          >
                            {e.event}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {e.room || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {e.participant || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {formatTime(e.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setSelectedEvent(e)}
                          >
                            <Eye className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Event detail dialog */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className={`font-mono text-xs ${EVENT_COLORS[selectedEvent?.event || ""] || ""}`}
              >
                {selectedEvent?.event}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {selectedEvent ? formatTime(selectedEvent.createdAt) : ""}
              {selectedEvent?.room ? ` · Room: ${selectedEvent.room}` : ""}
              {selectedEvent?.participant ? ` · Participant: ${selectedEvent.participant}` : ""}
            </DialogDescription>
          </DialogHeader>
          <pre className="rounded-lg border bg-muted/50 p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-[50vh]">
            {selectedEvent ? JSON.stringify(JSON.parse(selectedEvent.payload), null, 2) : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
