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
  /**
   * Makes the whole row activate the row's primary action, usually opening it.
   *
   * Clicks that land on a control inside the row — a link, a button, the select
   * checkbox — belong to that control and are ignored here, as is a click that
   * merely finished selecting text.
   *
   * A `<tr>` is not focusable and giving it a link role would cost the table its
   * row semantics, so a table using this still owes keyboard and screen-reader
   * users a real link in one of its cells.
   */
  onRowClick?: (row: Record<string, React.ReactNode>, index: number) => void;
}

/** Controls that own their own click, so a row click must not fire as well. */
const INTERACTIVE = "a,button,input,select,textarea,label,[role='checkbox'],[data-no-row-click]";

export function DataTable({
  columns,
  data,
  emptyMessage = "No results.",
  className,
  rowClassName,
  onRowClick,
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
                  onRowClick && "cursor-pointer",
                  rowClassName?.(row, i)
                )}
                onClick={
                  onRowClick
                    ? (event) => {
                        if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
                        if (window.getSelection()?.toString()) return;
                        onRowClick(row, i);
                      }
                    : undefined
                }
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
