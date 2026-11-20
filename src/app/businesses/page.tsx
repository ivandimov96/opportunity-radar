import Link from "next/link";
import { BUSINESS_DATE_FIELDS, BUSINESS_SORTS, RESULT_FILTERS, businessFilterOptions, listBusinesses, quickViewCounts, type BusinessFilters } from "@/lib/queries";
import { Badge, Card, Flash, Icon, PageHeader, ScoreRing, StatusPill, fmtRelative } from "@/components/ui";
import { stageTone } from "@/components/activity-timeline";
import { Pagination, SortHeader, TableEmpty } from "@/components/table";
import { parseTableParams } from "@/lib/table";
import { DEFAULT_RANGE, describeRange, rangeBounds, rangeParams, resolveRange } from "@/lib/date-range";
import { DateRangePicker } from "@/components/date-range";
import { ConfirmButton } from "@/components/confirm-button";
import { listPlaybooks } from "@/lib/industries";
import { CONTACTED_STAGES, PIPELINE_STAGES, stageLabel, type PipelineStage } from "@/lib/pipeline/stages";
import { isResearchStale, researchAgeDays } from "@/lib/workflow";
import { investigateManyAction, removeBusinessAction } from "@/app/actions";
import { getConfig } from "@/lib/config";
import { formatPhone } from "@/lib/phone";
import { dueTag } from "@/lib/due";

