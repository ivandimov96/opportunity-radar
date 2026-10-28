import Link from "next/link";
import { notFound } from "next/navigation";
import { CANDIDATE_SORTS, getSearchCandidates, getSearchOverview, type CandidateSort } from "@/lib/queries";
import { Badge, Callout, Card, EmptyState, Icon, PageHeader, StatusPill, fmtRelative } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { getPlaybook } from "@/lib/industries";
import { PROVIDER_LABEL } from "@/lib/discovery";
import { describeFilters } from "@/lib/search-input";
import { countryName, regionName } from "@/lib/geo/world";
import { getConfig } from "@/lib/config";
import { investigateManyAction, rerunSearch, saveCandidatesAction } from "@/app/actions";
import { FilterBar, Pagination } from "@/components/table";
import { dateBounds, parseTableParams } from "@/lib/table";
import { CandidateTable } from "./candidate-table";

const fmtSec = (ms?: number | null) => (ms == null ? "" : `${(ms / 1000).toFixed(1)} s`);

export default async function SearchDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const overview = await getSearchOverview(id);
  if (!overview) notFound();
  const { search, job, businessStats } = overview;
  const t = parseTableParams(sp, { defaultSort: "rank", defaultDir: "asc", sortable: [...CANDIDATE_SORTS], dateFields: ["discovered"] });
  const { fromIso, toIso } = dateBounds(t.from, t.to);
  const pick = <T extends string>(v: string | undefined, allowed: T[]): T | undefined => (allowed.includes(v as T) ? (v as T) : undefined);
  const data = await getSearchCandidates(id, { q: t.q || undefined, source: sp.source || undefined, website: pick(sp.website, ["yes", "no"]), phone: pick(sp.phone, ["yes", "no"]), saved: pick(sp.saved, ["yes", "no"]), sort: t.sort as CandidateSort, dir: t.dir, page: t.page, pageSize: t.pageSize, from: fromIso, to: toIso });
  const st = search.stats;
  const cfg = getConfig();
  const discovering = search.status === "queued" || search.status === "running";
  const active = discovering || businessStats.processing > 0;
  const filtered = Boolean(t.q || sp.source || sp.website || sp.phone || sp.saved || t.from || t.to);
  const failedSources = Object.entries(st?.providerResults ?? {}).filter(([, r]) => r.error && !/planned integration/i.test(r.error));
  const okSources = Object.entries(st?.providerResults ?? {}).filter(([, r]) => !r.error);
  const unsaved = data.counts.total - data.counts.saved;
  const base = `/searches/${search.id}`;
  const playbook = getPlaybook(search.industry);
  const where = [search.city, search.region ? regionName(search.country, search.region) : null, countryName(search.country)].filter(Boolean).join(", ");

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
            {search.filters?.customCategory ? `“${search.filters.customCategory}”` : playbook.label} · {where} · up to {search.maxResults} · {search.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(" + ")} · {fmtRelative(search.createdAt)}
            <span className="block text-xs text-ink-faint mt-1">{describeFilters(search).join(" · ")}</span>
          </>
        }
        actions={
          <>
            <AutoRefresh active={active} label={discovering ? "Searching" : `Researching ${businessStats.processing}`} />
            {businessStats.saved > 0 && (
              <a href={`/api/export?searchId=${search.id}`} className="btn" title="Saved businesses of this search as CSV">
                <Icon name="download" /> Export CSV
              </a>
            )}
            <Link href={`/searches/new?industry=${encodeURIComponent(search.industry)}&country=${encodeURIComponent(search.country)}&city=${encodeURIComponent(search.city ?? "")}&region=${encodeURIComponent(search.region ?? "")}`} className="btn" title="Start a new search prefilled with this type and place">
              <Icon name="plus" /> New search like this
            </Link>
            <form action={rerunSearch}>
              <input type="hidden" name="searchId" value={search.id} />
              <button className="btn" disabled={active} title="Run the sources again (cached cells are reused; only missing or stale cells are read)">
                <Icon name="refresh" /> Run again
              </button>
            </form>
            {unsaved > 0 && !discovering && (
              <form action={saveCandidatesAction}>
                <input type="hidden" name="searchId" value={search.id} />
                <input type="hidden" name="all" value="on" />
                <button className="btn btn-primary">
                  <Icon name="plus" /> Save all {unsaved} unsaved
                </button>
              </form>
            )}
            {businessStats.investigable > 0 && (
              <form action={investigateManyAction}>
                <input type="hidden" name="searchId" value={search.id} />
                <button className="btn btn-primary" disabled={active || !cfg.firecrawl.enabled} title={cfg.firecrawl.enabled ? "Queue website research for the saved businesses that have none yet" : "Research needs FIRECRAWL_API_KEY"}>
                  <Icon name="sparkles" /> Research {businessStats.investigable} saved
                </button>
              </form>
            )}
          </>
        }
      />

      {search.status === "failed" && (
        <div className="mb-4">
          <Callout tone="bad" title="Search failed">{search.error ?? "No source answered."}</Callout>
        </div>
      )}
      {search.status === "done" && failedSources.length > 0 && (
        <div className="mb-4">
          <Callout tone="warn" title={okSources.length ? "Some sources failed; results are from the ones that answered" : "No source answered"}>
            <ul className="text-xs space-y-0.5">
              {failedSources.map(([k, r]) => (
                <li key={k}>
                  <strong>{PROVIDER_LABEL[k] ?? k}:</strong> {r.error}
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      )}
      {search.isDemo && (
        <div className="mb-4">
          <Callout tone="demo" title="Synthetic demo search">These businesses do not exist. Use them to explore the workflow.</Callout>
        </div>
      )}

      <div className="surface p-4 mb-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill status={search.status} label={discovering ? (search.status === "queued" ? "Queued" : "Searching") : search.status === "done" ? (failedSources.length ? "Partial" : data.counts.total ? "Results" : "No results") : "Failed"} />
            {discovering && job?.progress?.message && <span className="text-xs text-ink-muted">{job.progress.message}</span>}
            {!discovering && st?.durationMs != null && <span className="text-xs text-ink-faint">took {fmtSec(st.durationMs)}</span>}
            {!discovering && st?.cached === "all" && <Badge tone="info" title="Every grid cell of the area was already in the local copy: no source was read">from local cache</Badge>}
            {!discovering && st?.cached === "some" && <Badge tone="info" title="Part of the area came from the local copy; the rest was read from the sources">partly cached</Badge>}
            {!discovering && st?.releases && Object.keys(st.releases).length > 0 && <span className="text-[11px] text-ink-faint">{Object.entries(st.releases).map(([k, r]) => `${PROVIDER_LABEL[k] ?? k} ${r}`).join(" · ")}</span>}
          </div>
          <div className="text-xs text-ink-faint">{st?.area ? `Area: ${st.area}` : ""}</div>
        </div>
        {active && <div className="relative h-1.5 rounded-full bg-surface-3 overflow-hidden mb-3 progress-indeterminate" />}
        <ol className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Found", n: data.counts.total, hint: st ? [st.candidates != null ? `${st.candidates} source records` : "", st.skippedClosed ? `${st.skippedClosed} closed` : "", st.skippedChains ? `${st.skippedChains} chains` : "", st.skippedNoWebsite ? `${st.skippedNoWebsite} no website` : "", st.skippedNoPhone ? `${st.skippedNoPhone} no phone` : "", st.skippedKnown ? `${st.skippedKnown} known` : "", data.counts.possibleDuplicates ? `${data.counts.possibleDuplicates} possible duplicates` : ""].filter(Boolean).join(" · ") : "" },
            { label: "Saved", n: data.counts.saved, hint: `${unsaved} not saved${st ? ` · ${st.created} new · ${st.merged} merged` : ""}` },
            { label: "Reachable", n: data.counts.withWebsite, hint: `${data.counts.withWebsite} website · ${data.counts.withPhone} phone` },
            { label: "Researched", n: businessStats.investigated, hint: `${businessStats.processing} in progress · ${businessStats.investigable} waiting · ${businessStats.withOpportunity} with opportunity${businessStats.failed ? ` · ${businessStats.failed} failed` : ""}` },
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
            <summary className="cursor-pointer text-ink-muted hover:text-ink">Search details: sources, filters and the full log</summary>
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <div>
                <div className="label mb-1">Sources</div>
                <ul className="text-xs space-y-1">
                  {Object.entries(st.providerResults).map(([k, r]) => (
                    <li key={k} className="flex gap-2">
                      <span className="font-medium w-40 shrink-0">{PROVIDER_LABEL[k] ?? k}</span>
                      <span className={r.error ? (/planned integration/i.test(r.error) ? "text-ink-faint" : "text-bad") : "text-ink-muted"}>
                        {r.error ? r.error : `${r.found} record(s)${r.cached === "all" ? " · cached" : r.cached === "some" ? " · partly cached" : ""}${r.release ? ` · ${r.release}` : ""}`}
                        {r.durationMs != null && !r.error ? ` · ${fmtSec(r.durationMs)}` : ""}
                      </span>
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
                  <p className="text-xs text-ink-faint">No log for this run.</p>
                )}
              </div>
            </div>
          </details>
        )}
      </div>

      {(data.counts.total > 0 || filtered) && (
        <FilterBar basePath={base} sp={sp} params={t} placeholder="Search within results: name, category, city, domain or street" dateFields={[{ key: "discovered", label: "Found" }]}>
          <select className="select w-auto" name="source" defaultValue={sp.source ?? ""} aria-label="Source">
            <option value="">Any source</option>
            {Object.keys(data.counts.bySource).map((k) => (
              <option key={k} value={k}>
                {PROVIDER_LABEL[k] ?? k} ({data.counts.bySource[k]})
              </option>
            ))}
          </select>
          <select className="select w-auto" name="website" defaultValue={sp.website ?? ""} aria-label="Website">
            <option value="">Website: any</option>
            <option value="yes">Has website</option>
            <option value="no">No website</option>
          </select>
          <select className="select w-auto" name="phone" defaultValue={sp.phone ?? ""} aria-label="Phone">
            <option value="">Phone: any</option>
            <option value="yes">Has phone</option>
            <option value="no">No phone</option>
          </select>
          <select className="select w-auto" name="saved" defaultValue={sp.saved ?? ""} aria-label="Saved">
            <option value="">Saved: any</option>
            <option value="yes">Saved</option>
            <option value="no">Not saved</option>
          </select>
        </FilterBar>
      )}
      <Card title={`Businesses (${data.total}${filtered ? ` of ${data.counts.total}` : ""})`} description={unsaved > 0 ? "Select rows to save them to Radar; saved businesses link to their page. Lead score ranks reachable independents first." : "Every listed business is saved. Lead score ranks reachable independents first."} padded={false}>
        {data.rows.length === 0 ? (
          <EmptyState
            icon="search"
            title={discovering ? "Searching…" : filtered ? "No results match these filters" : search.status === "failed" ? "The search did not run" : "No businesses found"}
            description={discovering ? "Results appear here when the sources have answered." : filtered ? "Change or reset the filters." : search.status === "failed" ? "See the error above, then run the search again." : "Nothing in the sources matched this category in this area. Try a wider radius, fewer categories, or another source."}
            action={!discovering && !filtered && <Link href="/searches/new" className="btn">New search</Link>}
          />
        ) : (
          <>
            <CandidateTable rows={data.rows} searchId={search.id} basePath={base} sp={sp} params={t} providerLabel={PROVIDER_LABEL} firecrawlEnabled={cfg.firecrawl.enabled} />
            <Pagination basePath={base} sp={sp} params={t} total={data.total} label="businesses" />
          </>
        )}
      </Card>
    </>
  );
}
