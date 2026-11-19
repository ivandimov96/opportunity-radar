/**
 * An activity log, grouped by day. One event is one line: the time, an icon
 * for the kind of event, the business (when the log spans several) and what
 * happened, with stage changes and validation signals shown as pills instead
 * of the raw sentence that was logged. On a phone the business and what
 * happened stack. Server component.
 */
import Link from "next/link";
import { Badge, Icon, fmtDate, type Tone, EmptyLine } from "@/components/ui";
import type { IconName } from "@/components/icons";
import { OPPORTUNITY_CATEGORIES } from "@/lib/industries";
import { stageLabel } from "@/lib/pipeline/stages";

export interface ActivityRow {
  id: string;
  type: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  /** Set when the timeline spans several businesses: each row then names its own. */
  business?: { id: string; name: string };
}

export type ActivityKind = "all" | "contact" | "stage" | "validation" | "system";

export const ACTIVITY_KINDS: { key: ActivityKind; label: string; types: string[] }[] = [
  { key: "all", label: "All", types: [] },
  { key: "contact", label: "Notes & contact", types: ["note", "call", "email", "meeting"] },
  { key: "stage", label: "Stage", types: ["stage_change"] },
  { key: "validation", label: "Validation", types: ["validation"] },
  { key: "system", label: "System", types: ["system"] },
];

export function kindOf(type: string): Exclude<ActivityKind, "all"> {
  return ACTIVITY_KINDS.find((k) => k.types.includes(type))?.key as Exclude<ActivityKind, "all"> | undefined ?? "system";
}

const STYLE: Record<string, { icon: IconName; label: string; tone: string }> = {
  note: { icon: "note", label: "Note", tone: "bg-info/15 text-info" },
  call: { icon: "phone", label: "Call", tone: "bg-info/15 text-info" },
  email: { icon: "mail", label: "Email", tone: "bg-info/15 text-info" },
  meeting: { icon: "flag", label: "Meeting", tone: "bg-info/15 text-info" },
  stage_change: { icon: "kanban", label: "Stage", tone: "bg-accent-soft text-accent" },
  validation: { icon: "check", label: "Validation", tone: "bg-ok/15 text-ok" },
  system: { icon: "bolt", label: "System", tone: "bg-surface-3 text-ink-faint" },
};

export const stageTone = (stage: string | null): Tone => (stage === "won" ? "ok" : stage === "lost" ? "bad" : stage === "discovered" || stage === "researching" ? "neutral" : stage === "replied" || stage === "meeting_scheduled" || stage === "proposal_sent" ? "info" : "accent");
const signalTone = (signal: string): Tone => (signal === "paying" || signal === "pilot" || signal === "confirmed_problem" ? "ok" : signal === "rejected" ? "bad" : "info");

/** "Today", "Yesterday" or a short date. */
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function groupByDay<T>(rows: T[], at: (row: T) => string = (row) => (row as { createdAt: string }).createdAt) {
  const groups: { day: string; rows: T[] }[] = [];
  for (const r of rows) {
    const day = dayLabel(at(r));
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.rows.push(r);
    else groups.push({ day, rows: [r] });
  }
  return groups;
}

/** The structured line for an event: pills for stage changes and validation signals, the sentence otherwise. */
function Body({ a }: { a: ActivityRow }) {
  const m = (a.metadata ?? {}) as Record<string, unknown>;
  if (a.type === "stage_change") {
    const from = typeof m.from === "string" ? m.from : null;
    const to = typeof m.to === "string" ? m.to : null;
    const reason = a.content.replace(/^Stage (?:changed|set) to \w+:?\s*/, "");
    return (
      <>
        <div className="flex items-center gap-x-1.5 gap-y-1 flex-wrap text-sm">
          {from && <Badge tone="neutral">{stageLabel(from)}</Badge>}
          {from && <Icon name="arrowRight" className="w-3.5 h-3.5 text-ink-faint shrink-0" />}
          <Badge tone={stageTone(to)}>{to ? stageLabel(to) : "—"}</Badge>
          {m.automatic === true && <span className="text-xs text-ink-faint">automatic</span>}
          {reason && <span className="text-sm text-ink-muted basis-full md:basis-auto md:ml-1">{reason}</span>}
        </div>
      </>
    );
  }
  if (a.type === "validation" && typeof m.signalType === "string") {
    const signal = m.signalType.replace(/_/g, " ");
    const category = typeof m.opportunityCategory === "string" ? (OPPORTUNITY_CATEGORIES as Record<string, string>)[m.opportunityCategory] ?? m.opportunityCategory : null;
    const notes = a.content.includes(" — ") ? a.content.slice(a.content.indexOf(" — ") + 3) : null;
    const removed = m.removed === true;
    return (
      <>
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          {removed && <span className="text-ink-faint">Removed:</span>}
          <Badge tone={removed ? "neutral" : signalTone(m.signalType)} className={removed ? "line-through" : ""}>
            {signal}
          </Badge>
          {category && <span className="text-ink-muted">for {category}</span>}
        </div>
        {notes && <div className="text-[12px] text-ink-muted mt-1">{notes}</div>}
      </>
    );
  }
  return <div className="text-sm text-ink-muted">{a.content}</div>;
}

