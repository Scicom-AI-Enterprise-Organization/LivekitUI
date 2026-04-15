"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/livekit/top-bar";
import { StatCard } from "@/components/livekit/stat-card";
import { MultiLineChart } from "@/components/livekit/line-chart";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Search,
  Rocket,
  Loader2,
  RefreshCw,
  Bot,
  Trash2,
  ScrollText,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? "Pause" : "Resume"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={fetchLogs}
              disabled={fetching}
            >
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

interface AgentWorker {
  agentName: string;
  concurrentSessions: number;
  rooms: string[];
  status: string;
}

interface AgentSession {
  agentName: string;
  roomName: string;
  roomSid: string;
  participantIdentity: string;
  participantSid: string;
  joinedAt: number;
}

interface AgentStats {
  totalAgents: number;
  totalSessions: number;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentWorker[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [stats, setStats] = useState<AgentStats>({ totalAgents: 0, totalSessions: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deleteAgent, setDeleteAgent] = useState<string | null>(null);
  const [logsAgent, setLogsAgent] = useState<string | null>(null);
  const [history, setHistory] = useState<{ time: string; sessions: number; agents: number }[]>([]);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch");
      setAgents(data.agents || []);
      setSessions(data.sessions || []);
      setStats(data.stats || { totalAgents: 0, totalSessions: 0 });

      // Use persisted history from the server
      const h = (data.history || []).map((entry: { time: string; sessions: number; agents: number }) => ({
        time: new Date(entry.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        sessions: entry.sessions,
        agents: entry.agents,
      }));
      setHistory(h);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const confirmDelete = async () => {
    if (!deleteAgent) return;
    await fetch("/api/agents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: deleteAgent }),
    });
    setDeleteAgent(null);
    fetchAgents();
  };

  const filtered = agents.filter((a) =>
    search ? a.agentName.toLowerCase().includes(search.toLowerCase()) : true
  );

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Agents"
        showRefresh
        showTimeRange
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchAgents} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              Refresh
            </Button>
            <Button variant="default" size="sm" asChild>
              <Link href="/agents/builder">
                <Rocket className="size-3" />
                <span>Deploy new agent</span>
              </Link>
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Agents Deployed" value={stats.totalAgents} />
          <StatCard label="Concurrent Agent Sessions" value={stats.totalSessions} />
          <StatCard label="Active Rooms with Agents" value={new Set(sessions.map(s => s.roomName)).size} />
        </div>

        {/* Overview Chart */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Overview</h2>
          <Card className="py-0">
            <CardContent className="p-5">
              <h3 className="text-sm text-muted-foreground mb-4">
                Agent Sessions Served
              </h3>
              {history.length > 1 ? (
                <MultiLineChart
                  series={[
                    {
                      data: history.map((h) => h.sessions),
                      color: "var(--primary)",
                      label: "Active sessions",
                    },
                    {
                      data: history.map((h) => h.agents),
                      color: "var(--secondary)",
                      label: "Agents connected",
                      dashed: true,
                    },
                  ]}
                  labels={history.map((h) => h.time)}
                  height={180}
                />
              ) : (
                <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
                  Chart will populate as data is collected. Hit Refresh to add data points.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Your Agents Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Your agents</h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search agents..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-48 rounded-md border bg-transparent pl-8 pr-3 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <Card className="py-0">
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                <Bot className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {agents.length === 0
                    ? "No agents connected. Start an agent to see it here."
                    : "No agents match your search."}
                </p>
                {agents.length === 0 && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/agents/builder">Deploy an agent</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((agent) => (
                <Card key={agent.agentName} className="py-0 hover:border-primary/40 transition-colors">
                  <CardContent className="p-0">
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/agents/${encodeURIComponent(agent.agentName)}`}
                        className="flex-1 flex items-center justify-between p-4"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-foreground">
                            {agent.agentName}
                          </span>
                          {agent.rooms.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              in: {agent.rooms.join(", ")}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-xs text-muted-foreground">
                              Concurrent sessions
                            </span>
                            <span className="text-sm font-semibold text-foreground">
                              {agent.concurrentSessions}
                            </span>
                          </div>

                          {agent.concurrentSessions > 0 ? (
                            <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 gap-1.5">
                              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Active
                            </Badge>
                          ) : agent.status === "draft" ? (
                            <Badge variant="outline" className="gap-1.5">
                              <span className="size-1.5 rounded-full bg-yellow-500" />
                              Draft
                            </Badge>
                          ) : agent.status === "connected" ? (
                            <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 gap-1.5">
                              <span className="size-1.5 rounded-full bg-emerald-500" />
                              Connected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground gap-1.5">
                              <span className="size-1.5 rounded-full bg-muted-foreground" />
                              Idle
                            </Badge>
                          )}
                        </div>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setLogsAgent(agent.agentName);
                        }}
                      >
                        <ScrollText className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="mr-3 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeleteAgent(agent.agentName);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Active Sessions */}
        {sessions.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Active sessions</h2>
            <Card className="py-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Agent</th>
                    <th className="px-4 py-2.5 font-medium">Room</th>
                    <th className="px-4 py-2.5 font-medium">Participant ID</th>
                    <th className="px-4 py-2.5 font-medium">Joined At</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.participantSid} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium">{s.agentName}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.roomName}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {s.participantSid.slice(0, 20)}...
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {s.joinedAt
                          ? new Date(s.joinedAt * 1000).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}
      </div>

      {/* Logs viewer */}
      {logsAgent && <AgentLogViewer name={logsAgent} onClose={() => setLogsAgent(null)} />}

      {/* Delete agent confirmation */}
      <Dialog open={!!deleteAgent} onOpenChange={(open) => !open && setDeleteAgent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-mono text-foreground">{deleteAgent}</span>? This can not be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAgent(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
