import { listProviders } from "@/lib/discovery";
import { listPlaybooks } from "@/lib/industries";
import { getConfig } from "@/lib/config";
import { PageHeader } from "@/components/ui";
import { DEFAULT_FILTERS } from "@/lib/search-input";
import { SearchForm, type PlaybookOption, type ProviderOption } from "./search-form";

export default async function NewSearchPage({ searchParams }: { searchParams: Promise<{ industry?: string; city?: string; region?: string }> }) {
  const sp = await searchParams;
  const cfg = getConfig();
  const providers: ProviderOption[] = listProviders().map((p) => ({ key: p.key, label: p.label, available: p.available, reason: p.reason }));
  const playbooks: PlaybookOption[] = listPlaybooks().map((p) => ({ key: p.key, label: p.label, description: p.description, osmSupported: p.osmSelectors.length > 0, segments: p.segments.map((s) => ({ key: s.key, label: s.label, description: s.description })) }));
  const defaults = {
    name: "",
    industry: sp.industry && playbooks.some((p) => p.key === sp.industry) ? sp.industry : "auto_repair",
    segments: [] as string[],
    keywords: "",
    categoryQuery: "",
    country: "US",
    region: sp.region ?? "TX",
    city: sp.city ?? "Austin",
    areaMode: DEFAULT_FILTERS.areaMode,
    centerLat: "",
    centerLon: "",
    radiusKm: String(DEFAULT_FILTERS.radiusKm),
    maxResults: "25",
    requireWebsite: false,
    requirePhone: DEFAULT_FILTERS.requirePhone,
    excludeChains: DEFAULT_FILTERS.excludeChains,
    skipKnown: DEFAULT_FILTERS.skipKnown,
    autoInvestigate: true,
    minLeadScore: String(DEFAULT_FILTERS.minLeadScore),
    autoInvestigateLimit: String(DEFAULT_FILTERS.autoInvestigateLimit ?? ""),
    providers: ["overture", "osm", "tx_permits"],
  };
  return (
    <>
      <PageHeader crumbs={[{ href: "/searches", label: "Discover" }, { label: "New search" }]} title="Start a search" subtitle="Choose the kind of business, where to look, which sources and filters to apply, and what to investigate automatically." />
      <SearchForm playbooks={playbooks} providers={providers} aiEnabled={cfg.ai.enabled} webSearchEnabled={Boolean(cfg.webSearch.provider)} defaults={defaults} />
    </>
  );
}
