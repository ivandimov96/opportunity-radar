import Link from "next/link";
import { BUSINESS_DATE_FIELDS, BUSINESS_SORTS, listBusinesses, type BusinessFilters } from "@/lib/queries";
import { Badge, Card, Icon, PageHeader, ScoreRing, Stepper, StatusPill, fmtRelative } from "@/components/ui";
import { FilterBar, Pagination, SortHeader, TableEmpty } from "@/components/table";
import { dateBounds, parseTableParams } from "@/lib/table";
import { listPlaybooks } from "@/lib/industries";
import { PIPELINE_STAGES, stageLabel } from "@/lib/pipeline/stages";
import { deriveWorkflow, isResearchStale, researchAgeDays } from "@/lib/workflow";
import { investigateManyAction } from "@/app/actions";

const QUICK: { key: BusinessFilters["quick"] | ""; label: string; icon: "list" | "sparkles" | "target" | "mail" | "minus" | "alert" | "clock" | "eye" }[] = [
  { key: "", label: "All", icon: "list" },
  { key: "needs_investigation", label: "Not investigated", icon: "sparkles" },
  { key: "has_opps", label: "Has opportunity", icon: "target" },
  { key: "drafts", label: "Has draft", icon: "mail" },
  { key: "no_opportunity", label: "No opportunity", icon: "minus" },
  { key: "insufficient", label: "Insufficient evidence", icon: "eye" },
  { key: "stale", label: "Stale research", icon: "clock" },
  { key: "failed", label: "Failed", icon: "alert" },
  { key: "chains", label: "Chains", icon: "minus" },
];

