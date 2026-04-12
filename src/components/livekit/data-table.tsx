import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  className?: string;
}

interface DataTableProps {
  columns: Column[];
  data: Record<string, React.ReactNode>[];
  emptyMessage?: string;
  className?: string;
}

export function DataTable({ columns, data, emptyMessage = "No results.", className }: DataTableProps) {
  return (
    <Card className={cn("py-0 overflow-hidden", className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted-foreground",
                  col.className
                )}
              >
                <span className="flex items-center gap-1">
                  {col.label}
                  {col.sortable && (
                    <svg className="size-3 text-muted-foreground" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M6 2l3 4H3zM6 10l-3-4h6z" />
                    </svg>
                  )}
                </span>
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
                className="border-b last:border-b-0 hover:bg-accent/50 transition-colors"
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
