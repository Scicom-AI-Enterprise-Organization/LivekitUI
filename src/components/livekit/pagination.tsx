"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Offset paging for a server-paged list.
 *
 * Offsets rather than page numbers, because that is what the list endpoints
 * take (`?limit=&offset=`). Page numbers exist only in this component's own
 * arithmetic.
 */

/** Page sizes offered. Capped at the API's own `MAX_LIMIT`. */
export const PAGE_SIZES = [25, 50, 100, 200] as const;

interface PaginationProps {
  total: number;
  offset: number;
  pageSize: number;
  loading?: boolean;
  onOffsetChange: (offset: number) => void;
  onPageSizeChange?: (size: number) => void;
  className?: string;
}

/**
 * Page numbers to render: always the first and last, the current and its
 * neighbours, and `null` where a run was elided.
 */
function pageWindow(current: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, pageCount, current, current - 1, current + 1]);
  // Keep the bar a stable width when the current page sits at either end.
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => pages.add(p));

  const sorted = Array.from(pages)
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b);

  const withGaps: (number | null)[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) withGaps.push(null);
    withGaps.push(page);
    previous = page;
  }
  return withGaps;
}

export function Pagination({
  total,
  offset,
  pageSize,
  loading = false,
  onOffsetChange,
  onPageSizeChange,
  className,
}: PaginationProps) {
  if (total === 0) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(pageCount, Math.floor(offset / pageSize) + 1);
  const first = offset + 1;
  const last = Math.min(offset + pageSize, total);
  const goto = (page: number) => onOffsetChange((Math.max(1, Math.min(pageCount, page)) - 1) * pageSize);

  return (
    <div
      className={cn(
        "mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <span>
          {first}–{last} of {total}
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs">Rows</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger size="sm" className="h-8 w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={current === 1 || loading}
            onClick={() => goto(1)}
            aria-label="First page"
          >
            <ChevronsLeft className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={current === 1 || loading}
            onClick={() => goto(current - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" />
          </Button>

          {pageWindow(current, pageCount).map((page, i) =>
            page === null ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={page}
                variant={page === current ? "default" : "outline"}
                size="icon-sm"
                disabled={loading}
                onClick={() => goto(page)}
                aria-label={`Page ${page}`}
                aria-current={page === current ? "page" : undefined}
                className="min-w-8 px-2 font-mono text-xs tabular-nums"
              >
                {page}
              </Button>
            )
          )}

          <Button
            variant="outline"
            size="icon-sm"
            disabled={current === pageCount || loading}
            onClick={() => goto(current + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={current === pageCount || loading}
            onClick={() => goto(pageCount)}
            aria-label="Last page"
          >
            <ChevronsRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
