/**
 * A business's activity log as a timeline: grouped by day, one icon per kind
 * of event, stage changes and validation signals rendered structurally (pills)
 * instead of as the raw sentence that was logged. Server component.
 */
import Link from "next/link";
import { Badge, Icon, fmtDate, type Tone } from "@/components/ui";
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
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          {from && <Badge tone="neutral">{stageLabel(from)}</Badge>}
          {from && <Icon name="arrowRight" className="w-3 h-3 text-ink-faint shrink-0" />}
          <Badge tone={stageTone(to)}>{to ? stageLabel(to) : "—"}</Badge>
          {m.automatic === true && <span className="text-[11px] text-ink-faint">automatic</span>}
        </div>
        {reason && <div className="text-[12px] text-ink-muted mt-1">{reason}</div>}
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
  return <div className="text-sm text-ink">{a.content}</div>;
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
export function ActivityTimeline<K extends string = ActivityKind>({ activities, kind, kindHref, counts, pagination, kinds }: { activities: ActivityRow[]; kind?: K; kindHref?: (k: K) => string; counts?: Record<K, number>; pagination?: TimelinePagination; kinds?: readonly { key: K; label: string }[] }) {
  const chips = (kinds ?? ACTIVITY_KINDS) as readonly { key: K; label: string }[];
  const current = kind ?? chips[0].key;
  const shown = activities;
  const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  return (
    <div>
      {kindHref && (
        <nav className="flex gap-1 flex-wrap px-4 py-2 border-b border-line" aria-label="Activity filter">
          {chips.map((k) => (
            <Link key={k.key} href={kindHref(k.key)} aria-current={current === k.key ? "true" : undefined} className={`px-2.5 py-1 rounded-full text-xs hover:no-underline transition-colors ${current === k.key ? "bg-accent-soft text-accent-text font-medium" : "text-ink-muted hover:bg-surface-3 hover:text-ink"}`}>
              {k.label} {counts && <span className="tabular-nums opacity-70">{counts[k.key]}</span>}
            </Link>
          ))}
        </nav>
      )}
      {shown.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-faint text-center">Nothing of this kind yet.</p>
      ) : (
        groupByDay(shown).map((g) => (
          <section key={g.day} aria-label={g.day}>
            <h3 className="px-4 py-1.5 text-[11px] font-semibold text-ink-muted bg-surface-3/60 border-y border-line first:border-t-0">
              {g.day} <span className="font-normal text-ink-faint">· {g.rows.length}</span>
            </h3>
            <ol className="px-4">
              {g.rows.map((a, i) => {
                const st = STYLE[a.type] ?? STYLE.system;
                const last = i === g.rows.length - 1;
                return (
                  <li key={a.id} className="grid grid-cols-[3.25rem_1.75rem_1fr] gap-x-3">
                    <time dateTime={a.createdAt} title={fmtDate(a.createdAt)} className="text-[11px] text-ink-faint tabular-nums pt-2.5 text-right">
                      {fmtTime(a.createdAt)}
                    </time>
                    <div className="relative flex justify-center">
                      {!last && <span className="absolute top-8 bottom-0 w-px bg-line" aria-hidden />}
                      <span className={`mt-1.5 w-7 h-7 rounded-full grid place-items-center shrink-0 ${st.tone}`} title={st.label}>
                        <Icon name={st.icon} className="w-3.5 h-3.5" />
                      </span>
                    </div>
                    <div className={`min-w-0 py-2 ${last ? "" : "pb-3"}`}>
                      <div className="text-[10.5px] uppercase tracking-wide text-ink-faint mb-0.5">{st.label}</div>
                      {a.business && (
                        <Link href={`/businesses/${a.business.id}`} className="block text-sm font-medium text-ink truncate">
                          {a.business.name}
                        </Link>
                      )}
                      <Body a={a} />
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
