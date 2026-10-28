/**
 * Shared list-page building blocks. Server components only (plain GET forms and
 * links), so they work without client JavaScript and keep every list consistent:
 * FilterBar (search + date range + extra controls), SortHeader, Pagination, and
 * the empty/loading states.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";
import { EmptyState } from "./ui";
import { buildQuery, pageCount, type TableParams } from "@/lib/table";

export type SP = Record<string, string | undefined>;

export function FilterBar({ basePath, sp, params, placeholder = "Search", dateFields, children, hidden = [] }: { basePath: string; sp: SP; params: TableParams; placeholder?: string; dateFields?: { key: string; label: string }[]; children?: ReactNode; hidden?: string[] }) {
  const keep = ["sort", "dir", "pageSize", ...hidden];
  const active = Boolean(params.q || params.from || params.to);
  return (
    <form className="surface p-3 mb-4" action={basePath} method="get">
      {keep.map((k) => (sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null))}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Icon name="search" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-8" name="q" placeholder={placeholder} defaultValue={params.q} aria-label="Search" />
        </div>
        {dateFields && dateFields.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap" aria-label="Date range">
            <select className="select w-auto" name="dateField" defaultValue={params.dateField ?? dateFields[0].key} aria-label="Date field">
              {dateFields.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            <input className="input w-auto" type="date" name="from" defaultValue={params.from ?? ""} aria-label="From date" />
            <span className="text-xs text-ink-faint">to</span>
            <input className="input w-auto" type="date" name="to" defaultValue={params.to ?? ""} aria-label="To date" />
          </div>
        )}
        {children}
        <button className="btn">Apply</button>
        {(active || children) && (
          <Link href={basePath} className="btn btn-ghost">
            Reset
          </Link>
        )}
      </div>
    </form>
  );
}

export function SortHeader({ label, field, sp, params, basePath, className = "", defaultDir = "desc" }: { label: string; field: string; sp: SP; params: TableParams; basePath: string; className?: string; defaultDir?: "asc" | "desc" }) {
  const active = params.sort === field;
  const nextDir = active ? (params.dir === "asc" ? "desc" : "asc") : defaultDir;
  return (
    <th className={className} aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={`${basePath}${buildQuery(sp, { sort: field, dir: nextDir })}`} className={`inline-flex items-center gap-1 hover:no-underline ${active ? "text-ink" : "text-ink-muted"}`}>
        {label}
        <Icon name="chevronDown" className={`w-3 h-3 transition-transform ${active ? (params.dir === "asc" ? "rotate-180" : "") : "opacity-30"}`} />
      </Link>
    </th>
  );
}

export function Pagination({ basePath, sp, params, total, label = "rows" }: { basePath: string; sp: SP; params: TableParams; total: number; label?: string }) {
  const pages = pageCount(total, params.pageSize);
  const start = total === 0 ? 0 : (params.page - 1) * params.pageSize + 1;
  const end = Math.min(total, params.page * params.pageSize);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-line text-xs text-ink-muted">
      <span>
        {start}–{end} of {total} {label}
      </span>
      <div className="flex items-center gap-1">
        <Link aria-disabled={params.page <= 1} className={`btn btn-sm btn-ghost ${params.page <= 1 ? "pointer-events-none opacity-40" : ""}`} href={`${basePath}${buildQuery(sp, { page: Math.max(1, params.page - 1) })}`}>
          Previous
        </Link>
        <span className="tabular-nums px-1">
          page {params.page} / {pages}
        </span>
        <Link aria-disabled={params.page >= pages} className={`btn btn-sm btn-ghost ${params.page >= pages ? "pointer-events-none opacity-40" : ""}`} href={`${basePath}${buildQuery(sp, { page: Math.min(pages, params.page + 1) })}`}>
          Next
        </Link>
      </div>
    </div>
  );
}

export function TableEmpty({ title, description, action, icon = "list" }: { title: string; description?: string; action?: ReactNode; icon?: "list" | "search" | "building" | "kanban" | "bolt" }) {
  return <EmptyState icon={icon} title={title} description={description} action={action} />;
}
