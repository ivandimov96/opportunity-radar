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
import { SearchForm, type PlaybookOption, type SourceState } from "./search-form";

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
  const country = (sp.country ?? last?.country ?? "US").toUpperCase();
  const defaults = {
    name: "",
    industry: sp.industry && playbooks.some((p) => p.key === sp.industry) ? sp.industry : (lastIndustry ?? "generic"),
    segments: [] as string[],
    keywords: "",
    categoryQuery: "",
    customCategory: !sp.industry && lastIndustry === "generic" ? String((last?.filters as { customCategory?: string } | null)?.customCategory ?? "") : "",
    country,
    region: sp.region ?? (last && !sp.country && last.country === country ? (last.region ?? "") : country === "US" ? "TX" : ""),
    city: sp.city ?? (country === "US" ? "Austin" : ""),
    areaMode: DEFAULT_FILTERS.areaMode,
    centerLat: "",
    centerLon: "",
    radiusKm: String(DEFAULT_FILTERS.radiusKm),
    maxResults: String(last?.maxResults ?? 50),
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
  return (
    <>
      <PageHeader crumbs={[{ href: "/searches", label: "Discover" }, { label: "New search" }]} title="Find businesses" />
      <SearchForm playbooks={playbooks} source={source} countries={listCountries()} initialRegions={listRegions(country)} cost={cost} aiEnabled={cfg.ai.enabled} firecrawlEnabled={cfg.firecrawl.enabled} defaults={defaults} />
    </>
  );
}
