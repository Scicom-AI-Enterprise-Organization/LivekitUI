/**
 * Tail windows shared by the logs API and the viewer, so the URL values and
 * the byte sizes can't drift apart.
 */

export type TailSize = "10kb" | "50kb" | "100kb" | "all";

/** Bytes to read from the end of the file; null means the whole file. */
export const TAIL_SIZES: Record<TailSize, number | null> = {
  "10kb": 10 * 1024,
  "50kb": 50 * 1024,
  "100kb": 100 * 1024,
  all: null,
};

/** Small by default: opening the viewer shouldn't pull a huge log over the wire. */
export const DEFAULT_TAIL: TailSize = "10kb";

export const TAIL_OPTIONS: { value: TailSize; label: string }[] = [
  { value: "10kb", label: "Last 10 KB" },
  { value: "50kb", label: "Last 50 KB" },
  { value: "100kb", label: "Last 100 KB" },
  { value: "all", label: "Everything" },
];

export function isTailSize(value: string | null | undefined): value is TailSize {
  return !!value && value in TAIL_SIZES;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
