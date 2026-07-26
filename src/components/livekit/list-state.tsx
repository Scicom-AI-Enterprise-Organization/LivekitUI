"use client";

import { Loader2, TriangleAlert, Info } from "lucide-react";

/** Spinner shown while a list page is loading. */
export function ListLoading() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function ListError({ message }: { message: string }) {
  return (
    <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <TriangleAlert className="size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/**
 * The LiveKit service behind this page isn't running. That's a deployment gap,
 * not a failure, so it reads as information rather than an error.
 */
export function ServiceNotice({ message, reason }: { message: string; reason?: string }) {
  return (
    <div className="flex gap-2 rounded-lg border bg-muted/40 p-4 text-sm">
      <Info className="size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{message}</p>
        {reason && <p className="text-muted-foreground">{reason}</p>}
      </div>
    </div>
  );
}
