import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { searches } from "@/db/schema";
import { listProviders } from "@/lib/discovery";
import { INDUSTRY_SYNONYMS } from "@/lib/discovery/taxonomy";
import { listPlaybooks } from "@/lib/industries";
import { listCountries, listRegions } from "@/lib/geo/world";
import { getConfig } from "@/lib/config";
import { PageHeader } from "@/components/ui";
import { DEFAULT_FILTERS } from "@/lib/search-input";
import { SearchForm, type PlaybookOption, type ProviderOption } from "./search-form";

export default async function NewSearchPage({ searchParams }: { searchParams: Promise<{ industry?: string; city?: string; region?: string; country?: string }> }) {
  const sp = await searchParams;
  const cfg = getConfig();
  const providers: ProviderOption[] = listProviders().map((p) => ({ key: p.key, label: p.label, status: p.status, description: p.description, futurePurpose: p.futurePurpose, available: p.available, reason: p.reason }));
  const playbooks: PlaybookOption[] = listPlaybooks().map((p) => ({ key: p.key, label: p.label, description: p.description, osmSupported: p.osmSelectors.length > 0, segments: p.segments.map((s) => ({ key: s.key, label: s.label, description: s.description })) }));
  // Start from the last search: people search the same kind of business in the next city far more often than something new.
  const db = await getDb();
  const last = (await db.select().from(searches).orderBy(desc(searches.createdAt)).limit(1).get()) ?? null;
  const lastIndustry = last && playbooks.some((p) => p.key === last.industry) ? last.industry : null;
  const country = (sp.country ?? last?.country ?? "US").toUpperCase();
  const defaults = {
    name: "",
    industry: sp.industry && playbooks.some((p) => p.key === sp.industry) ? sp.industry : (lastIndustry ?? "auto_repair"),
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
    providers: ["google_maps"],
  };
  return (
    <>
      <PageHeader crumbs={[{ href: "/searches", label: "Discover" }, { label: "New search" }]} title="Find businesses" subtitle="Choose the kind of business, where to look and which sources to read. Results are merged across sources, deduplicated, and saved for research." />
      <SearchForm playbooks={playbooks} providers={providers} countries={listCountries()} initialRegions={listRegions(country)} synonyms={INDUSTRY_SYNONYMS} aiEnabled={cfg.ai.enabled} firecrawlEnabled={cfg.firecrawl.enabled} defaults={defaults} />
    </>
  );
}
