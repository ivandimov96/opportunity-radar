import Link from "next/link";
import { BUSINESS_DATE_FIELDS, BUSINESS_SORTS, listBusinesses, quickViewCounts, type BusinessFilters } from "@/lib/queries";
import { Badge, Card, Flash, Icon, PageHeader, ScoreRing, StatusPill, fmtRelative } from "@/components/ui";
import { stageTone } from "@/components/activity-timeline";
import { Pagination, SortHeader, TableEmpty } from "@/components/table";
import { parseTableParams } from "@/lib/table";
import { DEFAULT_RANGE, rangeBounds, rangeParams, resolveRange } from "@/lib/date-range";
import { DateRangePicker } from "@/components/date-range";
import { ConfirmButton } from "@/components/confirm-button";
import { listPlaybooks } from "@/lib/industries";
import { CONTACTED_STAGES, PIPELINE_STAGES, stageLabel, type PipelineStage } from "@/lib/pipeline/stages";
import { deriveWorkflow, isResearchStale, researchAgeDays } from "@/lib/workflow";
import { investigateManyAction, removeBusinessAction } from "@/app/actions";
import { getConfig } from "@/lib/config";

const STATUS_OPTIONS: [string, string][] = [
  ["new", "Not investigated"],
  ["queued", "Queued"],
  ["investigating", "Investigating"],
  ["profiled", "Investigated"],
  ["failed", "Failed"],
  ["no_website", "No website"],
];
const VERDICT_OPTIONS: [string, string][] = [
  ["qualified", "Qualified"],
  ["needs_review", "Needs review"],
  ["not_a_fit", "Not a fit"],
  ["insufficient_evidence", "Insufficient evidence"],
  ["no_contact", "No public email"],
];

type QuickKey = BusinessFilters["quick"] | "";
/**
 * One row of views. The first four are always there; the rest only appear when
 * they hold something (or are the view being looked at), so an empty list of
 * problems takes no room.
 */
const VIEWS: { key: QuickKey; label: string; always?: boolean }[] = [
  { key: "", label: "All", always: true },
  { key: "needs_investigation", label: "Not researched", always: true },
  { key: "qualified", label: "Qualified", always: true },
  { key: "needs_review", label: "Needs review", always: true },
  { key: "drafts", label: "Has email" },
  { key: "no_contact", label: "No public email" },
  { key: "failed", label: "Failed" },
  { key: "stale", label: "Stale research" },
  { key: "not_a_fit", label: "Not a fit" },
  { key: "chains", label: "Chains" },
];