export default async function BusinessesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const t = parseTableParams(sp, { defaultSort: "priority", sortable: [...BUSINESS_SORTS], pageSize: 50, dateFields: BUSINESS_DATE_FIELDS.map((d) => d.key) });
  const { fromIso, toIso } = dateBounds(t.from, t.to);
  const f: BusinessFilters = {
    q: t.q || undefined,
    industry: sp.industry || undefined,
    stage: sp.stage || undefined,
    status: sp.status || undefined,
    verdict: sp.verdict || undefined,
    minPriority: sp.minPriority ? Number(sp.minPriority) : undefined,
    website: (sp.website as "yes" | "no") || undefined,
    demo: (sp.demo as "hide" | "only") || undefined,
    quick: (sp.quick as BusinessFilters["quick"]) || undefined,
    sort: t.sort as BusinessFilters["sort"],
    dir: t.dir,
    dateField: (t.dateField as BusinessFilters["dateField"]) ?? "createdAt",
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
  const advancedActive = Boolean(f.industry || f.stage || f.status || f.verdict || f.minPriority || f.website || f.demo);
  const investigable = rows.filter((r) => !r.business.isDemo && r.business.kind !== "chain" && ["new", "failed", "no_website"].includes(r.business.status));

  return (
    <>
      <PageHeader
        title="Businesses"
        subtitle="Every discovered business, deduplicated across searches. Ranked by opportunity priority once investigated and by lead score before that."
        actions={
          <>
            {investigable.length > 0 && (
              <form action={investigateManyAction}>
                {investigable.map((r) => (
                  <input key={r.business.id} type="hidden" name="businessId" value={r.business.id} />
                ))}
                <button className="btn btn-primary">
                  <Icon name="sparkles" /> Investigate {investigable.length} shown
                </button>
              </form>
            )}
            <a href="/api/export" className="btn">
              <Icon name="download" /> Export CSV
            </a>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {QUICK.map((q) => (
          <Link key={q.key} href={qs({ quick: q.key || undefined })} className={`chip ${(f.quick ?? "") === q.key ? "chip-active" : ""}`}>
            <Icon name={q.icon} className="w-3.5 h-3.5" /> {q.label}
          </Link>
        ))}
        <span className="text-xs text-ink-faint ml-auto">{total} match</span>
      </div>
      <FilterBar basePath={base} sp={sp} params={t} placeholder="Search name, city, domain, email or phone" dateFields={[...BUSINESS_DATE_FIELDS]} hidden={["quick"]}>
        <details className="basis-full" open={advancedActive}>
          <summary className="text-xs text-ink-muted inline-flex items-center gap-1 hover:text-ink cursor-pointer">
            <Icon name="chevronDown" className="w-3.5 h-3.5" /> More filters {advancedActive && <Badge tone="accent">active</Badge>}
          </summary>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mt-3">
            <select className="select" name="industry" defaultValue={sp.industry ?? ""}>
              <option value="">Any industry</option>
              {listPlaybooks().map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <select className="select" name="stage" defaultValue={sp.stage ?? ""}>
              <option value="">Any stage</option>
              {PIPELINE_STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <select className="select" name="status" defaultValue={sp.status ?? ""}>
              <option value="">Any status</option>
              {["new", "queued", "investigating", "profiled", "failed", "no_website"].map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <select className="select" name="verdict" defaultValue={sp.verdict ?? ""}>
              <option value="">Any verdict</option>
              <option value="opportunity">Opportunity</option>
              <option value="no_opportunity">No opportunity</option>
              <option value="insufficient_evidence">Insufficient evidence</option>
              <option value="needs_ai">AI pending</option>
            </select>
            <input className="input" name="minPriority" type="number" min={0} max={100} placeholder="Min priority" defaultValue={sp.minPriority} />
            <select className="select" name="website" defaultValue={sp.website ?? ""}>
              <option value="">Website: any</option>
              <option value="yes">Has website</option>
              <option value="no">No website</option>
            </select>
            <select className="select" name="demo" defaultValue={sp.demo ?? ""}>
              <option value="">Real + demo</option>
              <option value="hide">Hide demo</option>
              <option value="only">Demo only</option>
            </select>
          </div>
        </details>
      </FilterBar>

      <Card padded={false}>
        {rows.length === 0 ? (
          <TableEmpty icon="building" title="No businesses match" description="Adjust the filters or the date range, run a new search, or import a CSV." action={<Link href="/searches/new" className="btn btn-primary">New search</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Business" field="name" sp={sp} params={t} basePath={base} defaultDir="asc" />
                  <th>Status</th>
                  <th>Summary</th>
                  <SortHeader label="Priority" field="priority" sp={sp} params={t} basePath={base} />
                  <th>Stage · next</th>
                  <SortHeader label="Investigated" field="investigated" sp={sp} params={t} basePath={base} />
                  <SortHeader label="Discovered" field="discovered" sp={sp} params={t} basePath={base} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const b = r.business;
                  const wf = deriveWorkflow({ business: b, stage: r.stage ?? "lead", opportunityCount: r.oppCount ?? 0, draftCount: r.draftCount ?? 0 });
                  const age = researchAgeDays(b.investigatedAt);
                  return (
                    <tr key={b.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Link href={`/businesses/${b.id}`} className="row-link">
                            {b.name}
                          </Link>
                          {b.isDemo && <Badge tone="demo">demo</Badge>}
                          {b.kind === "chain" && <Badge tone="neutral" title="Chain or franchise: deprioritized, never hidden">chain</Badge>}
                        </div>
                        <div className="text-xs text-ink-faint truncate max-w-[260px]">
                          {[b.city, b.region].filter(Boolean).join(", ")}
                          {b.websiteDomain ? ` · ${b.websiteDomain}` : b.website ? "" : " · no website"}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Stepper steps={wf.steps} compact />
                          <StatusPill status={b.verdict ?? b.status} />
                        </div>
                      </td>
                      <td className="max-w-[360px]">
                        <div className="text-xs text-ink-muted line-clamp-2">{b.summary ?? b.statusMessage ?? wf.next.title}</div>
                      </td>
                      <td>
                        {b.priority != null ? (
                          <ScoreRing value={b.priority} size={36} />
                        ) : b.leadScore != null ? (
                          <span title={`Lead score ${b.leadScore}: ${(b.leadReasons ?? []).join(", ")}`} className="inline-flex items-center gap-1 text-xs text-ink-faint">
                            <ScoreRing value={b.leadScore} size={30} tone="neutral" /> lead
                          </span>
                        ) : (
                          <span className="text-xs text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="max-w-[220px]">
                        <Badge tone="accent">{stageLabel(r.stage ?? "lead")}</Badge>
                        {r.nextAction && (
                          <div className="text-[11px] text-ink-faint truncate mt-0.5">
                            → {r.nextAction}
                            {r.nextActionAt ? ` · ${fmtRelative(r.nextActionAt)}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="text-xs whitespace-nowrap">
                        {age == null ? <span className="text-ink-faint">never</span> : <span className={isResearchStale(b.investigatedAt) ? "text-warn" : "text-ink-muted"} title={b.investigatedAt ?? undefined}>{age === 0 ? "today" : `${age} d ago`}{isResearchStale(b.investigatedAt) ? " · stale" : ""}</span>}
                      </td>
                      <td className="text-xs text-ink-faint whitespace-nowrap" title={b.createdAt}>
                        {fmtRelative(b.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && <Pagination basePath={base} sp={sp} params={t} total={total} label="businesses" />}
      </Card>
    </>
  );
}
