import Link from "next/link";
import { notFound } from "next/navigation";
import { getSearchWithResults } from "@/lib/queries";
import { Badge, Callout, Card, EmptyState, Icon, PageHeader, ScoreRing, Stepper, StatusPill, fmtRelative } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { getPlaybook, OPPORTUNITY_CATEGORIES, type OpportunityCategory } from "@/lib/industries";
import { describeFilters } from "@/lib/search-input";
import { leadScore } from "@/lib/scoring/lead";
import { stageLabel } from "@/lib/pipeline/stages";
import { deriveWorkflow } from "@/lib/workflow";
import { investigateManyAction, rerunSearch } from "@/app/actions";
import { FilterBar, SortHeader } from "@/components/table";
import { parseTableParams } from "@/lib/table";

const PROVIDER_LABEL: Record<string, string> = { overture: "Overture Maps", osm: "OpenStreetMap", google_places: "Google Places", tx_permits: "Texas permits", csv: "CSV", demo: "Demo" };
const fmtSec = (ms?: number | null) => (ms == null ? "" : `${(ms / 1000).toFixed(1)} s`);

export default async function SearchDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = parseTableParams(sp, { defaultSort: "priority", sortable: ["priority", "lead", "name", "status", "rank"] });
  const data = await getSearchWithResults(id, { q: t.q || undefined, sort: t.sort as "priority", dir: t.dir });
  if (!data) notFound();
  const { search, rows, job } = data;
  const st = search.stats;
  const discovering = search.status === "queued" || search.status === "running";
  const processing = rows.filter((r) => ["queued", "investigating"].includes(r.business.status)).length;
  const active = discovering || processing > 0;
  const investigable = rows.filter((r) => !r.business.isDemo && r.business.kind !== "chain" && ["new", "failed", "no_website"].includes(r.business.status)).length;
  const chains = rows.filter((r) => r.business.kind === "chain").length;
  const investigated = rows.filter((r) => r.business.status === "profiled").length;
  const withOpps = rows.filter((r) => r.business.verdict === "opportunity").length;
  const noOpp = rows.filter((r) => r.business.verdict === "no_opportunity").length;
  const noSite = rows.filter((r) => r.business.status === "no_website").length;
  const failed = rows.filter((r) => r.business.status === "failed").length;
  const withEmail = rows.filter((r) => r.business.email).length;
  const withPhone = rows.filter((r) => r.business.phone).length;
  const withSite = rows.filter((r) => r.business.website).length;
  const skipped = [
    st?.skippedNoWebsite ? `${st.skippedNoWebsite} no website` : "",
    st?.skippedNoPhone ? `${st.skippedNoPhone} no phone` : "",
    st?.skippedChains ? `${st.skippedChains} chains` : "",
    st?.skippedKnown ? `${st.skippedKnown} already known` : "",
  ].filter(Boolean);

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
            {getPlaybook(search.industry).label} · {[search.city, search.region, search.country].filter(Boolean).join(", ")} · up to {search.maxResults} · {search.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(" + ")} · {fmtRelative(search.createdAt)}
            <span className="block text-xs text-ink-faint mt-1">{describeFilters(search).join(" · ")}</span>
          </>
        }
        actions={
          <>
            <AutoRefresh active={active} label={discovering ? "Discovering" : `Investigating ${processing}`} />
            {rows.length > 0 && (
              <a href={`/api/export?searchId=${search.id}`} className="btn" title="Everything collected for this search as CSV">
                <Icon name="download" /> Export CSV
              </a>
            )}
            <Link href={`/searches/new?industry=${encodeURIComponent(search.industry)}&city=${encodeURIComponent(search.city ?? "")}&region=${encodeURIComponent(search.region ?? "")}`} className="btn" title="Start a new search prefilled with this industry and place">
              <Icon name="plus" /> New search like this
            </Link>
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
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <StatusPill status={search.status} />
            {discovering && job?.progress?.message && <span className="text-xs text-ink-muted">{job.progress.message}</span>}
            {!discovering && st?.durationMs != null && <span className="text-xs text-ink-faint">discovery took {fmtSec(st.durationMs)}</span>}
          </div>
          <div className="text-xs text-ink-faint">{st?.area ? `Area: ${st.area}` : ""}</div>
        </div>
        {active && <div className="relative h-1.5 rounded-full bg-surface-3 overflow-hidden mb-3 progress-indeterminate" />}
        <ol className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Found", n: rows.length, hint: st ? [st.candidates != null ? `${st.candidates} candidates` : "", `${st.created} new`, `${st.merged} merged`, ...skipped].filter(Boolean).join(" · ") : "" },
            { label: "Investigated", n: investigated, hint: `${processing} in progress · ${investigable} remaining${failed ? ` · ${failed} failed` : ""}${noSite ? ` · ${noSite} no website found` : ""}` },
            { label: "With opportunity", n: withOpps, hint: `${noOpp} no opportunity` },
            { label: "Reachable", n: withEmail, hint: `${withEmail} email · ${withPhone} phone · ${withSite} website` },
          ].map((s, i) => (
            <li key={s.label} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-surface-3 text-xs font-semibold grid place-items-center text-ink-muted shrink-0">{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-xs text-ink-muted">{s.label}</span>
                <span className="block text-xl font-semibold tabular-nums leading-tight">{s.n}</span>
                <span className="block text-[11px] text-ink-faint">{s.hint}</span>
              </span>
            </li>
          ))}
        </ol>
        {st && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-ink-muted hover:text-ink">Discovery details: sources, filters and the full log</summary>
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <div>
                <div className="label mb-1">Sources</div>
                <ul className="text-xs space-y-1">
                  {Object.entries(st.providerResults).map(([k, r]) => (
                    <li key={k} className="flex gap-2">
                      <span className="font-medium w-32 shrink-0">{PROVIDER_LABEL[k] ?? k}</span>
                      <span className={r.error ? "text-bad" : "text-ink-muted"}>{r.error ? r.error : `${r.found} candidate(s)`}{r.durationMs != null ? ` · ${fmtSec(r.durationMs)}` : ""}</span>
                    </li>
                  ))}
                </ul>
                <div className="label mt-3 mb-1">Filters</div>
                <ul className="text-xs text-ink-muted space-y-0.5">
                  {describeFilters(search).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  <li>result cap {search.maxResults}</li>
                </ul>
                {st.attribution.length > 0 && (
                  <>
                    <div className="label mt-3 mb-1">Attribution</div>
                    <ul className="text-xs text-ink-faint space-y-0.5">
                      {st.attribution.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <div>
                <div className="label mb-1">Log</div>
                {st.notes?.length ? (
                  <ol className="text-xs text-ink-muted space-y-0.5 list-decimal pl-4">
                    {st.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs text-ink-faint">No log for this run (searches created before logging was added).</p>
                )}
              </div>
            </div>
          </details>
        )}
      </div>

      {(rows.length > 0 || t.q) && <FilterBar basePath={`/searches/${search.id}`} sp={sp} params={t} placeholder="Search within results: name, city, domain or street" />}
      <Card title={`Businesses (${rows.length})`} description={`Sorted by priority once investigated, lead score before that.${chains ? ` ${chains} chain/franchise record${chains === 1 ? "" : "s"} set aside (investigate them from their own page if wanted).` : ""}`} padded={false}>
        {rows.length === 0 ? (
          <EmptyState icon="search" title={discovering ? "Discovering…" : t.q ? "No results match" : "No businesses found"} description={discovering ? "Results appear here as providers respond." : t.q ? "Try another search term." : "Try a broader area, another source, or import a CSV list."} action={!discovering && !t.q && <Link href="/searches/new" className="btn">New search</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Business" field="name" sp={sp} params={t} basePath={`/searches/${search.id}`} defaultDir="asc" />
                  <th>Contact</th>
                  <SortHeader label="Status" field="status" sp={sp} params={t} basePath={`/searches/${search.id}`} defaultDir="asc" />
                  <th>Opportunity</th>
                  <SortHeader label="Score" field="priority" sp={sp} params={t} basePath={`/searches/${search.id}`} />
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const b = r.business;
                  const wf = deriveWorkflow({ business: b, stage: r.stage ?? "lead", opportunityCount: r.oppCount ?? 0, draftCount: r.draftCount ?? 0 });
                  const inv = r.investigation;
                  return (
                    <tr key={b.id}>
                      <td className="max-w-[300px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Link href={`/businesses/${b.id}`} className="row-link">
                            {b.name}
                          </Link>
                          {b.isDemo && <Badge tone="demo">demo</Badge>}
                          {!r.wasNew && <Badge title="Matched a business from an earlier search">merged</Badge>}
                          {b.kind === "chain" && <Badge tone="neutral" title="Chain or franchise: deprioritized, never hidden">chain</Badge>}
                        </div>
                        <div className="text-xs text-ink-faint truncate">
                          {[b.street, b.city].filter(Boolean).join(", ") || "no address"}
                          {b.category ? ` · ${b.category.replace(/_/g, " ")}` : ""}
                        </div>
                        <div className="text-[11px] text-ink-faint">{r.sources.map((s) => PROVIDER_LABEL[s] ?? s).join(" + ")}</div>
                      </td>
                      <td className="max-w-[220px]">
                        <div className="text-xs truncate">
                          {b.website ? (
                            <a href={b.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5">
                              {b.websiteDomain ?? "website"} <Icon name="external" className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-warn">{b.status === "no_website" ? "no website found" : "no website yet"}</span>
                          )}
                          {b.websiteSource && /^found_/.test(b.websiteSource) && <Badge className="ml-1" tone="info" title="Located by the website finder and verified">found</Badge>}
                        </div>
                        <div className="text-xs text-ink-muted truncate">{b.phone ?? <span className="text-ink-faint">no phone</span>}</div>
                        <div className="text-xs text-ink-muted truncate">{b.email ? <a href={`mailto:${b.email}`}>{b.email}</a> : <span className="text-ink-faint">no email</span>}</div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Stepper steps={wf.steps} compact />
                          <StatusPill status={b.verdict ?? b.status} />
                        </div>
                        <div className="text-[11px] text-ink-faint mt-1 max-w-[260px] truncate" title={b.statusMessage ?? undefined}>
                          {inv ? `${inv.pagesFetched} page(s) · ${inv.factsVerified} facts · ${fmtSec(inv.durationMs)}` : b.statusMessage ?? ""}
                        </div>
                      </td>
                      <td className="max-w-[300px]">
                        {r.topOpp ? (
                          <>
                            <div className="text-xs line-clamp-2">{r.topOpp.title}</div>
                            <div className="text-[11px] text-ink-faint">
                              {OPPORTUNITY_CATEGORIES[r.topOpp.category as OpportunityCategory] ?? r.topOpp.category}
                              {(r.oppCount ?? 0) > 1 ? ` · +${(r.oppCount ?? 0) - 1} more` : ""} · {r.topOpp.source === "rules" ? "rule-based" : r.topOpp.source === "demo" ? "demo" : "AI"}
                              {(r.draftCount ?? 0) > 0 ? ` · ${r.draftCount} draft${r.draftCount === 1 ? "" : "s"}` : ""}
                            </div>
                          </>
                        ) : (
                          <div className="text-xs text-ink-faint line-clamp-2">{b.summary ?? (b.verdict === "no_opportunity" ? "No compelling opportunity" : "—")}</div>
                        )}
                      </td>
                      <td>
                        {b.priority != null ? (
                          <span title={`Priority ${b.priority}: attractiveness ${b.bestAttractiveness}, confidence ${b.bestConfidence}`}>
                            <ScoreRing value={b.priority} size={36} />
                          </span>
                        ) : b.leadScore != null ? (
                          <span title={`Lead score ${b.leadScore}: ${leadScore(b).reasons.join(", ")}`} className="inline-flex items-center gap-1 text-xs text-ink-faint">
                            <ScoreRing value={b.leadScore} size={30} tone="neutral" /> lead
                          </span>
                        ) : (
                          <span className="text-xs text-ink-faint">—</span>
                        )}
                      </td>
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
