"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  Check,
  User,
  Building2,
  Github,
  Chrome,
} from "lucide-react";

export default function RegisterPage() {
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const getPasswordStrength = (pw: string) => {
    let strength = 0;
    if (pw.length >= 8) strength++;
    if (/[A-Z]/.test(pw)) strength++;
    if (/[0-9]/.test(pw)) strength++;
    if (/[^A-Za-z0-9]/.test(pw)) strength++;
    return strength;
  };

  const passwordStrength = getPasswordStrength(password);
  const strengthLabel = ["", "Weak", "Fair", "Good", "Strong"][passwordStrength];
  const strengthColor =
    passwordStrength >= 3
      ? "bg-green-500"
      : passwordStrength === 2
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <div className="flex min-h-screen">
      {/* Left — Branding Panel */}
      <div className="hidden w-2/5 flex-col justify-between bg-foreground p-10 lg:flex">
        <div>
          <span className="text-xl font-bold tracking-tight text-background">
            Live<span className="text-primary">Kit</span>
          </span>
        </div>
        <div>
          <h2 className="text-3xl font-bold text-background">
            Start building today
          </h2>
          <p className="mt-3 max-w-sm text-sm text-background/60">
            Create your account and deploy real-time audio, video, and data
            experiences in minutes.
          </p>
          <div className="mt-8 space-y-4">
            {[
              {
                title: "100% open source",
                desc: "Self-host with full control",
              },
              {
                title: "Full API access",
                desc: "Rooms, agents, egress & ingress",
              },
              {
                title: "Team collaboration",
                desc: "Invite unlimited team members",
              },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px]">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
                <div>
                  <div className="text-sm font-medium text-background">
                    {item.title}
                  </div>
                  <div className="text-xs text-background/50">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-background/40">
          &copy; {new Date().getFullYear()} LiveKit Inc. All rights reserved.
        </p>
      </div>

      {/* Right — Registration Form */}
      <div className="flex w-full flex-col items-center justify-center bg-background px-6 lg:w-3/5 lg:px-16">
        {/* Mobile logo */}
        <div className="mb-8 lg:hidden">
          <span className="text-xl font-bold tracking-tight text-foreground">
            Live<span className="text-primary">Kit</span>
          </span>
        </div>

        <div className="w-full max-w-[440px]">
          <h1 className="mb-1 text-2xl font-semibold text-foreground">
            Create your account
          </h1>
          <p className="mb-8 text-sm text-muted-foreground">
            Get started with LiveKit Cloud in minutes
          </p>

          {/* Social Sign-up */}
          <div className="mb-6 flex gap-3">
            <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted">
              <Chrome className="h-4 w-4" />
              Google
            </button>
            <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted">
              <Github className="h-4 w-4" />
              GitHub
            </button>
          </div>

          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">
              or register with email
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Name Row */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                First name
              </label>
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all ${
                  focusedField === "first"
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border"
                }`}
              >
                <User className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  onFocus={() => setFocusedField("first")}
                  onBlur={() => setFocusedField(null)}
                  placeholder="John"
                  className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Last name
              </label>
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all ${
                  focusedField === "last"
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border"
                }`}
              >
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onFocus={() => setFocusedField("last")}
                  onBlur={() => setFocusedField(null)}
                  placeholder="Doe"
                  className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          </div>

          {/* Email */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Work email
            </label>
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all ${
                focusedField === "email"
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border"
              }`}
            >
              <Mail className="h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                placeholder="name@company.com"
                className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Company */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Company{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all ${
                focusedField === "company"
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border"
              }`}
            >
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                onFocus={() => setFocusedField("company")}
                onBlur={() => setFocusedField(null)}
                placeholder="Acme Inc."
                className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Password */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Password
            </label>
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all ${
                focusedField === "password"
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border"
              }`}
            >
              <Lock className="h-4 w-4 text-muted-foreground" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                placeholder="Create a strong password"
                className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {password.length > 0 && (
              <>
                <div className="mt-2 flex gap-1">
                  {[1, 2, 3, 4].map((s) => (
                    <div
                      key={s}
                      className={`h-1 flex-1 rounded-full ${
                        s <= passwordStrength ? strengthColor : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
                <p
                  className={`mt-1 text-xs ${
                    passwordStrength >= 3
                      ? "text-green-500"
                      : passwordStrength === 2
                        ? "text-yellow-500"
                        : "text-red-500"
                  }`}
                >
                  {strengthLabel} password
                </p>
              </>
            )}
          </div>

          {/* Confirm Password */}
          <div className="mb-5">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Confirm password
            </label>
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all ${
                focusedField === "confirm"
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border"
              }`}
            >
              <Lock className="h-4 w-4 text-muted-foreground" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onFocus={() => setFocusedField("confirm")}
                onBlur={() => setFocusedField(null)}
                placeholder="Repeat your password"
                className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              />
              {confirmPassword.length > 0 && password === confirmPassword && (
                <Check className="h-4 w-4 text-green-500" />
              )}
            </div>
          </div>

          {/* Terms */}
          <label
            className="mb-6 flex cursor-pointer items-start gap-2 text-sm"
            onClick={() => setAgreedTerms(!agreedTerms)}
          >
            <div
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] transition-colors ${
                agreedTerms
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border"
              }`}
            >
              {agreedTerms && <Check className="h-3 w-3" />}
            </div>
            <span className="text-muted-foreground">
              I agree to the{" "}
              <span className="cursor-pointer text-primary underline">
                Terms of Service
              </span>{" "}
              and{" "}
              <span className="cursor-pointer text-primary underline">
                Privacy Policy
              </span>
            </span>
          </label>

          {/* Submit */}
          <button className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Create account
          </button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-primary hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