export interface TimelinePagination {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
}

/** Counts per kind from per-type counts (as `businessActivities` returns them). */
export function kindCounts(countsByType: Record<string, number>): Record<ActivityKind, number> {
  const all = Object.values(countsByType).reduce((a, b) => a + b, 0);
  return Object.fromEntries(ACTIVITY_KINDS.map((k) => [k.key, k.key === "all" ? all : Object.entries(countsByType).filter(([t]) => kindOf(t) === k.key).reduce((a, [, n]) => a + n, 0)])) as Record<ActivityKind, number>;
}

/**
 * `activities` is the page to show (already filtered to `kind` and paginated by the caller);
 * `counts` feeds the filter chips and `pagination` the footer. Without them the list is shown as is.
 */
export function ActivityTimeline<K extends string = ActivityKind>({ activities, kind, kindHref, counts, pagination, kinds, compact = false }: { activities: ActivityRow[]; kind?: K; kindHref?: (k: K) => string; counts?: Record<K, number>; pagination?: TimelinePagination; kinds?: readonly { key: K; label: string }[]; /** For a narrow place: the business above what happened, never side by side. */ compact?: boolean }) {
  const chips = (kinds ?? ACTIVITY_KINDS) as readonly { key: K; label: string }[];
  const current = kind ?? chips[0].key;
  const shown = activities;
  const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  return (
    <div>
      {kindHref && (
        <nav className="flex gap-1.5 flex-wrap px-4 py-3 border-b border-line" aria-label="Activity filter">
          {chips.map((k) => (
            <Link key={k.key} href={kindHref(k.key)} aria-current={current === k.key ? "true" : undefined} className={`chip ${current === k.key ? "chip-active" : ""}`}>
              {k.label} {counts && <span className="tabular-nums opacity-70">{counts[k.key]}</span>}
            </Link>
          ))}
        </nav>
      )}
      {shown.length === 0 ? (
        <EmptyLine>Nothing of this kind yet.</EmptyLine>
      ) : (
        groupByDay(shown).map((g) => (
          <section key={g.day} aria-label={g.day}>
            <h3 className="px-4 py-2 text-sm font-semibold text-ink bg-surface-3/60 border-y border-line first:border-t-0">
              {g.day} <span className="font-normal text-ink-faint">· {g.rows.length} {g.rows.length === 1 ? "event" : "events"}</span>
            </h3>
            <ol>
              {g.rows.map((a) => {
                const st = STYLE[a.type] ?? STYLE.system;
                return (
                  <li key={a.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] md:grid-cols-[4.5rem_1.75rem_minmax(0,1fr)] items-start gap-x-3 px-4 py-2.5 border-b border-line last:border-b-0">
                    <time dateTime={a.createdAt} title={fmtDate(a.createdAt)} className="order-last col-start-2 md:order-none md:col-start-auto text-xs text-ink-faint tabular-nums whitespace-nowrap pt-1 md:pt-1.5">
                      {fmtTime(a.createdAt)}
                    </time>
                    <span className={`w-7 h-7 rounded-full grid place-items-center shrink-0 ${st.tone}`} title={st.label}>
                      <Icon name={st.icon} className="w-3.5 h-3.5" />
                    </span>
                    <div className={`min-w-0 pt-0.5 ${a.business && !compact ? "md:grid md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-x-4 md:items-baseline" : ""}`}>
                      {a.business && (
                        <Link href={`/businesses/${a.business.id}`} className={`block text-sm font-semibold text-ink truncate mb-1 ${compact ? "" : "md:mb-0"}`}>
                          {a.business.name}
                        </Link>
                      )}
                      <div className="min-w-0 break-words">
                        <Body a={a} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
      {pagination && pages > 1 && (
        <nav className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-line text-xs text-ink-muted" aria-label="Activity pages">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.total, pagination.page * pagination.pageSize)} of {pagination.total} events
          </span>
          <div className="flex items-center gap-1">
            <Link aria-disabled={pagination.page <= 1} className={`btn btn-sm btn-ghost ${pagination.page <= 1 ? "pointer-events-none opacity-40" : ""}`} href={pagination.href(Math.max(1, pagination.page - 1))}>
              Previous
            </Link>
            <span className="tabular-nums px-1">
              page {pagination.page} / {pages}
            </span>
            <Link aria-disabled={pagination.page >= pages} className={`btn btn-sm btn-ghost ${pagination.page >= pages ? "pointer-events-none opacity-40" : ""}`} href={pagination.href(Math.min(pages, pagination.page + 1))}>
              Next
            </Link>
          </div>
        </nav>
      )}
    </div>
  );
}
