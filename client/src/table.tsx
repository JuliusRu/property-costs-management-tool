import { useMemo, useState, type ReactNode } from "react";

/**
 * The one table used everywhere: Building, Tenants, Invoices, Statements, Documents.
 * Click a header to sort (arrow shows direction), optional grouping, optional expandable detail row.
 */
export type Column<T> = {
  key: string;
  label: ReactNode;
  render: (row: T) => ReactNode;
  sort?: (row: T) => string | number | null | undefined; // omit → column is not sortable
  align?: "left" | "right";
  width?: string;
  nowrap?: boolean;
  className?: string;
};

export type Sort = { key: string; dir: 1 | -1 };

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  defaultSort?: Sort;
  groupBy?: (row: T) => string;
  groupOrder?: (a: string, b: string) => number;
  expanded?: (row: T) => ReactNode | null; // rendered as a full-width row under the row
  rowClass?: (row: T) => string;
  footer?: ReactNode; // one or more <tr>
  emptyText?: ReactNode;
  minWidth?: number;
  dense?: boolean;
};

export function DataTable<T>({ columns, rows, rowKey, defaultSort, groupBy, groupOrder, expanded, rowClass, footer, emptyText, minWidth = 800, dense }: Props<T>) {
  const [sort, setSort] = useState<Sort | null>(defaultSort ?? null);
  const pad = dense ? "px-4 py-2" : "px-4 py-3";

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const val = (r: T) => col.sort!(r);
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      return c * sort.dir;
    });
  }, [rows, sort, columns]);

  const groups = useMemo<[string, T[]][]>(() => {
    if (!groupBy) return [["", sorted]];
    const m = new Map<string, T[]>();
    for (const r of sorted) { const g = groupBy(r); m.set(g, [...(m.get(g) ?? []), r]); }
    const entries = [...m.entries()];
    return groupOrder ? entries.sort((a, b) => groupOrder(a[0], b[0])) : entries;
  }, [sorted, groupBy, groupOrder]);

  const toggle = (c: Column<T>) => {
    if (!c.sort) return;
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.align === "right" ? -1 : 1 }));
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="text-xs text-mute">
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined} className={`${pad} font-medium ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}>
                {c.sort ? (
                  <button type="button" onClick={() => toggle(c)} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                    className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-ink ${sort?.key === c.key ? "text-ink" : ""}`}>
                    {c.label}<span className={`text-cobalt ${sort?.key === c.key ? "" : "invisible"}`}>{sort?.key === c.key && sort.dir === -1 ? "↓" : "↑"}</span>
                  </button>
                ) : <span className="whitespace-nowrap">{c.label}</span>}
              </th>
            ))}
          </tr>
        </thead>
        {rows.length === 0 && <tbody><tr><td colSpan={columns.length} className="px-4 py-10 text-center text-mute">{emptyText ?? "—"}</td></tr></tbody>}
        {rows.length > 0 && groups.map(([g, list]) => (
          <tbody key={g} className="divide-y divide-line">
            {groupBy && <tr className="bg-surface"><td colSpan={columns.length} className="px-4 py-1.5 text-xs font-semibold text-ink-soft">{g} <span className="font-normal text-mute">· {list.length}</span></td></tr>}
            {list.map((r) => {
              const extra = expanded?.(r);
              return (
                <Row key={rowKey(r)} extra={extra} cls={rowClass?.(r) ?? ""} cols={columns.length}>
                  {columns.map((c) => <td key={c.key} className={`${pad} align-top ${c.align === "right" ? "num text-right" : ""} ${c.nowrap ? "whitespace-nowrap" : ""} ${c.className ?? ""}`}>{c.render(r)}</td>)}
                </Row>
              );
            })}
          </tbody>
        ))}
        {footer && <tfoot className="border-t border-line">{footer}</tfoot>}
      </table>
    </div>
  );
}

function Row({ children, extra, cls, cols }: { children: ReactNode; extra: ReactNode | null | undefined; cls: string; cols: number }) {
  return (
    <>
      <tr className={`hover:bg-surface/60 ${cls}`}>{children}</tr>
      {extra && <tr className="!border-t-0 bg-surface/40"><td colSpan={cols} className="px-4 pb-4 pt-0">{extra}</td></tr>}
    </>
  );
}

/** Header cell helpers for numbers: keeps the money column right-aligned and tabular. */
export const num = (v: number | null | undefined) => (v == null ? null : v);
