"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/livekit/top-bar";
import { DEFAULT_TIME_RANGE, TimeRangePicker, type TimeRangeValue } from "@/components/livekit/time-range-picker";
import { StatCard } from "@/components/livekit/stat-card";
import { MultiLineChart } from "@/components/livekit/line-chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
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
  ScrollText,
  RotateCw,
  RefreshCw,
  X,
} from "lucide-react";

function AgentLogViewer({ name, onClose }: { name: string; onClose: () => void }) {
  const [logs, setLogs] = useState("");
  const [fetching, setFetching] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(() => {
    setFetching(true);
    fetch(`/api/agents/${encodeURIComponent(name)}/logs`)
      .then((res) => res.json())
      .then((data) => setLogs(data.logs || "No logs yet."))
      .finally(() => setFetching(false));
  }, [name]);

  useEffect(() => {
    fetchLogs();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [fetchLogs, autoRefresh]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex h-[80vh] w-[80vw] max-w-4xl flex-col rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <ScrollText className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Logs: {name}</h3>
            {autoRefresh && (
              <Badge variant="outline" className="text-xs gap-1">
                <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                Live
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setAutoRefresh(!autoRefresh)}>
              {autoRefresh ? "Pause" : "Resume"}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={fetchLogs} disabled={fetching}>
              <RefreshCw className={`size-3 ${fetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-[#0d1117] p-4">
          <pre className="text-xs font-mono leading-5 text-[#e6edf3] whitespace-pre-wrap break-all">
            {logs}
          </pre>
        </div>
      </div>
    </div>
  );
}

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
  const [logsOpen, setLogsOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [running, setRunning] = useState<boolean | null>(null);
  const [workerInfo, setWorkerInfo] = useState<{
    concurrentSessions: number;
    participantIdentities: string[];
    region: string;
    pid: number | null;
    workerId: string | null;
  } | null>(null);
  const [history, setHistory] = useState<{ time: string; sessions: number; agents: number }[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRangeValue>(DEFAULT_TIME_RANGE);
  const [metrics, setMetrics] = useState<{
    uptimeReadable: string;
    cpuPercent: number;
    memoryMb: number;
    memoryPercent: number;
    llmLatency: { p50: number; p90: number; p99: number; samples: number } | null;
  } | null>(null);
  const [versions, setVersions] = useState<{
    id: number;
    version: number;
    deployerEmail: string;
    deployerName: string;
    createdAt: string;
  }[]>([]);

  // Fetch per-agent session history for the chart
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch(`/api/agents/${encodeURIComponent(id)}/history?hours=${timeRange.hours}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          const h = (d.history || []).map((entry: { time: string; sessions: number; running: number }) => ({
            time: new Date(entry.time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
            sessions: entry.sessions,
            agents: entry.running,
          }));
          setHistory(h);
        })
        .catch(() => {});
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [id, timeRange.hours]);

  // Fetch deployment versions
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch(`/api/agents/${encodeURIComponent(id)}/versions`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setVersions(d.versions || []); })
        .catch(() => {});
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [id]);

  // Poll real metrics
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch(`/api/agents/${encodeURIComponent(id)}/metrics`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setMetrics(d.metrics || null); })
        .catch(() => {});
    };
    tick();
    const interval = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch(`/api/agents?hours=${timeRange.hours}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          const match = (d.agents || []).find((a: { agentName: string }) => a.agentName === id);
          if (match) {
            setWorkerInfo({
              concurrentSessions: match.concurrentSessions || 0,
              participantIdentities: match.participantIdentities || [],
              region: match.region || "local",
              pid: match.pid ?? null,
              workerId: match.workerId ?? null,
            });
          }
          // Note: per-agent history is fetched separately below; do not overwrite here.
        })
        .catch(() => {});
    };
    tick();
    const interval = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [id, timeRange.hours]);

  // Poll running status
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch(`/api/agents/${encodeURIComponent(id)}/logs`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setRunning(!!d.running); })
        .catch(() => {});
    };
    tick();
    const interval = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [id]);

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await fetch(`/api/agents/${encodeURIComponent(id)}/stop`, { method: "POST" });
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}/restart`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRestartResult({ success: false, message: data.error || "Unknown error" });
      } else {
        setRestartResult({ success: true, message: `Agent "${id}" restarted successfully.`, pid: data.pid });
      }
    } finally {
      setRestarting(false);
    }
  };

  const [restartResult, setRestartResult] = useState<{ success: boolean; message: string; pid?: number } | null>(null);

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
        breadcrumb={[{ label: "Agents", href: "/agents" }]}
        showRefresh
        actions={
          <div className="flex items-center gap-2">
            {running ? (
              <Badge variant="outline" className="gap-1.5 border-emerald-500/30 text-emerald-500">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                ONLINE
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground" />
                OFFLINE
              </Badge>
            )}
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
                <DropdownMenuItem onClick={() => setLogsOpen(true)}>
                  <ScrollText className="size-4" />
                  View logs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRestart} disabled={restarting}>
                  {restarting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCw className="size-4" />
                  )}
                  Restart
                </DropdownMenuItem>
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
          <StatCard
            label="Agent Name"
            value={id}
            infoText="Human-readable name for this agent worker."
          />
          <Card className="py-4">
            <CardContent className="px-5 py-0">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm text-muted-foreground">Agent ID</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                      <Info className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Unique participant identity assigned to this agent in active sessions.
                  </TooltipContent>
                </Tooltip>
              </div>
              <span className="text-sm font-mono text-foreground break-all">
                {workerInfo?.workerId
                  || workerInfo?.participantIdentities?.[0]
                  || (workerInfo?.pid ? `pid:${workerInfo.pid}` : "—")}
              </span>
            </CardContent>
          </Card>
          <StatCard
            label="Concurrent Agent Sessions"
            value={workerInfo?.concurrentSessions ?? 0}
            infoText="Number of currently active sessions for this agent."
          />
          <StatCard
            label="Agent Region"
            value={workerInfo?.region || "local"}
            infoText="Region where this agent worker is running."
          />
        </div>

        {/* Overview */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Overview</h2>
            <TimeRangePicker value={timeRange} onChange={setTimeRange} />
          </div>

          <Card className="py-0">
            <CardContent className="p-5">
              <h3 className="text-sm text-muted-foreground mb-4">Sessions served</h3>
              {history.length > 1 ? (
                <MultiLineChart
                  series={[
                    { data: history.map((h) => h.sessions), color: "var(--primary)", label: `${id} sessions` },
                    { data: history.map((h) => h.agents), color: "var(--secondary)", label: `${id} online`, dashed: true },
                  ]}
                  labels={history.map((h) => h.time)}
                  height={180}
                  viewBoxWidth={900}
                  fontSize={7}
                />
              ) : (
                <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
                  Chart will populate as data is collected.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="Agent Uptime"
              value={metrics?.uptimeReadable || "—"}
              infoText="How long the agent process has been running on this host."
            />
            <Card className="py-4">
              <CardContent className="px-5 py-0">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-sm text-muted-foreground">Agent LLM Latency</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                        <Info className="size-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Time-to-first-token from the LLM, parsed from agent logs. Only populated when the agent has emitted llm_metrics events.
                    </TooltipContent>
                  </Tooltip>
                </div>
                {metrics?.llmLatency ? (
                  <>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-1">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-primary" />
                        p50 <span className="font-mono text-foreground">{metrics.llmLatency.p50}ms</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: "var(--secondary)" }} />
                        p90 <span className="font-mono text-foreground">{metrics.llmLatency.p90}ms</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: "var(--chart-2)" }} />
                        p99 <span className="font-mono text-foreground">{metrics.llmLatency.p99}ms</span>
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      based on {metrics.llmLatency.samples} samples
                    </p>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">
                    No llm_metrics in logs yet
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="px-5 py-0">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-sm text-muted-foreground">Average Load</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                        <Info className="size-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Live CPU and memory usage of the agent worker process, sampled every 3 seconds.
                    </TooltipContent>
                  </Tooltip>
                </div>
                {metrics ? (
                  <div className="space-y-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-semibold text-primary">{metrics.cpuPercent}</span>
                      <span className="text-xs text-muted-foreground">% CPU</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono text-foreground">{metrics.memoryMb}</span> MB ({metrics.memoryPercent}% of system)
                    </p>
                  </div>
                ) : (
                  <span className="text-2xl font-semibold text-muted-foreground">—</span>
                )}
              </CardContent>
            </Card>
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
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => openEditSecret(s)}
                              title="Update secret"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteSecretKey(s.key)}
                              title="Delete secret"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
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
                  {versions.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                        No deployments yet. Click <span className="text-foreground font-medium">Deploy</span> in the agent builder to create the first version.
                      </td>
                    </tr>
                  ) : (
                    versions.map((v, i) => (
                      <tr key={v.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-foreground">v{v.version}</span>
                            {i === 0 && (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-[10px] uppercase tracking-wider">
                                Current
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-foreground">{v.deployerName || v.deployerEmail}</span>
                            {v.deployerName && v.deployerName !== v.deployerEmail && (
                              <span className="text-xs text-muted-foreground">{v.deployerEmail}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {new Date(v.createdAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))
                  )}
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

      {/* Restart result dialog */}
      <Dialog open={!!restartResult} onOpenChange={(open) => !open && setRestartResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={restartResult?.success ? "text-emerald-500" : "text-destructive"}>
              {restartResult?.success ? "Restart successful" : "Restart failed"}
            </DialogTitle>
            <DialogDescription>
              {restartResult?.message}
              {restartResult?.success && restartResult.pid && (
                <span className="block mt-2 text-xs font-mono">PID: {restartResult.pid}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setRestartResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs viewer */}
      {logsOpen && <AgentLogViewer name={id} onClose={() => setLogsOpen(false)} />}

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