const STATUS_OPTIONS: [string, string][] = [
  ["new", "Not researched"],
  ["queued", "Queued"],
  ["investigating", "Researching"],
  ["profiled", "Researched"],
  ["failed", "Failed"],
  ["no_website", "No website"],
];
const VERDICT_OPTIONS: [string, string][] = [
  ["qualified", "Qualified"],
  ["needs_review", "Needs review"],
  ["not_a_fit", "Not a fit"],
  ["insufficient_evidence", "Too little info"],
  ["no_contact", "No email"],
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
  { key: "no_contact", label: "No email" },
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
    category: sp.category || undefined,
    city: sp.city || undefined,
    searchId: sp.search || undefined,
    result: RESULT_FILTERS.some((r) => r.key === sp.result) ? sp.result : undefined,
    contact: (["email", "phone", "website", "no_email", "no_website"] as const).find((c) => c === sp.contact),
    minRating: Number(sp.minRating) > 0 ? Number(sp.minRating) : undefined,
    minReviews: Number(sp.minReviews) > 0 ? Number(sp.minReviews) : undefined,
    minScore: Number(sp.minScore) > 0 ? Number(sp.minScore) : undefined,
    due: (["overdue", "today", "planned", "none"] as const).find((c) => c === sp.due),
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
  const options = await businessFilterOptions();
  const CONTACT: Record<string, string> = { email: "Has an email", phone: "Has a phone", website: "Has a website", no_email: "No email yet", no_website: "No website" };
  const DUE: Record<string, string> = { overdue: "Overdue", today: "Due today", planned: "Any planned", none: "Nothing planned" };
  const counts = await quickViewCounts(f);
  /** Active filters as pills, each with the params to drop when it is removed. */
  const activePills: { key: string; label: string; clear: Record<string, string | undefined> }[] = [];
  if (f.category) activePills.push({ key: "category", label: f.category, clear: { category: undefined } });
  if (f.city) activePills.push({ key: "city", label: f.city, clear: { city: undefined } });
  if (f.searchId) activePills.push({ key: "search", label: `Found by: ${options.searches.find((x) => x.id === f.searchId)?.name ?? "a search"}`, clear: { search: undefined } });
  if (f.result) activePills.push({ key: "result", label: RESULT_FILTERS.find((r) => r.key === f.result)!.label, clear: { result: undefined } });
  if (f.stage) activePills.push({ key: "stage", label: `Stage: ${stageLabel(f.stage)}`, clear: { stage: undefined } });
  if (f.contact) activePills.push({ key: "contact", label: CONTACT[f.contact], clear: { contact: undefined } });
  if (f.minReviews) activePills.push({ key: "minReviews", label: `${f.minReviews}+ reviews`, clear: { minReviews: undefined } });
  if (f.minRating) activePills.push({ key: "minRating", label: `Rated ${f.minRating}+`, clear: { minRating: undefined } });
  if (f.minScore) activePills.push({ key: "minScore", label: `Score ${f.minScore}+`, clear: { minScore: undefined } });
  if (f.due) activePills.push({ key: "due", label: `Next action: ${DUE[f.due].toLowerCase()}`, clear: { due: undefined } });
  // Older links may still carry these; they keep working and can be removed like the others.
  if (f.industry) activePills.push({ key: "industry", label: `Type: ${listPlaybooks().find((pb) => pb.key === f.industry)?.label ?? f.industry}`, clear: { industry: undefined } });
  if (f.status) activePills.push({ key: "status", label: `Research: ${STATUS_OPTIONS.find(([k]) => k === f.status)?.[1] ?? f.status}`, clear: { status: undefined } });
  if (f.verdict) activePills.push({ key: "verdict", label: `Result: ${VERDICT_OPTIONS.find(([k]) => k === f.verdict)?.[1] ?? f.verdict}`, clear: { verdict: undefined } });
  if (f.website) activePills.push({ key: "website", label: f.website === "yes" ? "Has a website" : "No website", clear: { website: undefined } });
  if (f.minPriority) activePills.push({ key: "minPriority", label: `Priority ${f.minPriority}+`, clear: { minPriority: undefined } });
  const advancedActive = activePills.length > 0;
  const FILTER_KEYS = ["category", "city", "search", "result", "stage", "contact", "minReviews", "minRating", "minScore", "due", "industry", "status", "verdict", "website", "minPriority"];
  const investigable = rows.filter((r) => r.business.kind !== "chain" && ["new", "failed", "no_website"].includes(r.business.status));

  return (
    <>
      <PageHeader
        title="Businesses"
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
        {/* Search and the period on one line. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
          <div className="relative flex-1 min-w-[14rem]">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input pl-9" name="q" placeholder="Search name, kind, city, website, email or phone" defaultValue={t.q} aria-label="Search" />
          </div>
          <button className="btn shrink-0">Search</button>
          <span className="hidden lg:block w-px self-stretch bg-line" aria-hidden />
          <DateRangePicker basePath={base} params={Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && !["range", "from", "to", "page", "ok", "error"].includes(k))) as Record<string, string>} value={period.key} from={period.from} to={period.to} fields={BUSINESS_DATE_FIELDS} field={dateField} />
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-4" aria-label="Views">
          {VIEWS.map((q) => {
            const on = (f.quick ?? "") === q.key;
            const n = counts[q.key ?? ""] ?? 0;
            if (!q.always && !on && n === 0) return null;
            return (
              <Link key={q.key} href={qs({ quick: q.key || undefined })} aria-current={on ? "page" : undefined} className={`chip ${on ? "chip-active" : n === 0 ? "opacity-60" : ""}`}>
                {q.label}
                <span className={`tabular-nums rounded-full px-1.5 text-xs ${on ? "bg-accent/15" : "bg-surface-3 text-ink-faint"}`}>{n}</span>
              </Link>
            );
          })}
        </div>
        <details className="border-t border-line" open={advancedActive}>
          <summary className="flex flex-wrap items-center gap-2 px-4 py-2.5 cursor-pointer list-none select-none">
            <span className="btn btn-sm">
              <Icon name="chevronDown" className="w-3.5 h-3.5" /> More filters
              {activePills.length > 0 && <span className="ml-1 text-xs rounded-full px-1.5 bg-accent-soft text-accent-text">{activePills.length}</span>}
            </span>
            {activePills.map((pill) => (
              <Link key={pill.key} href={qs(pill.clear)} className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 h-7 text-xs text-ink hover:no-underline hover:bg-surface-2" title={`Remove: ${pill.label}`}>
                {pill.label}
                <Icon name="x" className="w-3 h-3 text-ink-faint" />
              </Link>
            ))}
            {(activePills.length > 0 || t.q || f.quick || period.key !== DEFAULT_RANGE) && (
              <Link href={base} className="ml-auto btn btn-sm btn-ghost">
                Reset everything
              </Link>
            )}
          </summary>
          <div className="px-4 pb-4 pt-3 border-t border-line">
            {/* Every choice comes from the businesses you have: the kinds, cities and searches that actually occur. */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              <label className="block">
                <span className="label">Kind of business</span>
                <select className="select" name="category" defaultValue={sp.category ?? ""}>
                  <option value="">Any kind</option>
                  {options.categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.value.replace(/_/g, " ")} ({c.n})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">City</span>
                <select className="select" name="city" defaultValue={sp.city ?? ""}>
                  <option value="">Any city</option>
                  {options.cities.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.value} ({c.n})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Found by search</span>
                <select className="select" name="search" defaultValue={sp.search ?? ""}>
                  <option value="">Any search</option>
                  {options.searches.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.n})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Result</span>
                <select className="select" name="result" defaultValue={f.result ?? ""}>
                  <option value="">Any result</option>
                  {RESULT_FILTERS.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Stage</span>
                <select className="select" name="stage" defaultValue={sp.stage ?? ""}>
                  <option value="">Any stage</option>
                  {PIPELINE_STAGES.map((st) => (
                    <option key={st.key} value={st.key}>
                      {st.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Contact</span>
                <select className="select" name="contact" defaultValue={f.contact ?? ""}>
                  <option value="">Any</option>
                  {Object.entries(CONTACT).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Reviews</span>
                <select className="select" name="minReviews" defaultValue={f.minReviews ? String(f.minReviews) : ""}>
                  <option value="">Any number</option>
                  {[5, 20, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n} or more
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Rating</span>
                <select className="select" name="minRating" defaultValue={f.minRating ? String(f.minRating) : ""}>
                  <option value="">Any rating</option>
                  {[3.5, 4, 4.5].map((n) => (
                    <option key={n} value={n}>
                      {n} ★ or more
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Score</span>
                <select className="select" name="minScore" defaultValue={f.minScore ? String(f.minScore) : ""}>
                  <option value="">Any score</option>
                  {[50, 70, 80, 90].map((n) => (
                    <option key={n} value={n}>
                      {n} or more
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Next action</span>
                <select className="select" name="due" defaultValue={f.due ?? ""}>
                  <option value="">Any</option>
                  {Object.entries(DUE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button className="btn btn-primary">Apply</button>
              <Link href={qs(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))} className="btn btn-ghost">
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
            <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-line">
              <h2 className="text-base font-semibold leading-6">
                {total} {total === 1 ? "business" : "businesses"}
              </h2>
              <span className="text-sm text-ink-muted">{VIEWS.find((v) => (v.key ?? "") === (f.quick ?? ""))?.label ?? "All"}{period.key === "all" ? ", all time" : `, ${describeRange(period)}`}</span>
              {investigable.length > 0 && (
                <form action={investigateManyAction} className="ml-auto">
                  {investigable.map((r) => (
                    <input key={r.business.id} type="hidden" name="businessId" value={r.business.id} />
                  ))}
                  <button className="btn btn-sm" disabled={!cfg.firecrawl.enabled} title={cfg.firecrawl.enabled ? "Uses website research credits and the AI budget" : "Website research needs FIRECRAWL_API_KEY"}>
                    <Icon name="sparkles" /> Research {investigable.length} shown
                  </button>
                </form>
              )}
            </div>
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
            {/* The table always fits its card: fixed column shares, long values are cut with "…" (the full value is in the tooltip), and the least needed columns step aside on a narrower window. Nothing scrolls sideways. */}
            <div className="overflow-hidden">
              <table className="table md:table-fixed">
                <colgroup className="hidden md:table-column-group">
                  <col className="md:w-[19%]" />
                  <col className="md:w-[14%]" />
                  <col className="md:w-[18%]" />
                  <col className="hidden lg:table-column lg:w-[7.5rem]" />
                  <col className="md:w-[15%]" />
                  <col className="md:w-[4.5rem]" />
                  <col className="md:w-[15%]" />
                  <col className="hidden xl:table-column xl:w-[7%]" />
                  <col className="md:w-11" />
                </colgroup>
                <thead>
                  <tr>
                    <SortHeader label="Business" field="name" sp={sp} params={t} basePath={base} defaultDir="asc" />
                    <th>Website</th>
                    <th>Contact</th>
                    <th className="hidden lg:table-cell">Reviews</th>
                    <th>Result</th>
                    <SortHeader label="Score" field="priority" sp={sp} params={t} basePath={base} />
                    <th>Stage</th>
                    <SortHeader label="Found" field="discovered" sp={sp} params={t} basePath={base} className="hidden xl:table-cell" />
                    <th>
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const b = r.business;
                    const stale = isResearchStale(b.investigatedAt);
                    const due = r.nextAction ? dueTag(r.nextActionAt) : null;
                    const dash = <span className="text-ink-faint">—</span>;
                    return (
                      <tr key={b.id}>
                        <td className="overflow-hidden">
                          <div className="flex items-center gap-2 min-w-0">
                            <Link href={`/businesses/${b.id}`} className="row-link truncate" title={b.name}>
                              {b.name}
                            </Link>
                            {b.kind === "chain" && <Badge tone="neutral" title="Chain or franchise">chain</Badge>}
                          </div>
                          <div className="text-xs text-ink-faint truncate">{[b.city, b.region].filter(Boolean).join(", ")}</div>
                        </td>
                        <td className="text-sm overflow-hidden">
                          {b.website ? (
                            <a href={b.website} target="_blank" rel="noreferrer" className="truncate block" title={b.website}>
                              {b.websiteDomain ?? b.website}
                            </a>
                          ) : (
                            dash
                          )}
                        </td>
                        <td className="text-sm overflow-hidden">
                          {b.email && (
                            <div className="truncate" title={b.email}>
                              {b.email}
                            </div>
                          )}
                          {b.phone && (
                            <a href={`tel:${b.phone}`} className={`block truncate tabular-nums hover:no-underline ${b.email ? "text-xs text-ink-muted" : "text-ink"}`}>
                              {formatPhone(b.phone, b.country)}
                            </a>
                          )}
                          {!b.email && !b.phone && dash}
                        </td>
                        <td className="hidden lg:table-cell text-sm tabular-nums whitespace-nowrap">
                          {b.rating != null ? (
                            <>
                              <span className="font-semibold">{b.rating.toFixed(1)}</span>
                              <span className="text-warn"> ★</span>
                              {b.reviewCount != null && <span className="text-ink-faint" title={`${b.reviewCount.toLocaleString()} reviews`}> ({b.reviewCount.toLocaleString()})</span>}
                            </>
                          ) : (
                            dash
                          )}
                        </td>
                        <td className="overflow-hidden">
                          <StatusPill status={b.verdict ?? b.status} />
                          {stale && <div className="text-xs text-warn mt-0.5" title={b.investigatedAt ?? undefined}>{researchAgeDays(b.investigatedAt)} d old</div>}
                        </td>
                        <td>
                          {b.priority != null ? (
                            <span title="Priority after research">
                              <ScoreRing value={b.priority} size={34} />
                            </span>
                          ) : b.leadScore != null ? (
                            <span title={`Listing score before research: ${(b.leadReasons ?? []).join(", ")}`}>
                              <ScoreRing value={b.leadScore} size={34} />
                            </span>
                          ) : (
                            dash
                          )}
                        </td>
                        <td className="overflow-hidden">
                          <Badge tone={stageTone(r.stage ?? "discovered")}>{stageLabel(r.stage ?? "discovered")}</Badge>
                          {r.nextAction && (
                            <div className="mt-1" title={`Next action: ${r.nextAction}`}>
                              <Badge tone={due?.tone ?? "neutral"}>
                                <Icon name="clock" className="w-3 h-3" /> {due?.label ?? "Planned"}
                              </Badge>
                            </div>
                          )}
                        </td>
                        <td className="hidden xl:table-cell text-xs text-ink-faint whitespace-nowrap" title={b.createdAt}>
                          {fmtRelative(b.createdAt)}
                        </td>
                        <td className="text-right !px-1">
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
