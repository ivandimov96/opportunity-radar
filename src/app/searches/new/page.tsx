import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { searches } from "@/db/schema";
import { listProviders } from "@/lib/discovery";
import { listPlaybooks } from "@/lib/industries";
import { listCountries, listRegions } from "@/lib/geo/world";
import { getConfig } from "@/lib/config";
import { PageHeader } from "@/components/ui";
import { DEFAULT_FILTERS } from "@/lib/search-input";
import { workspaceId } from "@/lib/workspace";
import { searchCostBasis } from "@/lib/search-cost-basis";
import { getSettings } from "@/lib/settings";
import { SearchForm, type PastSearch, type PlaybookOption, type SourceState } from "./search-form";

export default async function NewSearchPage({ searchParams }: { searchParams: Promise<{ industry?: string; city?: string; region?: string; country?: string }> }) {
  const sp = await searchParams;
  const cfg = getConfig();
  const active = listProviders().filter((p) => p.status === "active");
  const source: SourceState = { usable: active.filter((p) => p.available).map((p) => p.key), problem: active.find((p) => !p.available)?.reason ?? null };
  const playbooks: PlaybookOption[] = listPlaybooks().map((p) => ({ key: p.key, label: p.label, description: p.description, segments: p.segments.map((s) => ({ key: s.key, label: s.label, description: s.description })) }));
  // Start from the last search: people search the same kind of business in the next city far more often than something new.
  const db = await getDb();
  const last = (await db.select().from(searches).where(eq(searches.workspaceId, await workspaceId())).orderBy(desc(searches.createdAt)).limit(1).get()) ?? null;
  const lastIndustry = last && playbooks.some((p) => p.key === last.industry) ? last.industry : null;
  const allowedFirst = (await getSettings()).allowedCountries[0];
  // The last search's country; before any search, the first country the operator may email.
  const country = (sp.country ?? last?.country ?? allowedFirst ?? "US").toUpperCase();
  const defaults = {
    name: "",
    industry: sp.industry && playbooks.some((p) => p.key === sp.industry) ? sp.industry : (lastIndustry ?? "generic"),
    segments: [] as string[],
    keywords: "",
    categoryQuery: "",
    customCategory: !sp.industry && lastIndustry === "generic" ? String((last?.filters as { customCategory?: string } | null)?.customCategory ?? "") : "",
    country,
    // The region of the last search narrows the city list to where the operator is working; the city is always chosen anew.
    region: sp.region ?? (last && !sp.country && last.country === country ? (last.region ?? "") : ""),
    city: sp.city ?? "",
    areaMode: DEFAULT_FILTERS.areaMode,
    centerLat: "",
    centerLon: "",
    radiusKm: String(DEFAULT_FILTERS.radiusKm),
    maxResults: String(last?.maxResults ?? 20),
    minReviews: "0",
    minRating: "0",
    requireWebsite: false,
    requirePhone: DEFAULT_FILTERS.requirePhone,
    excludeChains: DEFAULT_FILTERS.excludeChains,
    skipKnown: DEFAULT_FILTERS.skipKnown,
    autoInvestigate: true,
    autoSave: true,
    minLeadScore: String(DEFAULT_FILTERS.minLeadScore),
    autoInvestigateLimit: String(DEFAULT_FILTERS.autoInvestigateLimit ?? ""),
    providers: source.usable,
  };
  const cost = await searchCostBasis();
  // Where was already searched, and for what: the form marks those cities and says so before a repeat.
  const pastRows = await db.select({ industry: searches.industry, filters: searches.filters, country: searches.country, city: searches.city, at: searches.createdAt, stats: searches.stats }).from(searches).where(eq(searches.workspaceId, await workspaceId())).orderBy(desc(searches.createdAt)).limit(300).all();
  const past: PastSearch[] = pastRows.map((r) => ({ industry: r.industry, custom: r.filters?.customCategory ?? null, country: r.country, city: r.city, at: r.at, created: r.stats?.created ?? null }));
  const { allowedCountries } = await getSettings();
  return (
    <>
      <PageHeader crumbs={[{ href: "/searches", label: "Discover" }, { label: "New search" }]} title="Find businesses" />
      <SearchForm playbooks={playbooks} source={source} countries={listCountries()} initialRegions={listRegions(country)} cost={cost} aiEnabled={cfg.ai.enabled} firecrawlEnabled={cfg.firecrawl.enabled} defaults={defaults} allowedCountries={allowedCountries} past={past} />
    </>
  );
}
