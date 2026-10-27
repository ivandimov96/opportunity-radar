import Link from "next/link";
import { listBusinesses, type BusinessFilters } from "@/lib/queries";
import { Badge, Card, EmptyState, Icon, PageHeader, ScoreRing, Stepper, StatusPill, fmtRelative } from "@/components/ui";
import { listPlaybooks } from "@/lib/industries";
import { PIPELINE_STAGES, stageLabel } from "@/lib/pipeline/stages";
import { deriveWorkflow } from "@/lib/workflow";
import { investigateManyAction } from "@/app/actions";

const QUICK: { key: BusinessFilters["quick"] | ""; label: string; icon: "list" | "sparkles" | "target" | "mail" | "minus" | "alert" }[] = [
  { key: "", label: "All", icon: "list" },
  { key: "needs_investigation", label: "Not investigated", icon: "sparkles" },
  { key: "has_opps", label: "Has opportunity", icon: "target" },
  { key: "drafts", label: "Has draft", icon: "mail" },
  { key: "no_opportunity", label: "No opportunity", icon: "minus" },
  { key: "failed", label: "Failed", icon: "alert" },
];

export default async function BusinessesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const f: BusinessFilters = {
    q: sp.q || undefined,
    industry: sp.industry || undefined,
    stage: sp.stage || undefined,
    status: sp.status || undefined,
    verdict: sp.verdict || undefined,
    minPriority: sp.minPriority ? Number(sp.minPriority) : undefined,
    website: (sp.website as "yes" | "no") || undefined,
    demo: (sp.demo as "hide" | "only") || undefined,
    quick: (sp.quick as BusinessFilters["quick"]) || undefined,
    sort: (sp.sort as BusinessFilters["sort"]) || "priority",
  };
  const rows = await listBusinesses(f);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/businesses${s ? `?${s}` : ""}`;
  };
  const advancedActive = Boolean(f.industry || f.stage || f.status || f.verdict || f.minPriority || f.website || f.demo);
  const investigable = rows.filter((r) => r.business.website && !r.business.isDemo && ["new", "failed"].includes(r.business.status));

  return (
    <>
      <PageHeader
        title="Businesses"
        subtitle="Every discovered business, deduplicated across searches, ranked by opportunity priority. One action per business: investigate."
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
        <span className="text-xs text-ink-faint ml-auto">{rows.length} shown</span>
      </div>
      <form className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          {f.quick && <input type="hidden" name="quick" value={f.quick} />}
          <div className="relative flex-1 min-w-[220px]">
            <Icon name="search" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input pl-8" name="q" placeholder="Search by name, city or domain" defaultValue={sp.q} />
          </div>
          <select className="select w-auto" name="sort" defaultValue={sp.sort ?? "priority"}>
            <option value="priority">Sort: priority</option>
            <option value="updated">Sort: recently updated</option>
            <option value="name">Sort: name</option>
          </select>
          <button className="btn">Apply</button>
          <Link href="/businesses" className="btn btn-ghost">
            Reset
          </Link>
        </div>
        <details className="mt-2" open={advancedActive}>
          <summary className="text-xs text-ink-muted inline-flex items-center gap-1 hover:text-ink">
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
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState icon="building" title="No businesses match" description="Adjust the filters, run a new search, or import a CSV." action={<Link href="/searches/new" className="btn btn-primary">New search</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Status</th>
                  <th>Summary</th>
                  <th>Priority</th>
                  <th>Stage · next</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const wf = deriveWorkflow({ business: r.business, stage: r.stage ?? "lead", opportunityCount: r.oppCount ?? 0, draftCount: r.draftCount ?? 0 });
                  return (
                    <tr key={r.business.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Link href={`/businesses/${r.business.id}`} className="row-link">
                            {r.business.name}
                          </Link>
                          {r.business.isDemo && <Badge tone="demo">demo</Badge>}
                        </div>
                        <div className="text-xs text-ink-faint truncate max-w-[260px]">
                          {[r.business.city, r.business.region].filter(Boolean).join(", ")}
                          {r.business.websiteDomain ? ` · ${r.business.websiteDomain}` : r.business.website ? "" : " · no website"}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Stepper steps={wf.steps} compact />
                          <StatusPill status={r.business.verdict ?? r.business.status} />
                        </div>
                      </td>
                      <td className="max-w-[360px]">
                        <div className="text-xs text-ink-muted line-clamp-2">{r.business.summary ?? r.business.statusMessage ?? wf.next.title}</div>
                      </td>
                      <td>{r.business.priority != null ? <ScoreRing value={r.business.priority} size={36} /> : <span className="text-xs text-ink-faint">—</span>}</td>
                      <td className="max-w-[220px]">
                        <Badge tone="accent">{stageLabel(r.stage ?? "lead")}</Badge>
                        {r.nextAction && (
                          <div className="text-[11px] text-ink-faint truncate mt-0.5">
                            → {r.nextAction}
                            {r.nextActionAt ? ` · ${fmtRelative(r.nextActionAt)}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="text-xs text-ink-faint whitespace-nowrap">{fmtRelative(r.business.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
