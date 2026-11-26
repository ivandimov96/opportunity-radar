/**
 * One definition of what a search needs: validated input, defaults, and the
 * parsing of a submitted form. Used by the server action, the form (for
 * defaults and labels) and the tests.
 */
import { z } from "zod";
import { distanceText } from "@/lib/distance";
import type { SearchFilters } from "@/db/schema";
import { getPlaybook } from "@/lib/industries";
import { listCountries, listRegions } from "@/lib/geo/world";
import { PROVIDERS } from "@/lib/discovery";
import { resolveCategories } from "@/lib/discovery/taxonomy";

export const DEFAULT_FILTERS: SearchFilters = {
  segments: [],
  areaMode: "area",
  radiusKm: 15,
  requirePhone: false,
  excludeChains: true,
  skipKnown: false,
  minLeadScore: 50,
  autoInvestigateLimit: 25,
  customCategory: null,
  autoSave: true,
  minReviews: 0,
  minRating: 0,
};

export const SearchInput = z
  .object({
    name: z.string().trim().max(120).optional(),
    industry: z.string().min(1, "Choose a business type"),
    segments: z.array(z.string()).default([]),
    keywords: z.string().trim().max(200).optional(),
    categoryQuery: z.string().trim().max(200).optional(),
    customCategory: z.string().trim().max(80).optional(),
    country: z.string().trim().length(2, "Use a 2-letter country code").transform((v) => v.toUpperCase()).default("US"),
    region: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    areaMode: z.enum(["area", "radius"]).default("area"),
    centerLat: z.coerce.number().min(-90).max(90).nullable().default(null),
    centerLon: z.coerce.number().min(-180).max(180).nullable().default(null),
    radiusKm: z.coerce.number().min(1, "Radius must be at least 1 km").max(100, "Radius must be at most 100 km (62 miles)").default(DEFAULT_FILTERS.radiusKm),
    maxResults: z.coerce.number().int("Whole number").min(1, "At least 1").max(500, "At most 500").default(25),
    requireWebsite: z.boolean().default(false),
    requirePhone: z.boolean().default(DEFAULT_FILTERS.requirePhone),
    excludeChains: z.boolean().default(DEFAULT_FILTERS.excludeChains),
    skipKnown: z.boolean().default(DEFAULT_FILTERS.skipKnown),
    autoInvestigate: z.boolean().default(true),
    minLeadScore: z.coerce.number().int().min(0).max(100).default(DEFAULT_FILTERS.minLeadScore),
    autoInvestigateLimit: z.coerce.number().int().min(1).max(500).nullable().default(DEFAULT_FILTERS.autoInvestigateLimit),
    autoSave: z.boolean().default(true),
    minReviews: z.coerce.number().int("Whole number").min(0, "0 or more").max(100000).default(0),
    minRating: z.coerce.number().min(0, "Between 0 and 5").max(5, "Between 0 and 5").default(0),
    providers: z.array(z.enum(["google_maps", "foursquare", "web_search", "linkedin"])).min(1, "Pick at least one source"),
  })
  .superRefine((v, ctx) => {
    const playbook = getPlaybook(v.industry);
    const future = v.providers.filter((k) => PROVIDERS[k as keyof typeof PROVIDERS]?.status === "future");
    if (future.length) ctx.addIssue({ code: "custom", path: ["providers"], message: `${future.map((k) => PROVIDERS[k as keyof typeof PROVIDERS].label).join(", ")}: planned integration, not available yet` });
    if (!listCountries().some((c) => c.code === v.country)) ctx.addIssue({ code: "custom", path: ["country"], message: "Choose a country from the list" });
    if (!v.city) ctx.addIssue({ code: "custom", path: ["city"], message: "Enter a city: sources are read city by city (a whole state or country is too large for one search)" });
    if (v.country === "US" && !v.region) ctx.addIssue({ code: "custom", path: ["region"], message: "Choose a state" });
    if (v.region && listRegions(v.country).length && !listRegions(v.country).some((r) => r.code.toUpperCase() === v.region!.toUpperCase())) ctx.addIssue({ code: "custom", path: ["region"], message: "Choose a region from the list" });
    const cats = resolveCategories(v.industry, v.segments, v.customCategory);
    if (playbook.key === "generic" && !cats.custom) ctx.addIssue({ code: "custom", path: ["customCategory"], message: "Enter the business category to look for (e.g. roofing, bakery, veterinarian)" });
    const unknown = v.segments.filter((k) => !playbook.segments.some((s) => s.key === k));
    if (unknown.length) ctx.addIssue({ code: "custom", path: ["segments"], message: `Unknown segment: ${unknown.join(", ")}` });
  });

