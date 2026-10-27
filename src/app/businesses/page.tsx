import Link from "next/link";
import { listBusinesses, type BusinessFilters } from "@/lib/queries";
import { Badge, Card, Empty, PageHeader, ScoreBar, StatusBadge } from "@/components/ui";
import { listPlaybooks } from "@/lib/industries";
import { PIPELINE_STAGES, stageLabel } from "@/lib/pipeline/stages";

export default async function BusinessesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const f: BusinessFilters = {
    q: sp.q || undefined,
    industry: sp.industry || undefined,
    stage: sp.stage || undefined,
    research: sp.research || undefined,
    analysis: sp.analysis || undefined,
    minAttr: sp.minAttr ? Number(sp.minAttr) : undefined,
    minConf: sp.minConf ? Number(sp.minConf) : undefined,
    website: (sp.website as "yes" | "no") || undefined,
    demo: (sp.demo as "hide" | "only") || undefined,
    sort: (sp.sort as BusinessFilters["sort"]) || "priority",
  };
  const rows = listBusinesses(f);
  return (
    <>
      <PageHeader
        title="Businesses"
        subtitle="All discovered businesses, deduplicated across searches. Sorted by priority (60% attractiveness, 40% confidence) unless changed."
        actions={
          <a href="/api/export" className="btn">
            Export CSV
          </a>
        }
      />
      <form className="card p-3 mb-4 grid grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-2 text-sm">
        <input className="input col-span-2" name="q" placeholder="Search name, city, domain" defaultValue={sp.q} />
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
        <select className="select" name="research" defaultValue={sp.research ?? ""}>
          <option value="">Any research</option>
          {["not_started", "queued", "running", "done", "failed", "no_website"].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select className="select" name="analysis" defaultValue={sp.analysis ?? ""}>
          <option value="">Any analysis</option>
          {["not_started", "done", "insufficient_evidence", "failed"].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input className="input" name="minAttr" type="number" min={0} max={100} placeholder="Min attr." defaultValue={sp.minAttr} />
        <input className="input" name="minConf" type="number" min={0} max={100} placeholder="Min conf." defaultValue={sp.minConf} />
        <select className="select" name="demo" defaultValue={sp.demo ?? ""}>
          <option value="">Real + demo</option>
          <option value="hide">Hide demo</option>
          <option value="only">Demo only</option>
        </select>
        <select className="select" name="sort" defaultValue={sp.sort ?? "priority"}>
          <option value="priority">Sort: priority</option>
          <option value="attractiveness">Sort: attractiveness</option>
          <option value="confidence">Sort: confidence</option>
          <option value="name">Sort: name</option>
          <option value="updated">Sort: updated</option>
        </select>
        <div className="col-span-2 md:col-span-5 lg:col-span-9 flex gap-2">
          <button className="btn btn-sm">Apply filters</button>
          <Link href="/businesses" className="btn btn-sm">
            Reset
          </Link>
          <span className="text-xs text-ink-faint self-center">{rows.length} shown</span>
        </div>
      </form>
      <Card>
        {rows.length === 0 ? (
          <Empty>No businesses match.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Industry</th>
                <th>Website</th>
                <th>Research</th>
                <th>Analysis</th>
                <th>Best opportunity</th>
                <th>Stage</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.business.id}>
                  <td>
                    <Link href={`/businesses/${r.business.id}`}>{r.business.name}</Link> {r.business.isDemo && <Badge tone="demo">demo</Badge>}
                    <div className="text-xs text-ink-faint">{[r.business.city, r.business.region].filter(Boolean).join(", ")}</div>
                  </td>
                  <td className="text-xs">{r.business.industry}</td>
                  <td className="text-xs">{r.business.websiteDomain ?? (r.business.website ? "yes" : <span className="text-ink-faint">none</span>)}</td>
                  <td>
                    <StatusBadge status={r.business.researchStatus} />
                  </td>
                  <td>
                    <StatusBadge status={r.business.analysisStatus} />
                  </td>
                  <td>
                    {r.attractiveness != null ? (
                      <div className="flex gap-2">
                        <ScoreBar value={r.attractiveness} label={`Attr. (${r.oppCount})`} />
                        <ScoreBar value={r.confidence ?? 0} label="Conf." tone={(r.confidence ?? 0) < 40 ? "warn" : "ok"} />
                      </div>
                    ) : (
                      <span className="text-xs text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="text-xs">{stageLabel(r.stage ?? "discovered")}</td>
                  <td className="text-xs text-ink-muted">{r.nextAction ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
