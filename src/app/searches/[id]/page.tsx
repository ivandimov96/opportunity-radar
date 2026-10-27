import Link from "next/link";
import { notFound } from "next/navigation";
import { getSearchWithResults } from "@/lib/queries";
import { Badge, Card, DemoBanner, Empty, PageHeader, ScoreBar, StatusBadge, fmtDate } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { getPlaybook } from "@/lib/industries";
import { stageLabel } from "@/lib/pipeline/stages";
import { rerunSearch, researchSearchResults } from "@/app/actions";

export default async function SearchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getSearchWithResults(id);
  if (!data) notFound();
  const { search, rows, job } = data;
  const active = search.status === "queued" || search.status === "running" || rows.some((r) => ["queued", "running"].includes(r.business.researchStatus) || ["queued", "running"].includes(r.business.analysisStatus));
  const researchable = rows.filter((r) => r.business.website && !r.business.isDemo).length;
  return (
    <>
      <PageHeader
        title={search.name}
        subtitle={
          <>
            {getPlaybook(search.industry).label} · {[search.city, search.region, search.country].filter(Boolean).join(", ")} · providers: {search.providers.join(", ")} · max {search.maxResults}
          </>
        }
        actions={
          <>
            <AutoRefresh active={active} />
            <form action={rerunSearch}>
              <input type="hidden" name="searchId" value={search.id} />
              <button className="btn" disabled={active}>
                Re-run discovery
              </button>
            </form>
            {researchable > 0 && (
              <form action={researchSearchResults} className="flex items-center gap-2">
                <input type="hidden" name="searchId" value={search.id} />
                <label className="text-xs text-ink-muted flex items-center gap-1">
                  <input type="checkbox" name="onlyUnresearched" defaultChecked /> only unresearched
                </label>
                <button className="btn btn-primary">Research all ({researchable})</button>
              </form>
            )}
          </>
        }
      />
      {search.isDemo && <DemoBanner>This search returned synthetic businesses to demonstrate the workflow.</DemoBanner>}
      <div className="grid md:grid-cols-4 gap-3 mb-4 text-sm">
        <div className="card p-3">
          <div className="text-xs text-ink-muted">Status</div>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={search.status} />
            {job?.progress?.message && active && <span className="text-xs text-ink-muted">{job.progress.message}</span>}
          </div>
          {search.error && <div className="text-xs text-bad mt-1">{search.error}</div>}
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-muted">Results</div>
          <div className="mt-1">
            {search.stats?.total ?? 0} total · {search.stats?.created ?? 0} new · {search.stats?.merged ?? 0} merged with existing
          </div>
          {search.stats?.skippedNoWebsite ? <div className="text-xs text-ink-faint">{search.stats.skippedNoWebsite} skipped (no website)</div> : null}
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-muted">Per provider</div>
          <ul className="mt-1 text-xs">
            {Object.entries(search.stats?.providerResults ?? {}).map(([k, v]) => (
              <li key={k}>
                {k}: {v.found} found {v.error && <span className="text-bad">— {v.error}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-muted">Attribution</div>
          <div className="mt-1 text-xs">{search.stats?.attribution.join(" · ") || "—"}</div>
          <div className="text-xs text-ink-faint">Created {fmtDate(search.createdAt)}</div>
        </div>
      </div>
      <Card title={`Businesses (${rows.length})`}>
        {rows.length === 0 ? (
          <Empty>{active ? "Discovery is running…" : "No businesses were found. Try a broader area, another provider, or a CSV import."}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Business</th>
                <th>Website</th>
                <th>Contact</th>
                <th>Research</th>
                <th>Analysis</th>
                <th>Scores</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.business.id}>
                  <td className="text-ink-faint">{r.rank}</td>
                  <td>
                    <Link href={`/businesses/${r.business.id}`}>{r.business.name}</Link> {r.business.isDemo && <Badge tone="demo">demo</Badge>} {!r.wasNew && <Badge tone="neutral" title="Matched an existing record from an earlier search">merged</Badge>}
                    <div className="text-xs text-ink-faint">{[r.business.street, r.business.city].filter(Boolean).join(", ")}</div>
                  </td>
                  <td className="text-xs">{r.business.website ? <a href={r.business.website} target="_blank" rel="noreferrer">{r.business.websiteDomain ?? r.business.website}</a> : <span className="text-ink-faint">none</span>}</td>
                  <td className="text-xs">
                    {r.business.email ?? r.business.phone ?? <span className="text-ink-faint">none verified</span>}
                  </td>
                  <td>
                    <StatusBadge status={r.business.researchStatus} />
                  </td>
                  <td>
                    <StatusBadge status={r.business.analysisStatus} />
                  </td>
                  <td>
                    {r.attractiveness != null ? (
                      <div className="flex gap-2">
                        <ScoreBar value={r.attractiveness} label="Attr." />
                        <ScoreBar value={r.confidence ?? 0} label="Conf." tone={(r.confidence ?? 0) < 40 ? "warn" : "ok"} />
                      </div>
                    ) : (
                      <span className="text-xs text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="text-xs">{stageLabel(r.stage ?? "discovered")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
