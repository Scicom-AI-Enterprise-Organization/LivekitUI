"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  Check,
  Github,
  Chrome,
} from "lucide-react";

export default function LoginPage() {
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="flex min-h-screen">
      {/* Left — Branding Panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-foreground p-10 lg:flex">
        <div>
          <span className="text-xl font-bold tracking-tight text-background">
            Live<span className="text-primary">Kit</span>
          </span>
        </div>
        <div>
          <h2 className="text-3xl font-bold text-background">
            Welcome back
          </h2>
          <p className="mt-3 max-w-sm text-sm text-background/60">
            Sign in to access your rooms, manage agents, and monitor your
            real-time infrastructure.
          </p>
          <div className="mt-8 flex gap-6">
            <div>
              <div className="text-2xl font-bold text-background">99.9%</div>
              <div className="text-xs text-background/50">Uptime SLA</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-background">50ms</div>
              <div className="text-xs text-background/50">Avg latency</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-background">10M+</div>
              <div className="text-xs text-background/50">Minutes served</div>
            </div>
          </div>
        </div>
        <p className="text-xs text-background/40">
          &copy; {new Date().getFullYear()} LiveKit Inc. All rights reserved.
        </p>
      </div>

      {/* Right — Login Form */}
      <div className="flex w-full flex-col items-center justify-center bg-background px-6 lg:w-1/2 lg:px-16">
        {/* Mobile logo */}
        <div className="mb-8 lg:hidden">
          <span className="text-xl font-bold tracking-tight text-foreground">
            Live<span className="text-primary">Kit</span>
          </span>
        </div>

        <div className="w-full max-w-[380px]">
          <h1 className="mb-1 text-2xl font-semibold text-foreground">
            Sign in
          </h1>
          <p className="mb-8 text-sm text-muted-foreground">
            Enter your credentials to access your dashboard
          </p>

          {/* Social Login */}
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
              or continue with email
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Email */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Email
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

          {/* Password */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">
                Password
              </label>
              <Link
                href="#"
                className="text-xs text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
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
                placeholder="Enter your password"
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
          </div>

          {/* Remember Me */}
          <label
            className="mb-6 flex cursor-pointer items-center gap-2 text-sm"
            onClick={() => setRememberMe(!rememberMe)}
          >
            <div
              className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] transition-colors ${
                rememberMe
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border"
              }`}
            >
              {rememberMe && <Check className="h-3 w-3" />}
            </div>
            <span className="text-muted-foreground">Remember me</span>
          </label>

          {/* Submit */}
          <button className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Sign in
          </button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-medium text-primary hover:underline"
            >
              Create account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
