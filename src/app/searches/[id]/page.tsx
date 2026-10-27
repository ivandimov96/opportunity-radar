import Link from "next/link";
import { notFound } from "next/navigation";
import { getSearchWithResults } from "@/lib/queries";
import { Badge, Callout, Card, EmptyState, Icon, PageHeader, ScoreRing, Stepper, StatusPill, fmtRelative } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { getPlaybook } from "@/lib/industries";
import { stageLabel } from "@/lib/pipeline/stages";
import { deriveWorkflow } from "@/lib/workflow";
import { investigateManyAction, rerunSearch } from "@/app/actions";

export default async function SearchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getSearchWithResults(id);
  if (!data) notFound();
  const { search, rows, job } = data;
  const discovering = search.status === "queued" || search.status === "running";
  const processing = rows.filter((r) => ["queued", "investigating"].includes(r.business.status)).length;
  const active = discovering || processing > 0;
  const investigable = rows.filter((r) => r.business.website && !r.business.isDemo && ["new", "failed"].includes(r.business.status)).length;
  const investigated = rows.filter((r) => r.business.status === "profiled").length;
  const withOpps = rows.filter((r) => r.business.verdict === "opportunity").length;
  const noOpp = rows.filter((r) => r.business.verdict === "no_opportunity").length;

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
            {getPlaybook(search.industry).label} · {[search.city, search.region, search.country].filter(Boolean).join(", ")} · up to {search.maxResults} · {search.providers.join(", ")} · {fmtRelative(search.createdAt)}
          </>
        }
        actions={
          <>
            <AutoRefresh active={active} label={discovering ? "Discovering" : `Investigating ${processing}`} />
            <form action={rerunSearch}>
              <input type="hidden" name="searchId" value={search.id} />
              <button className="btn" disabled={active}>
                <Icon name="refresh" /> Re-run discovery
              </button>
            </form>
            {investigable > 0 && (
              <form action={investigateManyAction}>
                <input type="hidden" name="searchId" value={search.id} />
                <button className="btn btn-primary" disabled={active}>
                  <Icon name="sparkles" /> Investigate {investigable} remaining
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
        {active && <div className="relative h-1.5 rounded-full bg-surface-3 overflow-hidden mb-3 progress-indeterminate" />}
        <ol className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Found", n: rows.length, hint: search.stats ? `${search.stats.created} new · ${search.stats.merged} merged${search.stats.skippedNoWebsite ? ` · ${search.stats.skippedNoWebsite} skipped (no site)` : ""}` : "" },
            { label: "Investigated", n: investigated, hint: `${processing} in progress · ${investigable} remaining` },
            { label: "With opportunity", n: withOpps, hint: `${noOpp} no opportunity` },
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
      </div>

      <Card title={`Businesses (${rows.length})`} description="Sorted by priority once investigated." padded={false}>
        {rows.length === 0 ? (
          <EmptyState icon="search" title={discovering ? "Discovering…" : "No businesses found"} description={discovering ? "Results appear here as providers respond." : "Try a broader area, another source, or import a CSV list."} action={!discovering && <Link href="/searches/new" className="btn">New search</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Status</th>
                  <th>Summary</th>
                  <th>Priority</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const wf = deriveWorkflow({ business: r.business, stage: r.stage ?? "lead", opportunityCount: r.oppCount ?? 0, draftCount: r.draftCount ?? 0 });
                  return (
                    <tr key={r.business.id}>
                      <td>
                        <Link href={`/businesses/${r.business.id}`} className="row-link">
                          {r.business.name}
                        </Link>{" "}
                        {r.business.isDemo && <Badge tone="demo">demo</Badge>} {!r.wasNew && <Badge title="Matched a business from an earlier search">merged</Badge>}
                        <div className="text-xs text-ink-faint truncate max-w-[300px]">
                          {r.business.websiteDomain ?? (r.business.website ? "website" : "no website")}
                          {r.business.email ? " · email" : r.business.phone ? " · phone" : ""}
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
                      <td>
                        <Badge tone="accent">{stageLabel(r.stage ?? "lead")}</Badge>
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
