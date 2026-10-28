/**
 * Google Maps listings through SerpApi (engine=google_maps). The only active
 * discovery source since 2026-10-28 (D25).
 *
 *  - One SerpApi "search" = one page of up to 20 listings. The free plan allows
 *    SERPAPI_MONTHLY_SEARCH_BUDGET searches per month (250); every page fetched
 *    is counted in `provider_usage` and refused once the budget is reached.
 *  - Every page is cached by its exact request for SERPAPI_CACHE_DAYS, so a
 *    repeated or re-run search costs nothing.
 *  - The map position comes from the bundled place list (city center + radius,
 *    or a population-based metro radius for a whole city): no geocoder call.
 *  - Google does not guarantee results inside the requested area; listings
 *    outside the search radius are dropped and counted.
 *  - Listings are Google's data served by SerpApi; every candidate carries the
 *    place id, the Google Maps URL and the raw listing for provenance.
 */
import { getConfig } from "@/lib/config";
import { getPlaybook, selectorsFor } from "@/lib/industries";
import { resolveSearchArea } from "./area";
import { haversineKm } from "./cells";
import { cacheGet, cachePut, recordUsage, usageThisMonth } from "./usage";
import type { BusinessCandidate, DiscoveryProvider, DiscoveryQuery, ProviderResult, ResolvedArea } from "./types";
import { ProviderError } from "./types";

export const GOOGLE_MAPS_ATTRIBUTION = "Google Maps listings via SerpApi";
export const PAGE_SIZE = 20;

export interface SerpLocalResult {
  position?: number;
  title: string;
  place_id?: string;
  data_id?: string;
  data_cid?: string;
  provider_id?: string;
  gps_coordinates?: { latitude: number; longitude: number };
  rating?: number;
  reviews?: number;
  price?: string;
  type?: string;
  types?: string[];
  type_id?: string;
  address?: string;
  open_state?: string;
  hours?: string;
  operating_hours?: Record<string, string>;
  phone?: string;
  website?: string;
  description?: string;
  thumbnail?: string;
  [k: string]: unknown;
}

export interface SerpMapsPage {
  local_results?: SerpLocalResult[];
  place_results?: SerpLocalResult;
  serpapi_pagination?: { next?: string; current_from?: number; current_to?: number };
  error?: string;
  search_metadata?: { id?: string; status?: string; google_maps_url?: string };
}

let serpFetch: typeof fetch | null = null;
/** Test hook: inject the transport. */
export function _setSerpFetch(fn: typeof fetch | null) {
  serpFetch = fn;
}

/** The Google Maps text queries for a search: one per chosen sub-type, the industry's query, or the free-text category. */
export function googleQueriesFor(q: DiscoveryQuery): string[] {
  const playbook = getPlaybook(q.industry);
  if (playbook.key === "generic") {
    const custom = (q.customCategory ?? q.categoryQuery ?? "").trim();
    return custom ? [custom] : [];
  }
  // No sub-type chosen: the industry's single query (one query per sub-type would multiply the metered searches).
  const queries = (q.segments?.length ? selectorsFor(playbook, q.segments).googleQueries : [playbook.googleTextQuery]).filter(Boolean);
  const kw = q.keywords?.trim();
  return [...new Set(queries.map((s) => (kw ? `${kw} ${s}` : s)))];
}

/** `ll` for SerpApi: map centre plus a map height in metres covering the search radius. */
export function mapPosition(area: ResolvedArea): string {
  const c = area.center ?? { lat: (area.bbox.north + area.bbox.south) / 2, lon: (area.bbox.east + area.bbox.west) / 2 };
  const km = area.radiusKm ?? Math.max(haversineKm(area.bbox.south, c.lon, area.bbox.north, c.lon), 2) / 2;
  const meters = Math.min(200_000, Math.max(1_000, Math.round(km * 2 * 1000)));
  return `@${c.lat.toFixed(5)},${c.lon.toFixed(5)},${meters}m`;
}

export function pageCacheKey(p: { q: string; ll: string; gl: string; hl: string; start: number }): string {
  return `serpapi:maps:${p.gl}:${p.hl}:${p.ll}:${p.start}:${p.q.toLowerCase()}`;
}

const POSTAL_RE = /\b([A-Z]\d[A-Z] ?\d[A-Z]\d|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}|\d{4,6}(?:-\d{4})?)\b/;

/**
 * Street, city and postal code out of Google's one-line address. Formats seen:
 * "8215 Research Blvd, Austin, TX 78758, United States", "Kantstraße 12, 10623 Berlin,
 * Germany", "12 High St, London SW1A 1AA, United Kingdom". The city is the part before
 * the region/postal part (US) or the postal part with the code removed (most of Europe);
 * the search's own city is the fallback.
 */
