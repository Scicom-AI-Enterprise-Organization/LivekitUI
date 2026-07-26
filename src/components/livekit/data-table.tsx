import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface Column {
  key: string;
  /** Usually a string; a node so a column can carry a control, e.g. select-all. */
  label: React.ReactNode;
  sortable?: boolean;
  className?: string;
}

interface DataTableProps {
  columns: Column[];
  data: Record<string, React.ReactNode>[];
  emptyMessage?: string;
  className?: string;
  /** Per-row classes, for state the cells cannot express — selection, say. */
  rowClassName?: (row: Record<string, React.ReactNode>, index: number) => string | undefined;
}

export function DataTable({
  columns,
  data,
  emptyMessage = "No results.",
  className,
  rowClassName,
}: DataTableProps) {
  return (
    <Card className={cn("py-0 overflow-hidden", className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 py-3 text-left text-xs font-medium text-muted-foreground",
                  col.className
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-sm text-muted-foreground"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={i}
                className={cn(
                  "border-b last:border-b-0 hover:bg-accent/50 transition-colors",
                  rowClassName?.(row, i)
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn("px-4 py-3 text-sm", col.className)}>
                    {row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
