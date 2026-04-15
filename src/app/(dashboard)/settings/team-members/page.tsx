"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2, UserPlus, Copy, Check, Trash2 } from "lucide-react";

interface Member {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  company: string | null;
  role: string;
  createdAt: string;
}

interface CurrentUser {
  id?: number;
  role: string;
}

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  member: "outline",
};

export default function TeamMembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteError, setInviteError] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const fetchMembers = () => {
    fetch("/api/auth/users")
      .then((res) => res.json())
      .then((data) => setMembers(data.users ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchMembers();
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => { if (data?.user) setCurrentUser(data.user); });
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError("");
    setInviteLoading(true);

    try {
      const res = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await res.json();

      if (!res.ok) {
        setInviteError(data.error || "Failed to create invite");
        return;
      }

      setInviteUrl(data.inviteUrl);
    } catch {
      setInviteError("Something went wrong");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleDelete = async (userId: number) => {
    if (!confirm("Are you sure you want to remove this member?")) return;

    const res = await fetch("/api/auth/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId }),
    });

    if (res.ok) {
      fetchMembers();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to remove member");
    }
  };

  const canDelete = (member: Member) => {
    if (!currentUser) return false;
    // Only owner and admin can delete
    if (currentUser.role !== "owner" && currentUser.role !== "admin") return false;
    // Can't delete yourself
    if (member.id === currentUser.id) return false;
    // Admin can't delete owners
    if (currentUser.role === "admin" && member.role === "owner") return false;
    return true;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetDialog = () => {
    setInviteEmail("");
    setInviteRole("member");
    setInviteError("");
    setInviteUrl("");
    setCopied(false);
  };

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }

  const isOwner = currentUser?.role === "owner";

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Team members"
        breadcrumb={[{ label: "Settings", href: "/settings/project" }]}
        actions={
          isOwner ? (
            <Button size="sm" onClick={() => { resetDialog(); setDialogOpen(true); }}>
              <UserPlus className="size-4" />
              Invite member
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Name</th>
                      <th className="px-4 py-2.5 font-medium">Email</th>
                      <th className="px-4 py-2.5 font-medium">Role</th>
                      <th className="px-4 py-2.5 font-medium">Joined</th>
                      <th className="px-4 py-2.5 font-medium w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Avatar className="size-7">
                              <AvatarFallback className="text-xs">
                                {m.firstName.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-foreground font-medium">
                              {m.firstName} {m.lastName}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-foreground/70">
                          {m.email}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={roleBadgeVariant[m.role] ?? "outline"}>
                            {m.role.charAt(0).toUpperCase() + m.role.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {formatDate(m.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          {canDelete(m) && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => handleDelete(m.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {members.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                          No members found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invite Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>
              {inviteUrl
                ? "Share this invite link with your team member. It expires in 7 days."
                : "Enter the email and select a role. An invite link will be generated for the user to register."}
            </DialogDescription>
          </DialogHeader>

          {inviteUrl ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Invite link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={inviteUrl} className="text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleCopy}
                  >
                    {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => { setDialogOpen(false); fetchMembers(); }}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-4">
              {inviteError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {inviteError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="john@company.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">
                      Admin — manage agents, telephony, settings
                    </SelectItem>
                    <SelectItem value="member">
                      Member — view-only access
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={inviteLoading}>
                  {inviteLoading && <Loader2 className="size-4 animate-spin" />}
                  Generate invite link
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
