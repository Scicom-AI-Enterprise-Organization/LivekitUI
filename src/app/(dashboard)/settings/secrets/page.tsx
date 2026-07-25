"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/livekit/top-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Plus, KeyRound, Trash2, Loader2, Pencil, Eye, EyeOff, Copy, Check } from "lucide-react";
import { SECRET_NAME_PATTERN } from "@/lib/providers";

interface Secret {
  name: string;
  description: string | null;
  preview: string;
  value?: string;
  createdAt: string;
  updatedAt: string;
}

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [canReveal, setCanReveal] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Secret | null>(null);

  const fetchSecrets = useCallback(async () => {
    const res = await fetch("/api/secrets");
    const data = await res.json().catch(() => ({}));
    setSecrets(data.secrets ?? []);
    setCanReveal(!!data.canReveal);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSecrets();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setRole(d?.user?.role ?? null))
      .catch(() => {});
  }, [fetchSecrets]);

  const canManage = role === "owner" || role === "admin";

  const openAdd = () => {
    setEditingName(null);
    setFormName("");
    setFormValue("");
    setFormDescription("");
    setFormError("");
    setDialogOpen(true);
  };

  const openEdit = (s: Secret) => {
    setEditingName(s.name);
    setFormName(s.name);
    setFormValue("");
    setFormDescription(s.description || "");
    setFormError("");
    setDialogOpen(true);
  };

  const save = async () => {
    setFormError("");
    const name = formName.trim();
    if (!name) return setFormError("Name is required");
    if (!SECRET_NAME_PATTERN.test(name)) {
      return setFormError("Use environment variable style: letters, digits and underscore, not starting with a digit");
    }
    if (!formValue) return setFormError("Value is required");

    setSaving(true);
    try {
      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value: formValue, description: formDescription }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || "Failed to save secret");
        return;
      }
      setDialogOpen(false);
      // Drop any stale revealed copy of the value we just replaced.
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      fetchSecrets();
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await fetch("/api/secrets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: deleteTarget.name }),
    });
    const data = await res.json().catch(() => ({}));
    setDeleteTarget(null);
    if (res.ok && Array.isArray(data.usedBy) && data.usedBy.length > 0) {
      alert(
        `Secret deleted. It was still referenced by: ${data.usedBy.join(", ")}. Update those providers with a new secret.`
      );
    }
    fetchSecrets();
  };

  const toggleReveal = async (name: string) => {
    if (revealed[name]) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      return;
    }
    const res = await fetch("/api/secrets?reveal=1");
    const data = await res.json().catch(() => ({}));
    const hit = (data.secrets ?? []).find((s: Secret) => s.name === name);
    if (hit?.value !== undefined) {
      setRevealed((prev) => ({ ...prev, [name]: hit.value }));
    }
  };

  const copy = (name: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(name);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Secrets" breadcrumb={[{ label: "Settings", href: "/settings/project" }]} />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Secrets"
        breadcrumb={[{ label: "Settings", href: "/settings/project" }]}
        actions={
          canManage ? (
            <Button size="sm" onClick={openAdd}>
              <Plus className="size-4" />
              Add secret
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Secrets</h2>
          <p className="text-sm text-muted-foreground">
            API keys and other credentials shared across the project. Each secret is written to every deployed
            agent&apos;s <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.local</code> using its name as the
            environment variable, and can be selected as the API key of a{" "}
            <Link href="/settings/providers" className="text-primary hover:underline">
              provider
            </Link>
            .
          </p>
        </div>

        {secrets.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center text-center p-10 space-y-4">
              <div className="flex items-center justify-center size-16 rounded-full border bg-card">
                <KeyRound className="size-7 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No secrets yet</h3>
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                Add a secret such as <code className="rounded bg-muted px-1 py-0.5 text-xs">OPENAI_API_KEY</code> or{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">MY_VLLM_API_KEY</code>, then reference it from a
                provider so your agents can authenticate.
              </p>
              {canManage && (
                <Button onClick={openAdd}>
                  <Plus className="size-4" />
                  Add secret
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Value</th>
                    <th className="px-4 py-2.5 font-medium">Description</th>
                    <th className="px-4 py-2.5 font-medium">Updated</th>
                    <th className="px-4 py-2.5 font-medium w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {secrets.map((s) => (
                    <tr key={s.name} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs font-medium">{s.name}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-muted-foreground break-all">
                            {revealed[s.name] ?? s.preview}
                          </span>
                          {canReveal && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-muted-foreground"
                                onClick={() => toggleReveal(s.name)}
                                title={revealed[s.name] ? "Hide" : "Reveal"}
                              >
                                {revealed[s.name] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                              </Button>
                              {revealed[s.name] && (
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="text-muted-foreground"
                                  onClick={() => copy(s.name, revealed[s.name])}
                                  title="Copy"
                                >
                                  {copied === s.name ? (
                                    <Check className="size-3.5 text-green-500" />
                                  ) : (
                                    <Copy className="size-3.5" />
                                  )}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.description || "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {new Date(s.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        {canManage && (
                          <div className="flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => openEdit(s)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(s)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingName ? "Update secret" : "Add secret"}</DialogTitle>
            <DialogDescription>
              {editingName
                ? "Enter a new value to replace the stored one. Values are never shown in this form."
                : "The name is used verbatim as the environment variable in your deployed agents."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {formError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={formName}
                disabled={!!editingName}
                onChange={(e) => setFormName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                placeholder="MY_VLLM_API_KEY"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Value</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                placeholder={editingName ? "Enter a new value" : "sk-..."}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="e.g. Key for the internal vLLM cluster"
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editingName ? "Update secret" : "Add secret"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete secret</DialogTitle>
            <DialogDescription>
              Delete <span className="font-mono">{deleteTarget?.name}</span>? Agents using it will fail to authenticate
              after their next deploy.
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