export type SearchInputValues = z.infer<typeof SearchInput>;
export type SearchFieldErrors = Partial<Record<keyof SearchInputValues | "form", string>>;

const str = (fd: FormData, k: string) => (fd.get(k)?.toString() ?? "").trim();
/** Checkbox pattern: a hidden "off" plus an optional "on"; any "on"/"true" wins. */
const bool = (fd: FormData, k: string, dflt: boolean) => (fd.has(k) ? fd.getAll(k).some((v) => v === "on" || v === "true") : dflt);

/** Raw values as submitted (kept to re-render the form on error). */
export function rawSearchValues(fd: FormData) {
  return {
    name: str(fd, "name"),
    industry: str(fd, "industry") || "auto_repair",
    segments: fd.getAll("segments").map(String),
    keywords: str(fd, "keywords"),
    categoryQuery: str(fd, "categoryQuery"),
    customCategory: str(fd, "customCategory"),
    country: (str(fd, "country") || "US").toUpperCase(),
    region: str(fd, "region"),
    city: str(fd, "city"),
    areaMode: (str(fd, "areaMode") || "area") as "area" | "radius",
    centerLat: str(fd, "centerLat"),
    centerLon: str(fd, "centerLon"),
    radiusKm: str(fd, "radiusKm") || String(DEFAULT_FILTERS.radiusKm),
    maxResults: str(fd, "maxResults") || "25",
    requireWebsite: bool(fd, "requireWebsite", false),
    requirePhone: bool(fd, "requirePhone", DEFAULT_FILTERS.requirePhone),
    excludeChains: bool(fd, "excludeChains", DEFAULT_FILTERS.excludeChains),
    skipKnown: bool(fd, "skipKnown", DEFAULT_FILTERS.skipKnown),
    autoInvestigate: bool(fd, "autoInvestigate", true),
    autoSave: bool(fd, "autoSave", true),
    minLeadScore: str(fd, "minLeadScore") || String(DEFAULT_FILTERS.minLeadScore),
    autoInvestigateLimit: str(fd, "autoInvestigateLimit"),
    minReviews: str(fd, "minReviews") || "0",
    minRating: str(fd, "minRating") || "0",
    providers: fd.getAll("providers").map(String),
  };
}
export type RawSearchValues = ReturnType<typeof rawSearchValues>;

export function parseSearchForm(fd: FormData): { ok: true; values: SearchInputValues; filters: SearchFilters; name: string } | { ok: false; errors: SearchFieldErrors; raw: RawSearchValues } {
  const raw = rawSearchValues(fd);
  const parsed = SearchInput.safeParse({
    ...raw,
    name: raw.name || undefined,
    keywords: raw.keywords || undefined,
    categoryQuery: raw.categoryQuery || undefined,
    customCategory: raw.customCategory || undefined,
    region: raw.region ? raw.region.toUpperCase() : undefined,
    city: raw.city || undefined,
    centerLat: raw.centerLat === "" ? null : raw.centerLat,
    centerLon: raw.centerLon === "" ? null : raw.centerLon,
    autoInvestigateLimit: raw.autoInvestigateLimit === "" ? null : raw.autoInvestigateLimit,
  });
  if (!parsed.success) {
    const errors: SearchFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = (issue.path[0] as keyof SearchInputValues | undefined) ?? "form";
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors, raw };
  }
  const v = parsed.data;
  const playbook = getPlaybook(v.industry);
  const where = v.areaMode === "radius" && v.city ? `${distanceText(v.radiusKm, v.country)} around ${v.city}` : [v.city, v.region].filter(Boolean).join(", ") || v.country;
  const segs = v.segments.length && v.segments.length < playbook.segments.length ? ` (${v.segments.map((k) => playbook.segments.find((s) => s.key === k)?.label ?? k).join(", ")})` : "";
  const name = v.name || `${playbook.key === "generic" && v.customCategory ? v.customCategory : playbook.label}${segs} · ${where}`;
  const filters: SearchFilters = { segments: v.segments, areaMode: v.areaMode, radiusKm: v.radiusKm, requirePhone: v.requirePhone, excludeChains: v.excludeChains, skipKnown: v.skipKnown, minLeadScore: v.minLeadScore, autoInvestigateLimit: v.autoInvestigateLimit, centerLat: v.centerLat, centerLon: v.centerLon, customCategory: v.customCategory ?? null, autoSave: v.autoSave, minReviews: v.minReviews, minRating: v.minRating };
  return { ok: true, values: v, filters, name };
}

