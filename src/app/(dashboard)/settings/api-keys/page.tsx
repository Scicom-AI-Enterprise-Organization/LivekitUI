"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { Copy, Eye, EyeOff, Plus, Trash2, Key, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

interface ApiKey {
  id: string;
  name: string;
  key: string;
  description?: string;
  createdAt: string;
  status: string;
}

interface CreatedKey extends ApiKey {
  secret: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  async function fetchKeys() {
    try {
      const res = await fetch("/api/api-keys");
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchKeys();
  }, []);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      const data = await res.json();
      setCreatedKey(data.key);
      await fetchKeys();
    } catch {
      // handle error
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch("/api/api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await fetchKeys();
    } catch {
      // handle error
    } finally {
      setDeleteId(null);
    }
  }

  function resetDialog() {
    setCreateOpen(false);
    setCreatedKey(null);
    setName("");
    setDescription("");
    setSecretCopied(false);
    setKeyCopied(false);
  }

  function copyToClipboard(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="API keys"
        breadcrumb={["husein", "Settings"]}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            Create API key
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <p className="text-sm text-muted-foreground">
          API keys are used to authenticate with the LiveKit server API. The
          server key is configured via environment variables.
        </p>

        {/* Server key */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground/70">
              Server key
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Key className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">
                    Server API Key
                  </span>
                  <Badge variant="outline">Environment</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Configured via LIVEKIT_API_KEY environment variable
                </p>
              </div>
              <Badge variant="secondary">Active</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Additional keys */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-foreground/70">
              Additional keys
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Loading...
              </p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No additional API keys. Create one to get started.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Name</th>
                      <th className="px-4 py-2.5 font-medium">Key</th>
                      <th className="px-4 py-2.5 font-medium">Created</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-foreground">
                          {k.name}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-foreground/70 text-xs">
                          {k.key}
                        </td>
                        <td className="px-4 py-2.5 text-foreground/70">
                          {new Date(k.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant="secondary">{k.status}</Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteId(k.id)}
                          >
                            <Trash2 className="size-3.5" />
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

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => !open && resetDialog()}>
        <DialogContent>
          {createdKey ? (
            <>
              <DialogHeader>
                <DialogTitle>API key created</DialogTitle>
                <DialogDescription>
                  Your new API key has been created successfully.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-foreground/70">API Key</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      readOnly
                      value={createdKey.key}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() =>
                        copyToClipboard(createdKey.key, setKeyCopied)
                      }
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  {keyCopied && (
                    <p className="text-xs text-primary">Copied!</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-foreground/70">Secret</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      readOnly
                      value={createdKey.secret}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() =>
                        copyToClipboard(createdKey.secret, setSecretCopied)
                      }
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  {secretCopied && (
                    <p className="text-xs text-primary">Copied!</p>
                  )}
                </div>
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                  <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Save this secret — it won&apos;t be shown again.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={resetDialog}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>
                  Create a new API key to authenticate with the LiveKit server
                  API.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="key-name" className="text-foreground/70">
                    Name
                  </Label>
                  <Input
                    id="key-name"
                    type="text"
                    placeholder="My API key"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="key-desc" className="text-foreground/70">
                    Description{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="key-desc"
                    type="text"
                    placeholder="What is this key for?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handleCreate} disabled={creating || !name.trim()}>
                  {creating ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete API key</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this API key? This action cannot be
              undone. Any applications using this key will lose access.
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
