import Link from "next/link";
import { notFound } from "next/navigation";
import { CANDIDATE_SORTS, getSearchCandidates, getSearchOverview, type CandidateSort } from "@/lib/queries";
import { Badge, Callout, Card, EmptyState, Icon, PageHeader, StatusPill, fmtRelative, fmtDuration } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmButton } from "@/components/confirm-button";
import { getPlaybook } from "@/lib/industries";
import { PROVIDER_LABEL } from "@/lib/discovery";
import { describeFilters } from "@/lib/search-input";
import { countryName, regionName } from "@/lib/geo/world";
import { getConfig } from "@/lib/config";
import { investigateManyAction, rerunSearch, saveCandidatesAction } from "@/app/actions";
import { FilterBar, Pagination } from "@/components/table";
import { dateBounds, parseTableParams } from "@/lib/table";
import { CandidateTable } from "./candidate-table";

const fmtSec = fmtDuration;

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
  const leftOut = st ? [st.skippedClosed ? `${st.skippedClosed} closed` : "", st.skippedChains ? `${st.skippedChains} chains` : "", st.skippedReviews ? `${st.skippedReviews} below the review limits` : "", st.skippedNoWebsite ? `${st.skippedNoWebsite} without a website` : "", st.skippedNoPhone ? `${st.skippedNoPhone} without a phone` : "", st.skippedKnown ? `${st.skippedKnown} you already had` : "", st.skippedRemoved ? `${st.skippedRemoved} you removed earlier` : ""].filter(Boolean) : [];
  const leftOutCount = st ? (st.skippedClosed ?? 0) + (st.skippedChains ?? 0) + (st.skippedReviews ?? 0) + (st.skippedNoWebsite ?? 0) + (st.skippedNoPhone ?? 0) + (st.skippedKnown ?? 0) + (st.skippedRemoved ?? 0) : 0;
  // Businesses that reached this search without a results list (an import, sample data): count them from the saved ones.
  const found = Math.max(data.counts.total, businessStats.saved);
  const savedCount = Math.max(data.counts.saved, businessStats.saved);
  const manySources = Object.keys(data.counts.bySource).length > 1;
  const base = `/searches/${search.id}`;
  const playbook = getPlaybook(search.industry);
  const where = [search.city, search.region ? regionName(search.country, search.region) : null, countryName(search.country)].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/searches", label: "Searches" }, { label: search.name }]}
        title={search.name}
        subtitle={`${search.filters?.customCategory || playbook.label} · ${where} · ${fmtRelative(search.createdAt)}`}
        actions={
          <>
            <AutoRefresh active={active} label={discovering ? "Searching" : `Researching ${businessStats.processing}`} />
            {businessStats.saved > 0 && (
              <a href={`/api/export?searchId=${search.id}`} className="btn btn-ghost" title="The saved businesses of this search as a CSV file">
                <Icon name="download" /> Export
              </a>
            )}
            <Link href={`/searches/new?industry=${encodeURIComponent(search.industry)}&country=${encodeURIComponent(search.country)}&city=${encodeURIComponent(search.city ?? "")}&region=${encodeURIComponent(search.region ?? "")}`} className="btn btn-ghost" title="A new search with this kind of business and place filled in">
              <Icon name="plus" /> Similar search
            </Link>
            <form action={rerunSearch}>
              <input type="hidden" name="searchId" value={search.id} />
              <ConfirmButton className="btn" disabled={active} confirmLabel="Run again" message="Run this search again? It asks the sources again, which can use search credits. Businesses you already have are not duplicated.">
                <Icon name="refresh" /> Run again
              </ConfirmButton>
            </form>
            {unsaved > 0 && !discovering && (
              <form action={saveCandidatesAction}>
                <input type="hidden" name="searchId" value={search.id} />
                <input type="hidden" name="all" value="on" />
                <button className="btn btn-primary">
                  <Icon name="plus" /> Save all <span className="btn-count">{unsaved}</span>
                </button>
              </form>
            )}
            {businessStats.investigable > 0 && (
              <form action={investigateManyAction}>
                <input type="hidden" name="searchId" value={search.id} />
                {/* One primary action at a time: saving comes first, research after it. */}
                <ConfirmButton
                  className={`btn ${unsaved > 0 && !discovering ? "" : "btn-primary"}`}
                  disabled={active || !cfg.firecrawl.enabled}
                  title={cfg.firecrawl.enabled ? undefined : "Research is not set up yet (Settings)"}
                  confirmLabel="Start research"
                  message={`Research ${businessStats.investigable} saved business${businessStats.investigable === 1 ? "" : "es"}? Each one has its website read and analyzed, which uses website and AI credits.`}
                >
                  <Icon name="sparkles" /> Research <span className="btn-count">{businessStats.investigable}</span>
                </ConfirmButton>
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

      <div className="surface p-4 mb-5">
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <StatusPill status={search.status} label={discovering ? (search.status === "queued" ? "Queued" : "Searching") : search.status === "done" ? (failedSources.length ? "Partly done" : found ? "Done" : "Nothing found") : "Failed"} />
          {discovering && job?.progress?.message && <span className="text-xs text-ink-muted">{job.progress.message}</span>}
          {!discovering && st?.durationMs != null && <span className="text-xs text-ink-faint">took {fmtSec(st.durationMs)}</span>}
        </div>
        {active && <div className="relative h-1.5 rounded-full bg-surface-3 overflow-hidden mb-4 progress-indeterminate" />}
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
          {[
            { label: "Found", n: found, hint: leftOut.length ? `${leftOutCount} left out` : "", title: leftOut.join(" · ") },
            { label: "Saved", n: savedCount, hint: unsaved > 0 ? `${unsaved} not saved yet` : found ? "all of them" : "" },
            { label: "With a website", n: data.counts.withWebsite, hint: `${data.counts.withPhone} with a phone` },
            { label: "Researched", n: businessStats.investigated, hint: [businessStats.processing ? `${businessStats.processing} in progress` : "", businessStats.investigable ? `${businessStats.investigable} waiting` : "", businessStats.withOpportunity ? `${businessStats.withOpportunity} with an idea` : "", businessStats.failed ? `${businessStats.failed} failed` : ""].filter(Boolean).join(" · ") },
          ].map((s) => (
            <div key={s.label} title={s.title || undefined}>
              <dt className="text-xs text-ink-muted">{s.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums leading-tight mt-0.5">{s.n}</dd>
              {s.hint && <dd className="text-xs text-ink-faint mt-0.5">{s.hint}</dd>}
            </div>
          ))}
        </dl>
        {st && (
          <details className="mt-4 text-sm">
            <summary className="disclosure text-ink-muted">How this search ran</summary>
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
        <FilterBar basePath={base} sp={sp} params={t} placeholder="Search these results" dateFields={[{ key: "discovered", label: "Found" }]}>
          {manySources && (
            <select className="select w-auto" name="source" defaultValue={sp.source ?? ""} aria-label="Source">
              <option value="">Any source</option>
              {Object.keys(data.counts.bySource).map((k) => (
                <option key={k} value={k}>
                  {PROVIDER_LABEL[k] ?? k} ({data.counts.bySource[k]})
                </option>
              ))}
            </select>
          )}
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
      <Card title={`Businesses (${filtered || data.counts.total ? data.total : found}${filtered ? ` of ${data.counts.total}` : ""})`} padded={false}>
        {data.rows.length === 0 ? (
          <EmptyState
            icon="search"
            title={discovering ? "Searching…" : !filtered && businessStats.saved > 0 ? "These businesses are in your list" : filtered ? "No results match these filters" : search.status === "failed" ? "The search did not run" : "No businesses found"}
            description={discovering ? "Results appear here when the sources have answered." : !filtered && businessStats.saved > 0 ? `All ${businessStats.saved} are saved. Open them in Businesses to work on them.` : filtered ? "Change or reset the filters." : search.status === "failed" ? "See the error above, then run the search again." : "Nothing in the sources matched this category in this area. Try a wider radius, fewer categories, or another source."}
            action={!discovering && !filtered && (businessStats.saved > 0 ? <Link href={`/businesses?search=${search.id}`} className="btn btn-primary">Open in Businesses</Link> : <Link href="/searches/new" className="btn">New search</Link>)}
          />
        ) : (
          <>
            <CandidateTable rows={data.rows} searchId={search.id} basePath={base} sp={sp} params={t} providerLabel={PROVIDER_LABEL} showSources={manySources} firecrawlEnabled={cfg.firecrawl.enabled} />
            <Pagination basePath={base} sp={sp} params={t} total={data.total} label="businesses" />
          </>
        )}
      </Card>
    </>
  );
}
