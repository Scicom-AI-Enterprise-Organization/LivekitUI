"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/livekit/top-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Plus,
  Phone,
  Trash2,
  Loader2,
  Download,
  PhoneCall,
  MessageSquare,
} from "lucide-react";

interface PhoneNumber {
  id: number;
  number: string;
  label: string | null;
  provider: string;
  capabilities: { voice: boolean; sms: boolean };
  createdAt: string;
}

interface Provider {
  id: string;
  name: string;
  configured: boolean;
}

interface CurrentUser {
  role: string;
}

export default function PhoneNumbersPage() {
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Manual add form
  const [manualNumber, setManualNumber] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  const [manualVoice, setManualVoice] = useState(true);
  const [manualSms, setManualSms] = useState(false);
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // Import
  const [importProvider, setImportProvider] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);
  const [importError, setImportError] = useState("");

  const fetchNumbers = () => {
    fetch("/api/phone-numbers")
      .then((res) => res.json())
      .then((data) => setNumbers(data.numbers ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchNumbers();
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => { if (data?.user) setCurrentUser(data.user); });
    fetch("/api/phone-numbers/providers")
      .then((res) => res.json())
      .then((data) => setProviders(data.providers ?? []));
  }, []);

  const canManage = currentUser?.role === "owner" || currentUser?.role === "admin";

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    setAddLoading(true);

    try {
      const res = await fetch("/api/phone-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: manualNumber,
          label: manualLabel || undefined,
          provider: "manual",
          capabilities: { voice: manualVoice, sms: manualSms },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "Failed to add number");
        return;
      }

      setDialogOpen(false);
      resetForm();
      fetchNumbers();
    } catch {
      setAddError("Something went wrong");
    } finally {
      setAddLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importProvider) return;
    setImportError("");
    setImportResult(null);
    setImportLoading(true);

    try {
      const res = await fetch("/api/phone-numbers/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: importProvider }),
      });

      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error || "Import failed");
        return;
      }

      setImportResult(data);
      fetchNumbers();
    } catch {
      setImportError("Something went wrong");
    } finally {
      setImportLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this phone number?")) return;

    const res = await fetch("/api/phone-numbers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (res.ok) fetchNumbers();
  };

  const resetForm = () => {
    setManualNumber("");
    setManualLabel("");
    setManualVoice(true);
    setManualSms(false);
    setAddError("");
    setImportProvider("");
    setImportResult(null);
    setImportError("");
  };

  const providerLabel: Record<string, string> = {
    manual: "Manual",
    twilio: "Twilio",
    vonage: "Vonage",
    telnyx: "Telnyx",
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Phone numbers" breadcrumb={["husein", "Telephony"]} />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Phone numbers"
        breadcrumb={["husein", "Telephony"]}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true); }}>
              <Plus className="size-4" />
              Add number
            </Button>
          ) : undefined
        }
      />

      {numbers.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-md">
            <CardContent className="flex flex-col items-center text-center p-8 space-y-4">
              <div className="flex items-center justify-center size-16 rounded-full border bg-card">
                <Phone className="size-7 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">No phone numbers</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Add phone numbers manually or import them from a provider like Twilio, Vonage, or Telnyx.
              </p>
              {canManage && (
                <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
                  <Plus className="size-4" />
                  Add number
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Number</th>
                    <th className="px-4 py-2.5 font-medium">Label</th>
                    <th className="px-4 py-2.5 font-medium">Provider</th>
                    <th className="px-4 py-2.5 font-medium">Capabilities</th>
                    <th className="px-4 py-2.5 font-medium">Added</th>
                    <th className="px-4 py-2.5 font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((n) => (
                    <tr key={n.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium">{n.number}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{n.label || "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline">{providerLabel[n.provider] || n.provider}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1.5">
                          {n.capabilities.voice && (
                            <Badge variant="secondary" className="gap-1">
                              <PhoneCall className="size-3" /> Voice
                            </Badge>
                          )}
                          {n.capabilities.sms && (
                            <Badge variant="secondary" className="gap-1">
                              <MessageSquare className="size-3" /> SMS
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {new Date(n.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5">
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(n.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add / Import Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add phone number</DialogTitle>
            <DialogDescription>
              Add a number manually or import from a configured provider.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="manual">
            <TabsList variant="line">
              <TabsTrigger value="manual">Manual</TabsTrigger>
              <TabsTrigger value="import" disabled={providers.length === 0}>
                Import from provider
              </TabsTrigger>
            </TabsList>

            {/* Manual tab */}
            <TabsContent value="manual">
              <form onSubmit={handleAdd} className="space-y-4 pt-2">
                {addError && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {addError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Phone number</Label>
                  <Input
                    required
                    value={manualNumber}
                    onChange={(e) => setManualNumber(e.target.value)}
                    placeholder="+1 555 123 4567"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Label <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    value={manualLabel}
                    onChange={(e) => setManualLabel(e.target.value)}
                    placeholder="e.g. Support line, Sales"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Capabilities</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={manualVoice}
                        onCheckedChange={(v) => setManualVoice(!!v)}
                      />
                      Voice
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={manualSms}
                        onCheckedChange={(v) => setManualSms(!!v)}
                      />
                      SMS
                    </label>
                  </div>
                </div>

                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button type="submit" disabled={addLoading}>
                    {addLoading && <Loader2 className="size-4 animate-spin" />}
                    Add number
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>

            {/* Import tab */}
            <TabsContent value="import">
              <div className="space-y-4 pt-2">
                {importError && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {importError}
                  </div>
                )}

                {importResult ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border bg-card p-4 text-sm space-y-1">
                      <p className="font-medium">Import complete</p>
                      <p className="text-muted-foreground">
                        {importResult.imported} imported, {importResult.skipped} skipped (already exist), {importResult.total} total from provider
                      </p>
                    </div>
                    <DialogFooter>
                      <Button onClick={() => setDialogOpen(false)}>Done</Button>
                    </DialogFooter>
                  </div>
                ) : providers.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    No providers configured. Add credentials in your <code className="text-xs bg-muted px-1 py-0.5 rounded">.env</code> file for Twilio, Vonage, or Telnyx.
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label>Provider</Label>
                      <Select value={importProvider} onValueChange={setImportProvider}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a provider" />
                        </SelectTrigger>
                        <SelectContent>
                          {providers.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      This will fetch all phone numbers from your {importProvider || "provider"} account and add them.
                      Existing numbers will be skipped.
                    </p>

                    <DialogFooter>
                      <DialogClose asChild>
                        <Button type="button" variant="outline">Cancel</Button>
                      </DialogClose>
                      <Button onClick={handleImport} disabled={!importProvider || importLoading}>
                        {importLoading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                        Import numbers
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
