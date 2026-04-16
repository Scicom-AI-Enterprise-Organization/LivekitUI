"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { TimeRangePicker, type TimeRangeValue, DEFAULT_TIME_RANGE } from "./time-range-picker";
import { useState } from "react";

type BreadcrumbItem = string | { label: string; href: string };

interface TopBarProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  children?: React.ReactNode;
  showRefresh?: boolean;
  showTimeRange?: boolean;
  timeRange?: TimeRangeValue;
  onTimeRangeChange?: (v: TimeRangeValue) => void;
  className?: string;
  actions?: React.ReactNode;
}

export function TopBar({
  title,
  breadcrumb,
  children,
  showRefresh = false,
  showTimeRange = false,
  timeRange,
  onTimeRangeChange,
  className,
  actions,
}: TopBarProps) {
  const [internalRange, setInternalRange] = useState<TimeRangeValue>(DEFAULT_TIME_RANGE);
  const rangeValue = timeRange ?? internalRange;
  const handleRangeChange = onTimeRangeChange ?? setInternalRange;
  return (
    <div className={cn("flex items-center justify-between border-b px-6 py-3", className)}>
      <div className="flex items-center gap-2">
        {breadcrumb && breadcrumb.length > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {breadcrumb.map((crumb, i) => {
              const isObj = typeof crumb === "object";
              const label = isObj ? crumb.label : crumb;
              const href = isObj ? crumb.href : null;
              return (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span>/</span>}
                  {href ? (
                    <Link href={href} className="hover:text-foreground transition-colors">
                      {label}
                    </Link>
                  ) : (
                    <span>{label}</span>
                  )}
                </span>
              );
            })}
            <span>/</span>
          </div>
        )}
        <h1 className="text-base font-semibold">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {children}
        {showRefresh && (
          <Select defaultValue="off">
            <SelectTrigger size="sm" className="text-xs">
              <RefreshCw className="size-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Auto-refresh off</SelectItem>
              <SelectItem value="5s">Every 5s</SelectItem>
              <SelectItem value="30s">Every 30s</SelectItem>
              <SelectItem value="1m">Every 1m</SelectItem>
            </SelectContent>
          </Select>
        )}
        {showTimeRange && (
          <TimeRangePicker value={rangeValue} onChange={handleRangeChange} />
        )}
        {actions}
      </div>
    </div>
  );
}
