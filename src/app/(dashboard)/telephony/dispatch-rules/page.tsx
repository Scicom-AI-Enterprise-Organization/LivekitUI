"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/livekit/top-bar";
import { DataTable } from "@/components/livekit/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useApiList } from "@/hooks/use-api-list";
import { ListError, ListLoading, ServiceNotice } from "@/components/livekit/list-state";
import { DispatchRuleDialog } from "@/components/livekit/dispatch-rule-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

interface DispatchRule {
  ruleId: string;
  name: string;
  type: string | null;
  roomName: string | null;
  roomPrefix: string | null;
  trunkIds: string[];
  inboundNumbers: string[];
  hidePhoneNumber: boolean;
  agents: string[];
}

const columns = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "target", label: "Room / Prefix" },
  { key: "trunks", label: "Trunks" },
  { key: "numbers", label: "Numbers" },
  { key: "agent", label: "Agent" },
  { key: "actions", label: "" },
];

export default function DispatchRulesPage() {
  return (
    <Suspense fallback={null}>
      <DispatchRulesContent />
    </Suspense>
  );
}

function DispatchRulesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?rule=new creates; ?rule=<id> edits that rule.
  const ruleParam = searchParams.get("rule");
  const [deleteTarget, setDeleteTarget] = useState<DispatchRule | null>(null);

  const setRuleParam = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (value) params.set("rule", value);
      else params.delete("rule");
      const qs = params.toString();
      router.replace(qs ? `/telephony/dispatch-rules?${qs}` : "/telephony/dispatch-rules", { scroll: false });
    },
    [router]
  );

  const { items, loading, error, notice, reload } = useApiList<DispatchRule>("/api/dispatch-rules", "rules");

  const editing = ruleParam && ruleParam !== "new" ? items.find((r) => r.ruleId === ruleParam) : undefined;
  const dialogOpen = ruleParam === "new" || !!editing;

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await fetch(`/api/dispatch-rules/${encodeURIComponent(deleteTarget.ruleId)}`, { method: "DELETE" }).catch(
      () => {}
    );
    setDeleteTarget(null);
    reload();
  };

  const rows = items.map((r) => ({
    id: <span className="font-mono text-xs">{r.ruleId}</span>,
    name: r.name || "—",
    type: (
      <Badge variant="outline" className="text-muted-foreground">
        {r.type === "dispatchRuleDirect" ? "direct" : r.type === "dispatchRuleIndividual" ? "individual" : "—"}
      </Badge>
    ),
    target: r.roomName || (r.roomPrefix ? `${r.roomPrefix}*` : "—"),
    trunks: r.trunkIds?.length ? r.trunkIds.join(", ") : "all",
    numbers: r.inboundNumbers?.length ? r.inboundNumbers.join(", ") : "any",
    agent: r.agents?.length ? (
      r.agents.join(", ")
    ) : (
      <span className="text-yellow-600 dark:text-yellow-500" title="Callers reach an empty room">
        none
      </span>
    ),
    actions: (
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          title="Edit"
          onClick={() => setRuleParam(r.ruleId)}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive"
          title="Delete"
          onClick={() => setDeleteTarget(r)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    ),
  }));

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Dispatch rules"
        breadcrumb={[{ label: "Telephony", href: "/telephony/calls" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={reload}>
              <RefreshCw className="size-3" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setRuleParam("new")}>
              Create new rule
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {error && <ListError message={error} />}
        {notice && <ServiceNotice message={notice.message} reason={notice.reason} />}

        {loading ? (
          <ListLoading />
        ) : notice ? null : (
          <DataTable columns={columns} data={rows} emptyMessage="No dispatch rules." />
        )}
      </div>
      {dialogOpen && (
        <DispatchRuleDialog
          key={ruleParam}
          rule={editing ?? null}
          onClose={() => setRuleParam(null)}
          onSaved={() => {
            setRuleParam(null);
            reload();
          }}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete dispatch rule</DialogTitle>
            <DialogDescription>
              Delete <span className="font-medium">{deleteTarget?.name || deleteTarget?.ruleId}</span>? Calls
              it routed will fall through to another matching rule, or go unanswered if there is none.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
