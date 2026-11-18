/**
 * The period shown on the Dashboard and the Businesses list. It is chosen from
 * one short list ("Last 7 days", "This month", ...) and carried in the URL as
 * `range`; "custom" adds two calendar days, `from` and `to`, both included.
 * With nothing in the URL the period is the last 7 days.
 */
export const RANGE_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom dates…" },
] as const;
export type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];
export const DEFAULT_RANGE = "7d" as const satisfies RangeKey;

export interface ResolvedRange {
  key: RangeKey;
  /** First and last calendar day, or null when that side is open ("all time" has neither). */
  from: string | null;
  to: string | null;
}

/** A calendar day in this computer's time zone, as date inputs use it. */
export function dayString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const VALID_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (s?: string | null) => (s && VALID_DAY.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime()) ? s : null);

/** The days a fixed choice covers today. */
export function presetDays(key: Exclude<RangeKey, "custom">, now = new Date()): { from: string | null; to: string | null } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const at = (yy: number, mm: number, dd: number) => dayString(new Date(yy, mm, dd));
  switch (key) {
    case "today":
      return { from: at(y, m, d), to: at(y, m, d) };
    case "yesterday":
      return { from: at(y, m, d - 1), to: at(y, m, d - 1) };
    case "7d":
      return { from: at(y, m, d - 6), to: at(y, m, d) };
    case "30d":
      return { from: at(y, m, d - 29), to: at(y, m, d) };
    case "month":
      return { from: at(y, m, 1), to: at(y, m, d) };
    case "last_month":
      return { from: at(y, m - 1, 1), to: at(y, m, 0) };
    case "year":
      return { from: at(y, 0, 1), to: at(y, m, d) };
    case "all":
      return { from: null, to: null };
  }
}

/** The period the URL asks for; the last 7 days when it asks for nothing (or for nonsense). */
export function resolveRange(sp: { range?: string; from?: string; to?: string }, now = new Date()): ResolvedRange {
  const known = RANGE_OPTIONS.some((o) => o.key === sp.range) ? (sp.range as RangeKey) : null;
  if (known && known !== "custom") return { key: known, ...presetDays(known, now) };
  let from = day(sp.from);
  let to = day(sp.to);
  if (from && to && from > to) [from, to] = [to, from];
  if (known === "custom" || from || to) return from || to ? { key: "custom", from, to } : { key: DEFAULT_RANGE, ...presetDays(DEFAULT_RANGE, now) };
  return { key: DEFAULT_RANGE, ...presetDays(DEFAULT_RANGE, now) };
}

/** The query parameters that reproduce a period (none for the default one). */
export function rangeParams(r: ResolvedRange): Record<string, string> {
  if (r.key === DEFAULT_RANGE) return {};
  if (r.key !== "custom") return { range: r.key };
  return { range: "custom", ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}) };
}

/** The period as timestamps covering whole local days, for comparing with stored ISO times. */
export function rangeBounds(range: { from: string | null; to: string | null }): { fromIso: string | null; toIso: string | null } {
  return {
    fromIso: range.from ? new Date(`${range.from}T00:00:00`).toISOString() : null,
    toIso: range.to ? new Date(`${range.to}T23:59:59.999`).toISOString() : null,
  };
}

export function describeRange(r: ResolvedRange): string {
  if (r.key !== "custom") return RANGE_OPTIONS.find((o) => o.key === r.key)!.label.toLowerCase();
  const fmt = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (r.from && r.to) return r.from === r.to ? fmt(r.from) : `${fmt(r.from)} to ${fmt(r.to)}`;
  return r.from ? `since ${fmt(r.from)}` : `until ${fmt(r.to!)}`;
}
