"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { Copy, Plus, Trash2, Webhook } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

const WEBHOOK_EVENTS = [
  { id: "room_started", label: "Room started" },
  { id: "room_finished", label: "Room finished" },
  { id: "participant_joined", label: "Participant joined" },
  { id: "participant_left", label: "Participant left" },
  { id: "track_published", label: "Track published" },
  { id: "track_unpublished", label: "Track unpublished" },
  { id: "egress_started", label: "Egress started" },
  { id: "egress_ended", label: "Egress ended" },
  { id: "agent_started", label: "Agent started" },
  { id: "agent_stopped", label: "Agent stopped" },
];

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  secret: string;
  status: string;
  createdAt: string;
}

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState<string | null>(null);

  async function fetchEndpoints() {
    try {
      const res = await fetch("/api/webhooks");
      const data = await res.json();
      setEndpoints(data.endpoints ?? []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEndpoints();
  }, []);

  function toggleEvent(eventId: string) {
    setSelectedEvents((prev) =>
      prev.includes(eventId)
        ? prev.filter((e) => e !== eventId)
        : [...prev, eventId]
    );
  }

  async function handleCreate() {
    if (!url.trim() || selectedEvents.length === 0) return;
    setCreating(true);
    try {
      await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), events: selectedEvents }),
      });
      await fetchEndpoints();
      resetDialog();
    } catch {
      // handle error
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch("/api/webhooks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await fetchEndpoints();
    } catch {
      // handle error
    } finally {
      setDeleteId(null);
    }
  }

  function resetDialog() {
    setCreateOpen(false);
    setUrl("");
    setSelectedEvents([]);
  }

  function copySecret(secret: string) {
    navigator.clipboard.writeText(secret);
    setSecretCopied(secret);
    setTimeout(() => setSecretCopied(null), 2000);
  }

  function truncateUrl(url: string, max = 50) {
    return url.length > max ? url.slice(0, max) + "..." : url;
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Webhooks"
        breadcrumb={["husein", "Settings"]}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            Add endpoint
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <p className="text-sm text-muted-foreground">
          Webhooks let you receive real-time notifications when events occur in
          your LiveKit project (rooms created, participants joined, etc.)
        </p>

        {/* Endpoints */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground/70">
              Endpoints
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Loading...
              </p>
            ) : endpoints.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2">
                <Webhook className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No webhook endpoints configured.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">URL</th>
                      <th className="px-4 py-2.5 font-medium">Events</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Created</th>
                      <th className="px-4 py-2.5 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoints.map((ep) => (
                      <tr key={ep.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 font-mono text-xs text-foreground/70">
                          {truncateUrl(ep.url)}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant="secondary">
                            {ep.events.length} event
                            {ep.events.length !== 1 ? "s" : ""}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                          >
                            {ep.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-foreground/70">
                          {new Date(ep.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => copySecret(ep.secret)}
                              title="Copy webhook secret"
                            >
                              <Copy className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteId(ep.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
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

      {/* Add endpoint dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => !open && resetDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add webhook endpoint</DialogTitle>
            <DialogDescription>
              Configure a URL to receive webhook events from LiveKit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url" className="text-foreground/70">
                Endpoint URL
              </Label>
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://your-app.com/webhooks"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-foreground/70">Events</Label>
              <p className="text-xs text-muted-foreground">
                Select the events you want to receive notifications for.
              </p>
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                {WEBHOOK_EVENTS.map((event) => (
                  <div key={event.id} className="flex items-center gap-2.5">
                    <Checkbox
                      id={`event-${event.id}`}
                      checked={selectedEvents.includes(event.id)}
                      onCheckedChange={() => toggleEvent(event.id)}
                    />
                    <Label
                      htmlFor={`event-${event.id}`}
                      className="text-sm text-foreground/70 cursor-pointer font-normal"
                    >
                      {event.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleCreate}
              disabled={creating || !url.trim() || selectedEvents.length === 0}
            >
              {creating ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete webhook endpoint</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this webhook endpoint? You will
              stop receiving events at this URL.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
