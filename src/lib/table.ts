/**
 * One table model for every list page: URL search params in, validated
 * parameters out. Pages pass these to queries (server-side filtering, sorting
 * and pagination) and to the shared table components, so every list behaves
 * the same way: `q`, `sort`, `dir`, `page`, `from`, `to`, `dateField`.
 */
export type SortDir = "asc" | "desc";

export interface TableParams {
  q: string;
  sort: string;
  dir: SortDir;
  page: number;
  pageSize: number;
  from: string | null; // YYYY-MM-DD
  to: string | null; // YYYY-MM-DD (inclusive)
  dateField: string | null;
}

export interface TableOptions {
  defaultSort: string;
  defaultDir?: SortDir;
  sortable: string[];
  pageSize?: number;
  dateFields?: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseTableParams(sp: Record<string, string | undefined>, opts: TableOptions): TableParams {
  const sort = opts.sortable.includes(sp.sort ?? "") ? (sp.sort as string) : opts.defaultSort;
  const dir: SortDir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : sp.sort && sp.sort === sort && sp.dir ? "desc" : opts.defaultDir ?? "desc";
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const pageSize = Math.min(200, Math.max(10, Math.floor(Number(sp.pageSize) || opts.pageSize || 50)));
  const from = sp.from && DATE_RE.test(sp.from) ? sp.from : null;
  const to = sp.to && DATE_RE.test(sp.to) ? sp.to : null;
  const dateField = opts.dateFields?.length ? (opts.dateFields.includes(sp.dateField ?? "") ? (sp.dateField as string) : opts.dateFields[0]) : null;
  return { q: (sp.q ?? "").trim().slice(0, 120), sort, dir, page, pageSize, from, to, dateField };
}

/** ISO bounds for a date range typed as calendar days (end inclusive), in UTC. */
export function dateBounds(from: string | null, to: string | null): { fromIso: string | null; toIso: string | null } {
  return { fromIso: from ? `${from}T00:00:00.000Z` : null, toIso: to ? `${to}T23:59:59.999Z` : null };
}

/** Build a query string from the current params plus a patch; empty values drop the key; a filter change resets the page. */
export function buildQuery(sp: Record<string, string | undefined>, patch: Record<string, string | number | null | undefined>): string {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (v) merged[k] = v;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") delete merged[k];
    else merged[k] = String(v);
  }
  if (!("page" in patch)) delete merged.page;
  const qs = new URLSearchParams(merged).toString();
  return qs ? `?${qs}` : "";
}

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function paginate<T>(rows: T[], p: TableParams): { rows: T[]; total: number } {
  const start = (p.page - 1) * p.pageSize;
  return { rows: rows.slice(start, start + p.pageSize), total: rows.length };
}
