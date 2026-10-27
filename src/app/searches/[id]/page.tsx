import Link from "next/link";
import { notFound } from "next/navigation";
import { getSearchWithResults } from "@/lib/queries";
import { Badge, Callout, Card, EmptyState, Icon, PageHeader, ScoreRing, Stepper, StatusPill, fmtRelative } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { getPlaybook } from "@/lib/industries";
import { stageLabel } from "@/lib/pipeline/stages";
import { deriveWorkflow } from "@/lib/workflow";
import { priorityScore } from "@/lib/scoring/score";
import { rerunSearch, researchSearchResults } from "@/app/actions";

export default async function SearchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getSearchWithResults(id);
  if (!data) notFound();
  const { search, rows, job } = data;
  const discovering = search.status === "queued" || search.status === "running";
  const processing = rows.filter((r) => ["queued", "running"].includes(r.business.researchStatus) || ["queued", "running"].includes(r.business.analysisStatus)).length;
  const active = discovering || processing > 0;
  const researchable = rows.filter((r) => r.business.website && !r.business.isDemo && r.business.researchStatus !== "done").length;
  const researched = rows.filter((r) => r.business.researchStatus === "done").length;
  const analyzed = rows.filter((r) => ["done", "insufficient_evidence"].includes(r.business.analysisStatus)).length;
  const withOpps = rows.filter((r) => (r.oppCount ?? 0) > 0).length;

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/searches", label: "Discover" }, { label: search.name }]}
        title={
          <span className="flex items-center gap-2 flex-wrap">
            {search.name} {search.isDemo && <Badge tone="demo">demo</Badge>}
          </span>
        }
        subtitle={
          <>
            {getPlaybook(search.industry).label} · {[search.city, search.region, search.country].filter(Boolean).join(", ")} · up to {search.maxResults} · sources: {search.providers.join(", ")} · {fmtRelative(search.createdAt)}
          </>
        }
        actions={
          <>
            <AutoRefresh active={active} label={discovering ? "Discovering" : `${processing} researching`} />
            <form action={rerunSearch}>
              <input type="hidden" name="searchId" value={search.id} />
              <button className="btn" disabled={active}>
                <Icon name="refresh" /> Re-run
              </button>
            </form>
            {researchable > 0 && (
              <form action={researchSearchResults}>
                <input type="hidden" name="searchId" value={search.id} />
                <input type="hidden" name="onlyUnresearched" value="on" />
                <button className="btn btn-primary" disabled={active}>
                  <Icon name="globe" /> Research {researchable} unresearched
                </button>
              </form>
            )}
          </>
        }
      />

      {search.error && (
        <div className="mb-4">
          <Callout tone={rows.length ? "warn" : "bad"} title={rows.length ? "Some sources reported problems" : "Discovery failed"}>{search.error}</Callout>
        </div>
      )}
      {search.isDemo && (
        <div className="mb-4">
          <Callout tone="demo" title="Synthetic demo search">These businesses do not exist. Use them to explore the workflow.</Callout>
        </div>
      )}

      <div className="surface p-4 mb-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <StatusPill status={search.status} />
            {discovering && job?.progress?.message && <span className="text-xs text-ink-muted">{job.progress.message}</span>}
          </div>
          <div className="text-xs text-ink-faint">{search.stats?.attribution.join(" · ")}</div>
        </div>
        {discovering && <div className="relative h-1.5 rounded-full bg-surface-3 overflow-hidden mb-3 progress-indeterminate" />}
        <ol className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Found", n: rows.length, hint: search.stats ? `${search.stats.created} new · ${search.stats.merged} merged${search.stats.skippedNoWebsite ? ` · ${search.stats.skippedNoWebsite} skipped (no site)` : ""}` : "" },
            { label: "Researched", n: researched, hint: `${rows.length - researched} remaining` },
            { label: "Analyzed", n: analyzed, hint: `${withOpps} with opportunities` },
            { label: "Draft ready", n: rows.filter((r) => (r.draftCount ?? 0) > 0).length, hint: "outreach drafted" },
          ].map((s, i) => (
            <li key={s.label} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-surface-3 text-xs font-semibold grid place-items-center text-ink-muted shrink-0">{i + 1}</span>
              <span>
                <span className="block text-xs text-ink-muted">{s.label}</span>
                <span className="block text-xl font-semibold tabular-nums leading-tight">{s.n}</span>
                <span className="block text-[11px] text-ink-faint">{s.hint}</span>
              </span>
            </li>
          ))}
        </ol>
        {Object.values(search.stats?.providerResults ?? {}).some((p) => p.error) && (
          <ul className="mt-3 text-xs text-warn">
            {Object.entries(search.stats?.providerResults ?? {})
              .filter(([, v]) => v.error)
              .map(([k, v]) => (
                <li key={k}>
                  {k}: {v.error}
                </li>
              ))}
          </ul>
        )}
      </div>

      <Card title={`Businesses (${rows.length})`} padded={false}>
        {rows.length === 0 ? (
          <EmptyState icon="search" title={discovering ? "Discovering…" : "No businesses found"} description={discovering ? "Results appear here as providers respond." : "Try a broader area, another source, or import a CSV list."} action={!discovering && <Link href="/searches/new" className="btn">New search</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>Business</th>
                  <th>Progress</th>
                  <th>Contact</th>
                  <th>Priority</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const wf = deriveWorkflow({ business: r.business, stage: r.stage ?? "discovered", opportunityCount: r.oppCount ?? 0, draftCount: r.draftCount ?? 0 });
                  return (
                    <tr key={r.business.id}>
                      <td className="text-ink-faint tabular-nums">{r.rank}</td>
                      <td>
                        <Link href={`/businesses/${r.business.id}`} className="row-link">
                          {r.business.name}
                        </Link>{" "}
                        {r.business.isDemo && <Badge tone="demo">demo</Badge>} {!r.wasNew && <Badge title="Matched a business from an earlier search">merged</Badge>}
                        <div className="text-xs text-ink-faint truncate max-w-[320px]">
                          {r.business.websiteDomain ?? (r.business.website ? "website" : "no website")}
                          {r.business.street ? ` · ${r.business.street}` : ""}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Stepper steps={wf.steps} compact />
                          <span className="text-xs text-ink-muted">{wf.next.title}</span>
                        </div>
                      </td>
                      <td className="text-xs">
                        {r.business.email ? (
                          <span className="inline-flex items-center gap-1 text-ink">
                            <Icon name="mail" className="w-3.5 h-3.5 text-ink-faint" /> email
                          </span>
                        ) : r.business.phone ? (
                          <span className="inline-flex items-center gap-1 text-ink-muted">
                            <Icon name="phone" className="w-3.5 h-3.5 text-ink-faint" /> phone
                          </span>
                        ) : (
                          <span className="text-ink-faint">none verified</span>
                        )}
                      </td>
                      <td>{r.attractiveness != null ? <ScoreRing value={priorityScore(r.attractiveness, r.confidence ?? 0)} size={36} /> : <span className="text-xs text-ink-faint">—</span>}</td>
                      <td>
                        <Badge tone="accent">{stageLabel(r.stage ?? "discovered")}</Badge>
                      </td>
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
