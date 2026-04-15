"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/livekit/top-bar";
import { StatCard } from "@/components/livekit/stat-card";
import { MultiLineChart } from "@/components/livekit/line-chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ExternalLink,
  Pencil,
  Info,
  MoreVertical,
  Plus,
  Trash2,
  Eye,
  Loader2,
} from "lucide-react";

const chartLabels = ["Apr 8", "Apr 9", "Apr 10", "Apr 11", "Apr 12", "Apr 13", "Apr 14"];
const emptyData = [0, 0, 0, 0, 0, 0, 0];

interface Secret {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [secretDialogOpen, setSecretDialogOpen] = useState(false);
  const [editingSecret, setEditingSecret] = useState<Secret | null>(null);
  const [secretKey, setSecretKey] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [deleteAgentOpen, setDeleteAgentOpen] = useState(false);
  const [deleteSecretKey, setDeleteSecretKey] = useState<string | null>(null);

  const fetchSecrets = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}/secrets`);
      if (res.ok) {
        const data = await res.json();
        setSecrets(data.secrets ?? []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  const openAddSecret = () => {
    setEditingSecret(null);
    setSecretKey("");
    setSecretValue("");
    setSecretDialogOpen(true);
  };

  const openEditSecret = (s: Secret) => {
    setEditingSecret(s);
    setSecretKey(s.key);
    setSecretValue("");
    setSecretDialogOpen(true);
  };

  const saveSecret = async () => {
    if (!secretKey.trim() || !secretValue.trim()) return;
    await fetch(`/api/agents/${encodeURIComponent(id)}/secrets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: secretKey, value: secretValue }),
    });
    setSecretDialogOpen(false);
    fetchSecrets();
  };

  const confirmDeleteSecret = async () => {
    if (!deleteSecretKey) return;
    await fetch(`/api/agents/${encodeURIComponent(id)}/secrets`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: deleteSecretKey }),
    });
    setDeleteSecretKey(null);
    fetchSecrets();
  };

  const deleteAgent = async () => {
    await fetch("/api/agents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: id }),
    });
    setDeleteAgentOpen(false);
    router.push("/agents");
  };

  function formatDate(d: string) {
    const date = new Date(d);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={id}
        breadcrumb={["husein", "Agents"]}
        showRefresh
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <span className="size-1.5 rounded-full bg-yellow-500 animate-pulse" />
              PENDING
            </Badge>
            <Button variant="outline" size="sm">
              <ExternalLink className="size-3" />
              Open in Console
            </Button>
            <Button size="sm" asChild>
              <Link href={`/agents/builder?agent=${encodeURIComponent(id)}`}>
                <Pencil className="size-3" />
                Edit in Builder
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteAgentOpen(true)}
                >
                  <Trash2 className="size-4" />
                  Delete agent
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Top stats row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard label="Agent Name" value="—" />
          <Card className="py-4">
            <CardContent className="px-5 py-0">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm text-muted-foreground">Agent ID</span>
                <Info className="size-3 text-muted-foreground" />
              </div>
              <span className="text-sm font-mono text-foreground break-all">{id}</span>
            </CardContent>
          </Card>
          <StatCard label="Concurrent Agent Sessions" value={0} />
          <StatCard label="Agent Region" value="us-east" />
        </div>

        {/* Overview */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Overview</h2>
            <Button variant="outline" size="sm">Past 7 days</Button>
          </div>

          <Card className="py-0">
            <CardContent className="p-5">
              <h3 className="text-sm text-muted-foreground mb-4">Sessions served</h3>
              <MultiLineChart
                series={[
                  { data: emptyData, color: "var(--primary)", label: "Total number of active sessions" },
                  { data: emptyData, color: "var(--destructive)", label: "Agent dispatch errors" },
                ]}
                labels={chartLabels}
                height={180}
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Agent Uptime" value="0" unit="%" />
            <Card className="py-4">
              <CardContent className="px-5 py-0">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-sm text-muted-foreground">Agent LLM Latency</span>
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary" />
                    p50
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: "var(--secondary)" }} />
                    p90
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: "var(--chart-2)" }} />
                    p99
                  </span>
                </div>
                <div className="flex items-center justify-center h-16 text-muted-foreground">—</div>
              </CardContent>
            </Card>
            <StatCard label="Average Load" value="0" unit="%" />
          </div>
        </div>

        {/* Agent configuration */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Agent configuration</h2>

          {/* Secrets */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm text-muted-foreground">Secrets</h3>
              <Button variant="outline" size="icon-sm" onClick={openAddSecret}>
                <Plus className="size-4" />
              </Button>
            </div>
            <Card className="py-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Key Name</th>
                    <th className="px-4 py-2.5 font-medium">Kind</th>
                    <th className="px-4 py-2.5 font-medium">Created At</th>
                    <th className="px-4 py-2.5 font-medium">Updated At</th>
                    <th className="px-4 py-2.5 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center">
                        <Loader2 className="size-5 animate-spin text-muted-foreground mx-auto" />
                      </td>
                    </tr>
                  ) : secrets.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No results.
                      </td>
                    </tr>
                  ) : (
                    secrets.map((s) => (
                      <tr key={s.key} className="border-b last:border-0">
                        <td className="px-4 py-2.5 font-mono">{s.key}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">Environment</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{formatDate(s.createdAt)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{formatDate(s.updatedAt)}</td>
                        <td className="px-4 py-2.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-xs">
                                <MoreVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditSecret(s)}>
                                <Pencil className="size-3.5" />
                                Update secret
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteSecretKey(s.key)}
                              >
                                <Trash2 className="size-3.5" />
                                Delete secret
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </div>

          {/* Versions */}
          <div className="space-y-3">
            <h3 className="text-sm text-muted-foreground">Versions</h3>
            <Card className="py-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Version</th>
                    <th className="px-4 py-2.5 font-medium">Deployer</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                      No results.
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      </div>

      {/* Add/Edit secret dialog */}
      <Dialog open={secretDialogOpen} onOpenChange={setSecretDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSecret ? "Update secret" : "Add secrets"}</DialogTitle>
            <DialogDescription>
              Secrets are stored securely and mounted as environment variables when your agent runs. Modifying an agent&apos;s secrets will cause it to be restarted with the new values.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Key</Label>
              <Input
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="MY_API_KEY"
                className="font-mono"
                disabled={!!editingSecret}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Value</Label>
              <Input
                type="password"
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                placeholder="••••••••••••••••••••••"
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={saveSecret}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete secret dialog */}
      <Dialog open={!!deleteSecretKey} onOpenChange={(open) => !open && setDeleteSecretKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete secret</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-mono text-foreground">{deleteSecretKey}</span>? The agent will be restarted without this secret.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSecretKey(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteSecret}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete agent dialog */}
      <Dialog open={deleteAgentOpen} onOpenChange={setDeleteAgentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this agent? This can not be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={deleteAgent}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