export function splitAddress(address: string | undefined): { street: string | null; city: string | null; postalCode: string | null } {
  if (!address) return { street: null, city: null, postalCode: null };
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { street: null, city: null, postalCode: null };
  const rest = parts.slice(1).join(" ");
  const postal = rest.match(POSTAL_RE);
  let city: string | null = null;
  if (parts.length >= 3) {
    const penult = parts[parts.length - 2];
    if (/^[A-Z]{2}(\s+[A-Z\d -]{3,10})?$/.test(penult) && parts.length >= 4) city = parts[parts.length - 3]; // "Austin, TX 78758, United States"
    else city = penult.replace(POSTAL_RE, "").trim() || null; // "10623 Berlin, Germany" / "London SW1A 1AA, United Kingdom"
  } else if (parts.length === 2) {
    city = parts[1].replace(POSTAL_RE, "").replace(/\b[A-Z]{2}\b$/, "").trim() || null;
  }
  return { street: /^\d|\d$/.test(parts[0]) || parts.length > 1 ? parts[0] : null, city, postalCode: postal ? postal[1] : null };
}

export function resultToCandidate(r: SerpLocalResult, q: { city?: string | null; region?: string | null; country: string }, query: string, fetchedAt: string): BusinessCandidate | null {
  const id = r.place_id || r.data_id || r.data_cid;
  if (!id || !r.title) return null;
  const { street, city, postalCode } = splitAddress(r.address);
  const state = `${r.open_state ?? ""} ${r.hours ?? ""}`.toLowerCase();
  const closed = /permanently closed|temporarily closed/.test(state);
  const raw: Record<string, unknown> = { place_id: r.place_id, data_id: r.data_id, data_cid: r.data_cid, address: r.address, type: r.type, types: r.types, type_id: r.type_id, rating: r.rating, reviews: r.reviews, price: r.price, open_state: r.open_state, operating_hours: r.operating_hours, website: r.website, phone: r.phone, description: r.description, query };
  return {
    provider: "google_maps",
    providerId: id,
    name: r.title.trim(),
    category: r.type ?? r.types?.[0] ?? null,
    matchedBy: `query "${query}"${r.type ? ` · ${r.type}` : ""}`,
    website: r.website?.trim() || null,
    phone: r.phone?.trim() || null,
    email: null,
    street,
    city: city ?? q.city ?? null,
    region: q.region ?? null,
    postalCode,
    country: q.country,
    lat: r.gps_coordinates?.latitude ?? null,
    lng: r.gps_coordinates?.longitude ?? null,
    sourceUrl: r.place_id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(r.place_id)}` : null,
    attribution: GOOGLE_MAPS_ATTRIBUTION,
    raw,
    operatingStatus: closed ? "closed" : "unknown",
    brand: null,
    fetchedAt,
  };
}

export interface MapsPageFetch {
  page: SerpMapsPage;
  cached: boolean;
  fetchedAt: string;
}

/** One page, from the cache when fresh; otherwise a metered SerpApi call (budget checked first). */
export async function fetchMapsPage(params: { q: string; ll: string; gl: string; hl: string; start: number }, signal?: AbortSignal): Promise<MapsPageFetch> {
  const cfg = getConfig();
  const key = pageCacheKey(params);
  const hit = await cacheGet<SerpMapsPage>(key, cfg.SERPAPI_CACHE_DAYS);
  if (hit) return { page: hit.value, cached: true, fetchedAt: hit.fetchedAt };
  if (!cfg.SERPAPI_API_KEY) throw new ProviderError("SERPAPI_API_KEY is not set", "google_maps");
  const { used, period } = await usageThisMonth("serpapi");
  if (used >= cfg.SERPAPI_MONTHLY_SEARCH_BUDGET) {
    throw new ProviderError(`SerpApi monthly budget reached (${used}/${cfg.SERPAPI_MONTHLY_SEARCH_BUDGET} searches in ${period}); raise SERPAPI_MONTHLY_SEARCH_BUDGET only if the plan allows it`, "google_maps");
  }
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("type", "search");
  url.searchParams.set("q", params.q);
  url.searchParams.set("ll", params.ll);
  url.searchParams.set("gl", params.gl);
  url.searchParams.set("hl", params.hl);
  if (params.start) url.searchParams.set("start", String(params.start));
  url.searchParams.set("api_key", cfg.SERPAPI_API_KEY);
  const res = await (serpFetch ?? fetch)(url, { headers: { Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(60_000) });
  const text = await res.text();
  let page: SerpMapsPage;
  try {
    page = JSON.parse(text) as SerpMapsPage;
  } catch {
    throw new ProviderError(`SerpApi returned a non-JSON response (HTTP ${res.status})`, "google_maps", res.status >= 500);
  }
  if (res.status === 401) throw new ProviderError("SerpApi rejected the API key (HTTP 401)", "google_maps");
  if (res.status === 429) throw new ProviderError(`SerpApi rate limit (HTTP 429): ${page.error ?? "slow down"}`, "google_maps", true);
  if (!res.ok && !page.error) throw new ProviderError(`SerpApi HTTP ${res.status}`, "google_maps", res.status >= 500);
  // SerpApi counts the search even when Google returns nothing; "no results" is an answer, not a failure.
  const noResults = page.error ? /hasn't returned any results|no results/i.test(page.error) : false;
  if (page.error && !noResults) throw new ProviderError(`SerpApi: ${page.error}`, "google_maps", /try again|temporar/i.test(page.error));
  const fetchedAt = new Date().toISOString();
  await recordUsage("serpapi", 1);
  const stored: SerpMapsPage = { local_results: page.local_results ?? (page.place_results ? [page.place_results] : []), serpapi_pagination: page.serpapi_pagination, search_metadata: { id: page.search_metadata?.id, google_maps_url: page.search_metadata?.google_maps_url } };
  await cachePut(key, "serpapi", stored);
  return { page: stored, cached: false, fetchedAt };
}

export const googleMapsProvider: DiscoveryProvider = {
  key: "google_maps",
  label: "Google Maps",
  status: "active",
  description: "Google Maps listings (name, category, address, phone, website, rating, reviews, hours, open/closed) read through SerpApi. Free plan: 250 searches of 20 listings per month; every page is cached locally.",
  attribution: GOOGLE_MAPS_ATTRIBUTION,
  isAvailable: () => (getConfig().googleMaps.enabled ? { available: true } : { available: false, reason: "Set SERPAPI_API_KEY (free SerpApi plan) to enable" }),
  async discover(q, opts): Promise<ProviderResult> {
    const cfg = getConfig();
    const notes: string[] = [];
    const queries = googleQueriesFor(q);
    if (!queries.length) throw new ProviderError(`No Google Maps query for ${getPlaybook(q.industry).label}; enter the category to look for`, "google_maps");
    const area = q.area ?? (await resolveSearchArea(q, opts?.signal, { offline: true }));
    const ll = mapPosition(area);
    const gl = q.country.toLowerCase();
    const hl = "en";
    const wholeCity = !q.radiusKm || q.areaMode !== "radius";
    const seen = new Map<string, BusinessCandidate>();
    const kw = q.keywords?.trim().toLowerCase() || null;
    let pagesFetched = 0;
    let pagesCached = 0;
    let outside = 0;
    let offName = 0;
    let budgetStop: string | null = null;
    const radiusKm = area.radiusKm;
    const center = area.center;
    outer: for (const base of queries) {
      const text = wholeCity && q.city ? `${base} in ${q.city}${q.region ? `, ${q.region}` : ""}` : base;
      for (let start = 0; start < cfg.SERPAPI_MAX_PAGES * PAGE_SIZE; start += PAGE_SIZE) {
        opts?.signal?.throwIfAborted();
        opts?.onProgress?.(`Google Maps: "${text}" page ${start / PAGE_SIZE + 1}`);
        let fetched: MapsPageFetch;
        try {
          fetched = await fetchMapsPage({ q: text, ll, gl, hl, start }, opts?.signal);
        } catch (err) {
          // Budget exhausted mid-search: keep what was collected, say so, stop.
          if (err instanceof ProviderError && /monthly budget/.test(err.message) && seen.size) {
            budgetStop = err.message;
            break outer;
          }
          throw err;
        }
        if (fetched.cached) pagesCached++;
        else pagesFetched++;
        const results = fetched.page.local_results ?? [];
        let fresh = 0;
        for (const r of results) {
          const c = resultToCandidate(r, { city: q.city, region: q.region, country: q.country }, base, fetched.fetchedAt);
          if (!c) continue;
          if (radiusKm && center && c.lat != null && c.lng != null && haversineKm(center.lat, center.lon, c.lat, c.lng) > radiusKm * 1.15) {
            outside++;
            continue;
          }
          if (kw && !c.name.toLowerCase().includes(kw)) {
            // The keyword is part of the query (Google ranks by it) and, as the form says, a filter on the name.
            offName++;
            continue;
          }
          if (!seen.has(c.providerId)) {
            seen.set(c.providerId, c);
            fresh++;
          }
        }
        if (results.length < PAGE_SIZE || !fetched.page.serpapi_pagination?.next || fresh === 0) break;
      }
    }
    const { used } = await usageThisMonth("serpapi");
    notes.push(`${seen.size} listing(s) in ${area.label} from ${queries.length} quer${queries.length === 1 ? "y" : "ies"}: ${pagesFetched} page(s) fetched, ${pagesCached} from the local cache${outside ? `, ${outside} outside the search radius dropped` : ""}${offName ? `, ${offName} without "${kw}" in the name dropped` : ""}`);
    notes.push(`SerpApi searches used this month: ${used} of ${cfg.SERPAPI_MONTHLY_SEARCH_BUDGET}`);
    if (budgetStop) notes.push(`Stopped early: ${budgetStop}`);
    const closed = [...seen.values()].filter((c) => c.operatingStatus === "closed").length;
    if (closed) notes.push(`${closed} marked closed by Google`);
    return { provider: "google_maps", candidates: [...seen.values()], attribution: GOOGLE_MAPS_ATTRIBUTION, notes, area: area.label, cached: pagesFetched === 0 && pagesCached > 0 ? "all" : pagesCached > 0 ? "some" : "none", release: null };
  },
};
