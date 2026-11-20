import Link from "next/link";
import { Badge, Card, EmptyState, Flash, Icon, PageHeader } from "@/components/ui";
import { stageLabel } from "@/lib/pipeline/stages";
import { groupTodo, listTodo, todoGroupOf, TODO_GROUPS, TODO_KINDS, type TodoGroup, type TodoKind } from "@/lib/pipeline/todo";
import { planFollowUps } from "@/lib/pipeline/follow-up";
import { completeNextActionAction, snoozeNextActionAction } from "@/app/actions";

export const metadata = { title: "To do" };

const SNOOZE: { days: number; label: string }[] = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "Next week" },
];
/** Actions on one page. */
const PER_PAGE = 25;
const BAR: Record<TodoGroup, string> = { overdue: "bg-bad", today: "bg-accent", tomorrow: "bg-info", week: "bg-line-strong", later: "bg-line-strong", undated: "bg-line-strong" };

/**
 * Everything planned, in one list: what is overdue first, then today, then what is coming.
 * Each line is done with one click or moved to a later day with another.
 */
export default async function TodoPage({ searchParams }: { searchParams: Promise<{ show?: string; priority?: string; kind?: string; page?: string; ok?: string }> }) {
  const sp = await searchParams;
  await planFollowUps(); // bring the list in line with where every business stands, before showing it
  const all = await listTodo();
  const onlyHigh = sp.priority === "high";
  const show = TODO_GROUPS.some((g) => g.key === sp.show) ? (sp.show as TodoGroup) : null;
  const kind = TODO_KINDS.some((k) => k.key === sp.kind) ? (sp.kind as TodoKind) : null;
  const prio = all.filter((i) => !onlyHigh || i.priority === "high");
  /** What the "When" row counts: everything of the chosen kind. What the "What" row counts: everything in the chosen time. */
  const byKind = prio.filter((i) => !kind || i.kind === kind);
  const byWhen = prio.filter((i) => !show || todoGroupOf(i.due) === show);
  const items = byKind.filter((i) => !show || todoGroupOf(i.due) === show);
  /** How many high-priority actions the current two choices hold. */
  const highCount = all.filter((i) => i.priority === "high" && (!kind || i.kind === kind) && (!show || todoGroupOf(i.due) === show)).length;
  // The list in pages: the most pressing come first, so page one is what to do now.
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(sp.page) || 1)));
  const groups = groupTodo(items.slice((page - 1) * PER_PAGE, page * PER_PAGE));
  const href = (patch: { show?: string | null; priority?: string | null; kind?: string | null; page?: number }) => {
    const p = new URLSearchParams();
    const next = { show: sp.show, priority: sp.priority, kind: sp.kind, ...patch };
    if (next.show) p.set("show", next.show);
    if (next.priority) p.set("priority", next.priority);
    if (next.kind) p.set("kind", next.kind);
    if (patch.page && patch.page > 1) p.set("page", String(patch.page)); // a change of filter starts at page one again
    const q = p.toString();
    return `/todo${q ? `?${q}` : ""}`;
  };
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "No date");
  const KIND_LABEL: Record<TodoKind, string> = { reply: "Reply", own: "Mine", email: "Email", decision: "Decision", followup: "Follow-up", waiting: "Waiting" };

  return (
    <>
      <PageHeader title="To do" />
      <Flash msg={sp.ok} />
      {all.length === 0 ? (
        <Card>
          <EmptyState icon="check" title="Nothing planned" action={<Link href="/businesses" className="btn btn-primary btn-sm">Open Businesses</Link>} />
        </Card>
      ) : (
        <>
          {/*
            Two rows of filters that work together. A count is always "how many you get if you press this", given
            what is chosen in the other row. Every choice that exists in the list stays in its place (greyed when it
            would give nothing), so the rows do not jump; pressing the chosen one again clears it.
          */}
          <div className="flex flex-wrap items-center gap-2 mb-3" aria-label="Show">
            <span className="text-xs font-semibold text-ink-faint w-12 shrink-0">When</span>
            <Link href={href({ show: null })} aria-current={!show ? "page" : undefined} className={`chip ${!show ? "chip-active" : ""}`}>
              Any time <span className="tabular-nums text-xs opacity-70">{byKind.length}</span>
            </Link>
            {TODO_GROUPS.filter((g) => all.some((i) => todoGroupOf(i.due) === g.key)).map((g) => {
              const n = byKind.filter((i) => todoGroupOf(i.due) === g.key).length;
              const on = show === g.key;
              return (
                <Link key={g.key} href={href({ show: on ? null : g.key })} aria-current={on ? "page" : undefined} className={`chip ${on ? "chip-active" : n === 0 ? "opacity-50" : ""}`}>
                  {g.key === "overdue" && n > 0 && <span className="w-1.5 h-1.5 rounded-full bg-bad" aria-hidden />}
                  {g.label} <span className="tabular-nums text-xs opacity-70">{n}</span>
                </Link>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4" aria-label="Kind of work">
            <span className="text-xs font-semibold text-ink-faint w-12 shrink-0">What</span>
            <Link href={href({ kind: null })} aria-current={!kind ? "page" : undefined} className={`chip ${!kind ? "chip-active" : ""}`}>
              Every kind <span className="tabular-nums text-xs opacity-70">{byWhen.length}</span>
            </Link>
            {TODO_KINDS.filter((k) => all.some((i) => i.kind === k.key)).map((k) => {
              const n = byWhen.filter((i) => i.kind === k.key).length;
              const on = kind === k.key;
              return (
                <Link key={k.key} href={href({ kind: on ? null : k.key })} aria-current={on ? "page" : undefined} className={`chip ${on ? "chip-active" : n === 0 ? "opacity-50" : ""}`}>
                  {k.label} <span className="tabular-nums text-xs opacity-70">{n}</span>
                </Link>
              );
            })}
            <Link href={href({ priority: onlyHigh ? null : "high" })} aria-pressed={onlyHigh} className={`chip ml-auto ${onlyHigh ? "chip-active" : ""}`}>
              {onlyHigh && <Icon name="check" className="w-3 h-3" />} High priority only <span className="tabular-nums text-xs opacity-70">{highCount}</span>
            </Link>
          </div>

          {groups.length === 0 && (
            <Card>
              <EmptyState compact icon="check" title="Nothing here" />
            </Card>
          )}
          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.key} className="surface overflow-hidden" aria-label={g.label}>
                <div className="flex items-center gap-2 px-5 py-3 border-b border-line bg-surface-2">
                  <h2 className={`text-[0.95rem] font-semibold ${g.key === "overdue" ? "text-bad" : ""}`}>{g.label}</h2>
                  <span className="text-sm text-ink-faint tabular-nums">{g.items.length}</span>
                </div>
                <ul className="divide-y divide-line">
                  {g.items.map((i) => (
                    <li key={i.businessId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5">
                      <span className={`w-1 self-stretch rounded-full shrink-0 ${BAR[g.key]}`} aria-hidden />
                      <span className="w-[4.6rem] shrink-0 text-xs font-semibold text-ink-muted">{KIND_LABEL[i.kind]}</span>
                      <Link href={i.href} className="min-w-[14rem] flex-1 hover:no-underline group">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-ink truncate group-hover:underline">{i.action}</span>
                          {i.priority === "high" && <Badge tone="warn">High</Badge>}
                        </span>
                        <span className="block text-xs text-ink-faint truncate">
                          {i.businessName}
                          {i.city ? ` · ${i.city}` : ""} · {stageLabel(i.stage)}
                        </span>
                      </Link>
                      <span className={`text-xs tabular-nums whitespace-nowrap ${g.key === "overdue" ? "text-bad font-semibold" : "text-ink-muted"}`}>{g.key === "overdue" && i.due ? i.due.label : when(i.at)}</span>
                      {/* Not now: one dropdown moves it to a later day. */}
                      <details className="relative group/later">
                        <summary className="btn btn-sm btn-ghost list-none cursor-pointer select-none">
                          Later <Icon name="chevronDown" className="w-3.5 h-3.5 transition-transform group-open/later:rotate-180" />
                        </summary>
                        <div className="absolute right-0 top-9 z-20 surface shadow-lg p-1.5 w-40 space-y-0.5">
                          {SNOOZE.map((sn) => (
                            <form key={sn.days} action={snoozeNextActionAction}>
                              <input type="hidden" name="businessId" value={i.businessId} />
                              <input type="hidden" name="days" value={sn.days} />
                              <button className="w-full text-left text-sm rounded-[var(--radius-sm)] px-2.5 py-1.5 hover:bg-surface-2">{sn.label}</button>
                            </form>
                          ))}
                        </div>
                      </details>
                      <form action={completeNextActionAction}>
                        <input type="hidden" name="businessId" value={i.businessId} />
                        <button className="btn btn-sm" title="Mark it done">
                          <Icon name="check" /> Done
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {items.length > PER_PAGE && (
            <nav className="flex items-center justify-between gap-3 mt-4 px-1 text-sm text-ink-muted" aria-label="Pages">
              <span className="tabular-nums">
                {(page - 1) * PER_PAGE + 1}–{Math.min(items.length, page * PER_PAGE)} of {items.length}
              </span>
              <span className="flex items-center gap-2">
                {page > 1 ? (
                  <Link data-scroll="top" href={href({ page: page - 1 })} className="btn btn-sm">
                    Previous
                  </Link>
                ) : (
                  <span className="btn btn-sm opacity-40 pointer-events-none">Previous</span>
                )}
                <span className="tabular-nums">
                  page {page} / {pages}
                </span>
                {page < pages ? (
                  <Link data-scroll="top" href={href({ page: page + 1 })} className="btn btn-sm">
                    Next
                  </Link>
                ) : (
                  <span className="btn btn-sm opacity-40 pointer-events-none">Next</span>
                )}
              </span>
            </nav>
          )}
        </>
      )}
    </>
  );
}