export default async function BusinessesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const cfg = getConfig();
  const t = parseTableParams(sp, { defaultSort: "discovered", sortable: [...BUSINESS_SORTS], pageSize: 50, dateFields: BUSINESS_DATE_FIELDS.map((d) => d.key) });
  // The period: the last 7 days unless the URL says otherwise (see src/lib/date-range.ts).
  const period = resolveRange(sp);
  const { fromIso, toIso } = rangeBounds(period);
  const dateField = (BUSINESS_DATE_FIELDS.some((d) => d.key === sp.dateField) ? sp.dateField : "createdAt") as NonNullable<BusinessFilters["dateField"]>;
  const f: BusinessFilters = {
    q: t.q || undefined,
    industry: sp.industry || undefined,
    stage: sp.stage || undefined,
    status: sp.status || undefined,
    verdict: sp.verdict || undefined,
    minPriority: sp.minPriority ? Number(sp.minPriority) : undefined,
    website: (sp.website as "yes" | "no") || undefined,
    quick: (sp.quick as BusinessFilters["quick"]) || undefined,
    sort: t.sort as BusinessFilters["sort"],
    dir: t.dir,
    dateField,
    from: fromIso,
    to: toIso,
    page: t.page,
    pageSize: t.pageSize,
  };
  const { rows, total } = await listBusinesses(f);
  const base = "/businesses";
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch, page: undefined })) if (v) p.set(k, v);
    const s = p.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  const advancedActive = Boolean(f.industry || f.stage || f.status || f.verdict || f.minPriority || f.website);
  const counts = await quickViewCounts(f);
  /** Active labeled filters as pills, each with the params to drop when it is removed. */
  const activePills: { key: string; label: string; clear: Record<string, string | undefined> }[] = [];
  if (f.industry) activePills.push({ key: "industry", label: `Industry: ${listPlaybooks().find((p) => p.key === f.industry)?.label ?? f.industry}`, clear: { industry: undefined } });
  if (f.stage) activePills.push({ key: "stage", label: `Stage: ${stageLabel(f.stage)}`, clear: { stage: undefined } });
  if (f.status) activePills.push({ key: "status", label: `Research: ${STATUS_OPTIONS.find(([k]) => k === f.status)?.[1] ?? f.status}`, clear: { status: undefined } });
  if (f.verdict) activePills.push({ key: "verdict", label: `Verdict: ${VERDICT_OPTIONS.find(([k]) => k === f.verdict)?.[1] ?? f.verdict}`, clear: { verdict: undefined } });
  if (f.website) activePills.push({ key: "website", label: f.website === "yes" ? "Has website" : "No website", clear: { website: undefined } });
  if (f.minPriority) activePills.push({ key: "minPriority", label: `Priority ≥ ${f.minPriority}`, clear: { minPriority: undefined } });
  const investigable = rows.filter((r) => r.business.kind !== "chain" && ["new", "failed", "no_website"].includes(r.business.status));

  return (
    <>
      <PageHeader
        title="Businesses"
        subtitle="Every business found, once. The strongest ideas come first."
        actions={
          <>
            <Link href="/searches" className="btn btn-ghost" title="Every search you have run, with its results">
              Searches
            </Link>
            <Link href="/import" className="btn btn-ghost" title="Add businesses from a CSV file">
              Import
            </Link>
            <a href="/api/export" className="btn btn-ghost" title="Download every business as a CSV file">
              Export
            </a>
            <Link href="/searches/new" className="btn btn-primary">
              <Icon name="search" /> Find businesses
            </Link>
          </>
        }
      />
      <Flash msg={sp.ok} />
      <Flash msg={sp.error} tone="bad" />
      {/* Toolbar: search, the date range, one row of views, and the rarely needed filters behind one click. */}
      <form className="surface mb-4" action={base} method="get">
        {["sort", "dir", "pageSize", "quick", "dateField"].map((k) => (sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null))}
        {Object.entries(rangeParams(period)).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div className="flex gap-2 p-3">
          <div className="relative flex-1 min-w-0">
            <Icon name="search" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input pl-8" name="q" placeholder="Search name, city, domain, email or phone" defaultValue={t.q} aria-label="Search" />
          </div>
          <button className="btn shrink-0">Search</button>
        </div>
        <div className="px-3 pb-3">
          <DateRangePicker basePath={base} params={Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && !["range", "from", "to", "page", "ok", "error"].includes(k))) as Record<string, string>} value={period.key} from={period.from} to={period.to} fields={BUSINESS_DATE_FIELDS} field={dateField} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3" aria-label="Views">
          {VIEWS.map((q) => {
            const on = (f.quick ?? "") === q.key;
            const n = counts[q.key ?? ""] ?? 0;
            if (!q.always && !on && n === 0) return null;
            return (
              <Link key={q.key} href={qs({ quick: q.key || undefined })} aria-current={on ? "page" : undefined} className={`chip ${on ? "chip-active" : n === 0 ? "opacity-60" : ""}`}>
                {q.label}
                <span className={`tabular-nums rounded-full px-1.5 text-[11px] ${on ? "bg-accent/15" : "bg-surface-3 text-ink-faint"}`}>{n}</span>
              </Link>
            );
          })}
        </div>
        <details className="border-t border-line" open={advancedActive}>
          <summary className="flex flex-wrap items-center gap-2 px-3 py-2 cursor-pointer list-none select-none">
            <span className="btn btn-sm btn-ghost">
              <Icon name="chevronDown" className="w-3.5 h-3.5" /> Filters
              {activePills.length > 0 && <span className="ml-1 text-[11px] rounded-full px-1.5 bg-accent-soft text-accent-text">{activePills.length}</span>}
            </span>
            {activePills.map((pill) => (
              <Link key={pill.key} href={qs(pill.clear)} className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 h-7 text-xs text-ink hover:no-underline hover:bg-surface-2" title={`Remove: ${pill.label}`}>
                {pill.label}
                <Icon name="x" className="w-3 h-3 text-ink-faint" />
              </Link>
            ))}
            {activePills.length === 0 && <span className="text-xs text-ink-faint">Narrow by industry, stage, research, verdict, website or priority.</span>}
            {(activePills.length > 0 || t.q || f.quick || period.key !== DEFAULT_RANGE) && (
              <Link href={base} className="ml-auto text-xs">
                Reset
              </Link>
            )}
          </summary>
          <div className="px-3 pb-3 pt-1 border-t border-line">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <label className="block">
                <span className="label">Industry</span>
                <select className="select" name="industry" defaultValue={sp.industry ?? ""}>
                  <option value="">Any</option>
                  {listPlaybooks().map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Stage</span>
                <select className="select" name="stage" defaultValue={sp.stage ?? ""}>
                  <option value="">Any</option>
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Research</span>
                <select className="select" name="status" defaultValue={sp.status ?? ""}>
                  <option value="">Any</option>
                  {STATUS_OPTIONS.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Verdict</span>
                <select className="select" name="verdict" defaultValue={sp.verdict ?? ""}>
                  <option value="">Any</option>
                  {VERDICT_OPTIONS.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Website</span>
                <select className="select" name="website" defaultValue={sp.website ?? ""}>
                  <option value="">Any</option>
                  <option value="yes">Has website</option>
                  <option value="no">No website</option>
                </select>
              </label>
              <label className="block">
                <span className="label">Min priority</span>
                <input className="input" name="minPriority" type="number" min={0} max={100} placeholder="0–100" defaultValue={sp.minPriority} />
              </label>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button className="btn btn-primary">Apply</button>
              <Link href={qs({ industry: undefined, stage: undefined, status: undefined, verdict: undefined, website: undefined, minPriority: undefined })} className="btn btn-ghost">
                Clear filters
              </Link>
            </div>
          </div>
        </details>
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
          <TableEmpty icon="building" title="No businesses match" description={period.key === "all" ? "Adjust the filters, run a new search, or import a CSV." : "Nothing in this period. Choose a longer one (for example “All time”), adjust the filters, or run a new search."} action={<Link href="/searches/new" className="btn btn-primary">New search</Link>} />
        ) : (
          <>
            {investigable.length > 0 && (
              <form action={investigateManyAction} className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-line bg-surface-2 text-xs text-ink-muted">
                {investigable.map((r) => (
                  <input key={r.business.id} type="hidden" name="businessId" value={r.business.id} />
                ))}
                <span className="flex-1 min-w-[200px]">
                  {investigable.length} on this page {investigable.length === 1 ? "is" : "are"} not researched yet.
                </span>
                <button className="btn btn-sm" disabled={!cfg.firecrawl.enabled} title={cfg.firecrawl.enabled ? "Uses website research credits and the AI budget" : "Website research needs FIRECRAWL_API_KEY"}>
                  <Icon name="sparkles" /> Research {investigable.length} shown
                </button>
              </form>
            )}
            {f.quick === "not_a_fit" && rows.length > 0 && (
              <form action={removeBusinessAction} className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-line bg-surface-2 text-xs text-ink-muted">
                {rows.map((r) => (
                  <input key={r.business.id} type="hidden" name="businessId" value={r.business.id} />
                ))}
                <input type="hidden" name="returnTo" value="/businesses" />
                <span className="flex-1 min-w-[200px]">Removed businesses are deleted with their research and are left out of every future search.</span>
                <ConfirmButton confirmLabel="Remove" danger className="btn btn-sm btn-danger" message={`Remove the ${rows.length} business${rows.length === 1 ? "" : "es"} shown here? Their research is deleted and future searches will leave them out. You can allow one again under Settings.`}>
                  <Icon name="x" /> Remove {rows.length} shown
                </ConfirmButton>
              </form>
            )}
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader label="Business" field="name" sp={sp} params={t} basePath={base} defaultDir="asc" />
                    <th>Result</th>
                    <th>What we know</th>
                    <SortHeader label="Priority" field="priority" sp={sp} params={t} basePath={base} />
                    <th>Stage and next step</th>
                    <SortHeader label="Found" field="discovered" sp={sp} params={t} basePath={base} className="hidden xl:table-cell" />
                    <th>
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const b = r.business;
                    const wf = deriveWorkflow({ business: b, stage: r.stage ?? "discovered", opportunityCount: r.oppCount ?? 0, draftCount: r.draftCount ?? 0 });
                    const stale = isResearchStale(b.investigatedAt);
                    return (
                      <tr key={b.id}>
                        <td className="max-w-[280px]">
                          <div className="flex items-center gap-2">
                            <Link href={`/businesses/${b.id}`} className="row-link truncate">
                              {b.name}
                            </Link>
                            {b.kind === "chain" && <Badge tone="neutral" title="Chain or franchise: deprioritized, never hidden">chain</Badge>}
                          </div>
                          <div className="text-xs text-ink-faint truncate">
                            {[b.city, b.region].filter(Boolean).join(", ")}
                            {b.websiteDomain ? ` · ${b.websiteDomain}` : b.website ? "" : " · no website"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          <StatusPill status={b.verdict ?? b.status} />
                          {stale && <div className="text-[11px] text-warn mt-0.5" title={b.investigatedAt ?? undefined}>researched {researchAgeDays(b.investigatedAt)} d ago</div>}
                        </td>
                        <td className="max-w-[380px]">
                          <div className="text-xs text-ink-muted line-clamp-2">{b.summary ?? b.statusMessage ?? wf.next.description}</div>
                        </td>
                        <td>
                          {b.priority != null ? (
                            <ScoreRing value={b.priority} size={36} />
                          ) : b.leadScore != null ? (
                            <span title={`Not researched yet. Lead score ${b.leadScore}: ${(b.leadReasons ?? []).join(", ")}`} className="inline-flex items-center gap-1 text-xs text-ink-faint">
                              <ScoreRing value={b.leadScore} size={30} tone="neutral" /> lead
                            </span>
                          ) : (
                            <span className="text-xs text-ink-faint">—</span>
                          )}
                        </td>
                        <td className="max-w-[240px]">
                          <Badge tone={stageTone(r.stage ?? "discovered")}>{stageLabel(r.stage ?? "discovered")}</Badge>
                          <div className="text-[11px] text-ink-faint truncate mt-0.5">
                            → {r.nextAction ?? wf.next.title}
                            {r.nextAction && r.nextActionAt ? ` · ${fmtRelative(r.nextActionAt)}` : ""}
                          </div>
                        </td>
                        <td className="hidden xl:table-cell text-xs text-ink-faint whitespace-nowrap" title={b.createdAt}>
                          {fmtRelative(b.createdAt)}
                        </td>
                        <td className="w-10 text-right">
                          {/* Once a business has been emailed its record is kept: no remove button (the action would refuse anyway). */}
                          {!CONTACTED_STAGES.includes((r.stage ?? "discovered") as PipelineStage) && (
                            <form action={removeBusinessAction}>
                              <input type="hidden" name="businessId" value={b.id} />
                              <input type="hidden" name="returnTo" value={qs({})} />
                              <ConfirmButton confirmLabel="Remove" danger className="btn btn-ghost btn-sm text-ink-faint hover:text-bad" title={`Remove ${b.name}`} aria-label={`Remove ${b.name}`} message={`Remove ${b.name}? Its research and any unsent email are deleted, and future searches will leave it out. You can allow it again under Settings.`}>
                                <Icon name="x" />
                              </ConfirmButton>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {total > 0 && <Pagination basePath={base} sp={sp} params={t} total={total} label="businesses" />}
      </Card>
    </>
  );
}
