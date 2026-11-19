/**
 * Pipeline: where each conversation stands, and how it got there. Two views
 * share one period (the last 7 days unless chosen otherwise):
 *  - Board: the stages a person works with, as columns of cards. A column
 *    shows its first cards and says how many more there are, so the board
 *    stays readable with hundreds of businesses.
 *  - History: every recorded event of the process across all businesses,
 *    grouped by day, with a filter by kind of event.
 */
import Link from "next/link";
import { ActivityTimeline } from "@/components/activity-timeline";
import { DateRangePicker } from "@/components/date-range";
import { FilterBar } from "@/components/table";
import { Card, EmptyState, Icon, PageHeader, Tabs } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { describeRange, rangeBounds, rangeParams, resolveRange } from "@/lib/date-range";
import { listPlaybooks } from "@/lib/industries";
import { type PipelineStage } from "@/lib/pipeline/stages";
import { HISTORY_KINDS, boardTotals, pipelineBoard, pipelineHistory, type HistoryKind } from "@/lib/queries";
import { parseTableParams } from "@/lib/table";
import { PipelineBoard, type BoardItem } from "./board";

export const metadata = { title: "Pipeline" };

/** Cards shown per column before "N more": enough to work with, few enough to scan. */
/** Every business on the board is shown; only a very long stage is cut, with a link to the rest. */
const CARDS_PER_COLUMN = 100;
const HISTORY_PAGE_SIZE = 40;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const t = parseTableParams(sp, { defaultSort: "priority", sortable: ["priority"], pageSize: HISTORY_PAGE_SIZE });
  const cfg = getConfig();
  const readOnly = cfg.serverless && !cfg.TURSO_DATABASE_URL;
  const view: "board" | "history" = sp.view === "history" ? "history" : "board";
  const period = resolveRange(sp);
  const bounds = rangeBounds(period);
  const kind: HistoryKind = HISTORY_KINDS.some((k) => k.key === sp.kind) ? (sp.kind as HistoryKind) : "all";

  /** A link inside this page that keeps the period and the search, and changes only what is given. */
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams({ ...rangeParams(period), ...(t.q ? { q: t.q } : {}), ...(sp.industry ? { industry: sp.industry } : {}), ...(view === "history" ? { view: "history" } : {}), ...(view === "history" && kind !== "all" ? { kind } : {}) });
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v);
    else p.delete(k);
    const q = p.toString();
    return `/pipeline${q ? `?${q}` : ""}`;
  };
  const keep = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && !["range", "from", "to", "page", "ok", "error"].includes(k))) as Record<string, string>;

  const totals = await boardTotals();
  const board = view === "board" ? await pipelineBoard({ q: t.q || undefined, industry: sp.industry || undefined, ...bounds }) : null;
  const history = view === "history" ? await pipelineHistory({ ...bounds, kind, q: t.q || undefined, page: t.page, pageSize: HISTORY_PAGE_SIZE }) : null;

  const all = board ? Object.values(board).flat() : [];
  // Each column shows its first cards (board order, then priority); the rest are one click away in the list.
  const shown = board ? Object.values(board).flatMap((rows) => rows.slice(0, CARDS_PER_COLUMN)) : [];
  const hidden = Object.fromEntries(Object.entries(board ?? {}).map(([stage, rows]) => [stage, Math.max(0, rows.length - CARDS_PER_COLUMN)])) as Record<string, number>;
  const items: BoardItem[] = shown.map((r) => ({
    id: r.business.id,
    name: r.business.name,
    city: r.business.city,
    domain: r.business.websiteDomain,
    priority: r.business.priority,
    highPriority: r.prospect.priority === "high",
    draftCount: r.draftCount ?? 0,
    nextAction: r.prospect.nextAction,
    nextActionAt: r.prospect.nextActionAt,
    stage: r.prospect.stage as PipelineStage,
    movedAt: r.prospect.updatedAt,
    openReplies: totals.openReplies[r.business.id] ?? 0,
  }));
  const outsidePeriod = view === "board" && !t.q && !sp.industry ? Math.max(0, totals.onBoard - all.length) : 0;
  const listQuery = new URLSearchParams({ ...(period.key === "all" ? { range: "all" } : rangeParams(period)), dateField: "updatedAt" }).toString();

  return (
    <>
      <PageHeader title="Pipeline" subtitle="Where each conversation stands. Cards move on their own until a company replies; after that, drag them." actions={<DateRangePicker basePath="/pipeline" params={keep} value={period.key} from={period.from} to={period.to} />} />

      <Tabs
        items={[
          { href: href({ view: null, kind: null, page: null }), label: "Board", count: view === "board" ? all.length : null, active: view === "board" },
          { href: href({ view: "history", page: null }), label: "History", count: history ? history.total : null, active: view === "history" },
        ]}
      />

      {view === "board" && (
        <>
          {(all.length > 12 || t.q || sp.industry) && (
            <FilterBar basePath="/pipeline" sp={sp} params={t} placeholder="Search the board by name, city or domain" hidden={["range", "from", "to"]}>
              <select className="select w-auto" name="industry" defaultValue={sp.industry ?? ""}>
                <option value="">Any industry</option>
                {listPlaybooks().map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </FilterBar>
          )}
          {readOnly && (
            <p className="mb-3 text-xs text-warn bg-warn/10 border border-warn/30 rounded-[var(--radius)] px-3 py-2" role="status">
              This preview has no persistent database, so moving cards is disabled. Connect a Turso database to the Vercel project to enable it.
            </p>
          )}
          {outsidePeriod > 0 && (
            <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted bg-surface border border-line rounded-[var(--radius)] px-3 py-2" role="status">
              <Icon name="clock" className="w-3.5 h-3.5 text-ink-faint" />
              <span className="flex-1 min-w-[200px]">
                Showing what moved in the {describeRange(period)}. {outsidePeriod} more {outsidePeriod === 1 ? "business is" : "businesses are"} on the board from before.
              </span>
              <Link href={href({ range: "all", from: null, to: null })} className="font-medium">
                Show all time
              </Link>
            </p>
          )}
          <PipelineBoard items={items} hidden={hidden} moreQuery={listQuery} />
        </>
      )}

      {view === "history" && history && (
        <Card padded={false} title={`What happened, ${describeRange(period)}`} description="Newest first. Pick a kind below to narrow it, or a period at the top right.">
          {history.counts.all === 0 ? (
            <EmptyState compact icon="note" title="Nothing happened in this period" description="Choose a longer period at the top right, for example “This month” or “All time”." />
          ) : (
            <ActivityTimeline activities={history.items} kinds={HISTORY_KINDS} kind={kind} kindHref={(k) => href({ kind: k === "all" ? null : k, page: null })} counts={history.counts} pagination={{ page: t.page, pageSize: HISTORY_PAGE_SIZE, total: history.total, href: (page) => href({ page: page > 1 ? String(page) : null }) }} />
          )}
        </Card>
      )}
    </>
  );
}