export function filtersOf(search: { filters?: SearchFilters | null }): SearchFilters {
  return { ...DEFAULT_FILTERS, ...(search.filters ?? {}) };
}

/** Human-readable filter summary for lists and detail pages. */
export function describeFilters(search: { filters?: SearchFilters | null; requireWebsite: boolean; autoInvestigate: boolean; keywords?: string | null; industry: string; country?: string | null }): string[] {
  const f = filtersOf(search);
  const playbook = getPlaybook(search.industry);
  const out: string[] = [];
  if (f.segments.length && f.segments.length < playbook.segments.length) out.push(f.segments.map((k) => playbook.segments.find((s) => s.key === k)?.label ?? k).join(" · "));
  if (f.areaMode === "radius") out.push(`${distanceText(f.radiusKm, search.country)} radius`);
  if (search.keywords) out.push(`name contains "${search.keywords}"`);
  if (search.requireWebsite) out.push("website required");
  if (f.requirePhone) out.push("phone required");
  if (f.excludeChains) out.push("chains excluded");
  if (f.skipKnown) out.push("known businesses skipped");
  if (f.customCategory) out.push(`category "${f.customCategory}"`);
  if (f.minReviews) out.push(`at least ${f.minReviews} reviews`);
  if (f.minRating) out.push(`rated ${f.minRating} or more`);
  if (f.autoSave === false) out.push("results reviewed before saving");
  out.push(search.autoInvestigate ? `auto-investigate${f.autoInvestigateLimit ? ` top ${f.autoInvestigateLimit}` : ""} (lead ≥ ${f.minLeadScore})` : "manual investigation");
  return out;
}

/** The extra cities of a search form ("Also search"): at most nine, each with a name and coordinates. */
export const MAX_MORE_CITIES = 9;
export function moreCitiesOf(fd: FormData): { name: string; region: string | null; lat: number; lon: number }[] {
  try {
    const raw: unknown = JSON.parse(str(fd, "moreCities") || "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw
      .map((c) => ({ name: String(c?.name ?? "").trim().slice(0, 80), region: c?.region ? String(c.region).slice(0, 12) : null, lat: Number(c?.lat), lon: Number(c?.lon) }))
      .filter((c) => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180 && !seen.has(c.name.toLowerCase()) && Boolean(seen.add(c.name.toLowerCase())))
      .slice(0, MAX_MORE_CITIES);
  } catch {
    return [];
  }
}

/** The same form once more for each extra city: validated and named like the main search, with that city's own centre. */
export function extraCityRuns(fd: FormData, mainCity: string) {
  const runs: Extract<ReturnType<typeof parseSearchForm>, { ok: true }>[] = [];
  for (const c of moreCitiesOf(fd)) {
    if (c.name.toLowerCase() === mainCity.trim().toLowerCase()) continue;
    const copy = new FormData();
    for (const [k, val] of fd.entries()) if (!["city", "region", "centerLat", "centerLon", "name", "moreCities"].includes(k)) copy.append(k, val);
    copy.set("city", c.name);
    copy.set("region", c.region ?? str(fd, "region"));
    copy.set("centerLat", String(c.lat));
    copy.set("centerLon", String(c.lon));
    const extra = parseSearchForm(copy);
    if (extra.ok) runs.push(extra);
  }
  return runs;
}
