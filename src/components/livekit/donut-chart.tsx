"use client";

import { cn } from "@/lib/utils";

interface DonutChartProps {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function DonutChart({
  segments,
  size = 100,
  strokeWidth = 8,
  className,
}: DonutChartProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let accumulated = 0;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-muted"
          strokeWidth={strokeWidth}
        />
        {segments.map((segment, i) => {
          const pct = total > 0 ? segment.value / total : 0;
          const dashLength = pct * circumference;
          const dashOffset = -(accumulated / total) * circumference;
          accumulated += segment.value;

          return (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLength} ${circumference - dashLength}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
        {segments.map((segment, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div
              className="size-2 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span>
              {segment.label} {segment.value > 0 && total > 0 ? `${Math.round((segment.value / total) * 100)}%` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
