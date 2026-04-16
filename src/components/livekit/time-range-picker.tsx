"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface TimeRangeValue {
  hours: number;
  label: string;
  custom?: { from: number; to: number };
}

const QUICK_RANGES: { label: string; hours: number }[] = [
  { label: "Past hour", hours: 1 },
  { label: "Past 3 hours", hours: 3 },
  { label: "Past 6 hours", hours: 6 },
  { label: "Past 12 hours", hours: 12 },
  { label: "Past 24 hours", hours: 24 },
  { label: "Past 7 days", hours: 24 * 7 },
  { label: "Past 30 days", hours: 24 * 30 },
  { label: "Past 60 days", hours: 24 * 60 },
];

function formatLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TimeRangePicker({
  value,
  onChange,
}: {
  value: TimeRangeValue;
  onChange: (v: TimeRangeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [from, setFrom] = useState(() => formatLocalInput(new Date(Date.now() - 24 * 3600 * 1000)));
  const [to, setTo] = useState(() => formatLocalInput(new Date()));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCustom(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const applyCustom = () => {
    const f = new Date(from).getTime();
    const t = new Date(to).getTime();
    if (isNaN(f) || isNaN(t) || t <= f) return;
    const hours = Math.max(1, Math.ceil((t - f) / 3_600_000));
    onChange({
      hours,
      label: `${new Date(f).toLocaleDateString()} – ${new Date(t).toLocaleDateString()}`,
      custom: { from: f, to: t },
    });
    setOpen(false);
    setShowCustom(false);
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        className="text-xs gap-1.5"
        onClick={() => setOpen((v) => !v)}
      >
        <Clock className="size-3" />
        <span>{value.label}</span>
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 flex rounded-md border border-border bg-popover shadow-lg">
          {showCustom && (
            <div className="w-64 border-r border-border p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Custom range
              </div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">From</label>
                  <Input
                    type="datetime-local"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">To</label>
                  <Input
                    type="datetime-local"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <Button size="sm" className="w-full" onClick={applyCustom}>
                  Apply range
                </Button>
              </div>
            </div>
          )}

          <div className="flex w-56 flex-col py-2">
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Quick ranges
            </div>
            {QUICK_RANGES.map((r) => {
              const selected = !value.custom && value.hours === r.hours;
              return (
                <button
                  key={r.label}
                  className={cn(
                    "flex items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent",
                    selected && "font-medium text-foreground"
                  )}
                  onClick={() => {
                    onChange({ hours: r.hours, label: r.label });
                    setOpen(false);
                    setShowCustom(false);
                  }}
                >
                  <span>{r.label}</span>
                  {selected && <Check className="size-3.5 text-primary" />}
                </button>
              );
            })}
            <div className="my-1 border-t border-border" />
            <button
              className={cn(
                "px-3 py-1.5 text-left text-sm hover:bg-accent",
                (showCustom || value.custom) && "font-medium text-foreground"
              )}
              onClick={() => setShowCustom((v) => !v)}
            >
              Custom range
            </button>
            <div className="border-t border-border px-3 pt-2 mt-1 text-[11px] text-muted-foreground">
              Local timezone: {tz}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const DEFAULT_TIME_RANGE: TimeRangeValue = { hours: 24 * 7, label: "Past 7 days" };
