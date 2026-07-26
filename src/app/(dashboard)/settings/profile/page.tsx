"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Loader2, Check } from "lucide-react";
import { LoginTypeBadge } from "@/components/livekit/login-type-badge";

const MIN_PASSWORD_LENGTH = 8;

interface Profile {
  id?: number;
  email: string;
  firstName: string;
  lastName: string;
  company?: string;
  role: string;
  authProvider?: string;
  createdAt?: string;
}

export default function ProfileSettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setProfile(data.user);
          setFirstName(data.user.firstName ?? "");
          setLastName(data.user.lastName ?? "");
          setCompany(data.user.company ?? "");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const loginType = profile?.authProvider ?? "local";
  const isLocal = loginType === "local";

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError("");
    setProfileSaved(false);
    setSavingProfile(true);

    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, company }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileError(data.error || "Failed to save profile");
        return;
      }
      if (data.user) setProfile(data.user);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch {
      setProfileError("Something went wrong");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSaved(false);

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error || "Failed to change password");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 4000);
    } catch {
      setPasswordError("Something went wrong");
    } finally {
      setSavingPassword(false);
    }
  };

  function formatDate(dateStr?: string) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return isNaN(d.getTime())
      ? "—"
      : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Profile"
        breadcrumb={[{ label: "Settings", href: "/settings/project" }]}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !profile ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load your profile.
          </div>
        ) : (
          <>
            {/* Account */}
            <Card>
              <CardHeader>
                <CardTitle>Account</CardTitle>
                <CardDescription>
                  How you sign in to this workspace.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    <AvatarFallback>
                      {profile.firstName.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {profile.firstName} {profile.lastName}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {profile.email}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-foreground/70">Role</Label>
                    <div>
                      <Badge variant={profile.role === "owner" ? "default" : "secondary"}>
                        {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-foreground/70">Login type</Label>
                    <div>
                      <LoginTypeBadge type={loginType} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-foreground/70">Member since</Label>
                    <div className="text-sm text-muted-foreground">
                      {formatDate(profile.createdAt)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Personal details */}
            <Card>
              <CardHeader>
                <CardTitle>Personal details</CardTitle>
                <CardDescription>
                  Your name as it appears across the dashboard.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={saveProfile} className="space-y-5">
                  {profileError && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {profileError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-foreground/70">First name</Label>
                      <Input
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-foreground/70">Last name</Label>
                      <Input
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-foreground/70">Company</Label>
                    <Input
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-foreground/70">Email</Label>
                    <Input value={profile.email} readOnly disabled />
                    <p className="text-xs text-muted-foreground">
                      Email is your login and cannot be changed here.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button type="submit" size="sm" disabled={savingProfile}>
                      {savingProfile && <Loader2 className="size-4 animate-spin" />}
                      Save changes
                    </Button>
                    {profileSaved && (
                      <span className="flex items-center gap-1 text-sm text-green-500">
                        <Check className="size-4" /> Saved
                      </span>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Password */}
            <Card>
              <CardHeader>
                <CardTitle>Password</CardTitle>
                <CardDescription>
                  {isLocal
                    ? "Changing your password signs you out on all other devices."
                    : "This account signs in through an identity provider."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!isLocal ? (
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    Your password is managed by <LoginTypeBadge type={loginType} />. Change
                    it with that provider instead.
                  </div>
                ) : (
                  <form onSubmit={savePassword} className="space-y-5">
                    {passwordError && (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {passwordError}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label className="text-foreground/70">Current password</Label>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-foreground/70">New password</Label>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          minLength={MIN_PASSWORD_LENGTH}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-foreground/70">Confirm new password</Label>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          minLength={MIN_PASSWORD_LENGTH}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      At least {MIN_PASSWORD_LENGTH} characters.
                    </p>

                    <div className="flex items-center gap-3">
                      <Button type="submit" size="sm" disabled={savingPassword}>
                        {savingPassword && <Loader2 className="size-4 animate-spin" />}
                        Update password
                      </Button>
                      {passwordSaved && (
                        <span className="flex items-center gap-1 text-sm text-green-500">
                          <Check className="size-4" /> Password updated
                        </span>
                      )}
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
