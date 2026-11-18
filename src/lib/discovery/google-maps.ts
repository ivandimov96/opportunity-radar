/**
 * Google Maps listings through Serper (google.serper.dev/maps). The only
 * active discovery source (D25, transport switched to Serper in D27).
 *
 *  - One Serper call = one page of 20 listings = 3 credits (measured live on
 *    2026-10-29; the response says how many). Sign-up gives 2,500 free credits
 *    that do not renew; every credit spent is counted in `provider_usage` and
 *    fetching is refused once SERPER_CREDIT_BUDGET is reached.
 *  - Every page is cached by its exact request for SERPER_CACHE_DAYS, so a
 *    repeated or re-run search costs nothing.
 *  - The map position comes from the bundled place list (city center + a zoom
 *    level covering the radius, or a population-based metro radius for a whole
 *    city): no geocoder call.
 *  - Google does not guarantee results inside the requested area; listings
 *    outside the search radius are dropped and counted.
 *  - Listings are Google's data served by Serper; every candidate carries the
 *    place id, the Google Maps URL and the raw listing for provenance.
 */
import { getConfig } from "@/lib/config";
import { getPlaybook, selectorsFor } from "@/lib/industries";
import { resolveSearchArea } from "./area";
import { haversineKm } from "./cells";
import { cacheGet, cachePut, recordUsage, usageTotal } from "./usage";
import type { BusinessCandidate, DiscoveryProvider, DiscoveryQuery, ProviderResult, ResolvedArea } from "./types";
import { ProviderError } from "./types";

export const GOOGLE_MAPS_ATTRIBUTION = "Google Maps listings via Serper";
/** Serper returns up to this many listings per page. */
export const PAGE_SIZE = 20;
export const SERPER_MAPS_URL = "https://google.serper.dev/maps";

/** One listing as Serper's /maps endpoint returns it. */
export interface SerperPlace {
  position?: number;
  title: string;
  placeId?: string;
  cid?: string;
  fid?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  ratingCount?: number;
  priceLevel?: string;
  type?: string;
  types?: string[];
  category?: string;
  website?: string;
  phoneNumber?: string;
  description?: string;
  openingHours?: Record<string, string>;
  /** Google's "Book online" links (e.g. a Shopgenie or Shopmonkey booking page): a hint of the shop's booking tool. */
  bookingLinks?: string[];
  thumbnailUrl?: string;
  [k: string]: unknown;
}

export interface SerperMapsPage {
  ll?: string;
  places?: SerperPlace[];
  credits?: number;
  message?: string;
}

let serperFetch: typeof fetch | null = null;
/** Test hook: inject the transport. */
export function _setSerperFetch(fn: typeof fetch | null) {
  serperFetch = fn;
}

/** The Google Maps text queries for a search: one per chosen sub-type, the industry's query, or the free-text category. */
export function googleQueriesFor(q: DiscoveryQuery): string[] {
  const playbook = getPlaybook(q.industry);
  if (playbook.key === "generic") {
    const custom = (q.customCategory ?? q.categoryQuery ?? "").trim();
    return custom ? [custom] : [];
  }
  // No sub-type chosen: the industry's single query (one query per sub-type would multiply the metered calls).
  const queries = (q.segments?.length ? selectorsFor(playbook, q.segments).googleQueries : [playbook.googleTextQuery]).filter(Boolean);
  const kw = q.keywords?.trim();
  return [...new Set(queries.map((s) => (kw ? `${kw} ${s}` : s)))];
}

/** Google Maps zoom level whose viewport roughly covers a circle of `radiusKm` (zoom 14 ≈ 2.5 km across at mid latitudes). */
export function zoomFor(radiusKm: number): number {
  return Math.min(16, Math.max(8, Math.round(14 - Math.log2(Math.max(0.5, radiusKm) / 2.5))));
}

/** `ll` for Serper: map centre plus a zoom level covering the search radius, e.g. `@30.26720,-97.74310,13z`. */
export function mapPosition(area: ResolvedArea): string {
  const c = area.center ?? { lat: (area.bbox.north + area.bbox.south) / 2, lon: (area.bbox.east + area.bbox.west) / 2 };
  const km = area.radiusKm ?? Math.max(haversineKm(area.bbox.south, c.lon, area.bbox.north, c.lon), 2) / 2;
  return `@${c.lat.toFixed(5)},${c.lon.toFixed(5)},${zoomFor(km)}z`;
}

export function pageCacheKey(p: { q: string; ll: string; gl: string; hl: string; page: number }): string {
  return `serper:maps:${p.gl}:${p.hl}:${p.ll}:${p.page}:${p.q.toLowerCase()}`;
}

const POSTAL_RE = /\b([A-Z]\d[A-Z] ?\d[A-Z]\d|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}|\d{4,6}(?:-\d{4})?)\b/;

/**
 * Street, city and postal code out of Google's one-line address. Formats seen:
 * "8215 Research Blvd, Austin, TX 78758, United States", "8215 Research Blvd, Austin, TX 78758",
 * "Kantstraße 12, 10623 Berlin, Germany", "12 High St, London SW1A 1AA, United Kingdom". The
 * city is the part before the region/postal part (US) or the postal part with the code removed
 * (most of Europe); the search's own city is the fallback.
 */
export function splitAddress(address: string | undefined): { street: string | null; city: string | null; postalCode: string | null } {
  if (!address) return { street: null, city: null, postalCode: null };
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { street: null, city: null, postalCode: null };
  const rest = parts.slice(1).join(" ");
  const postal = rest.match(POSTAL_RE);
  let city: string | null = null;
  const last = parts[parts.length - 1];
  const regionLike = (s: string) => /^[A-Z]{2}(\s+[A-Z\d -]{3,10})?$/.test(s);
  if (parts.length >= 3) {
    const penult = parts[parts.length - 2];
    if (regionLike(penult) && parts.length >= 4) city = parts[parts.length - 3]; // "…, Austin, TX 78758, United States"
    else if (regionLike(last)) city = penult; // "…, Austin, TX 78758" (no country)
    else city = penult.replace(POSTAL_RE, "").trim() || null; // "10623 Berlin, Germany" / "London SW1A 1AA, United Kingdom"
  } else if (parts.length === 2) {
    city = parts[1].replace(POSTAL_RE, "").replace(/\b[A-Z]{2}\b$/, "").trim() || null;
  }
  return { street: /^\d|\d$/.test(parts[0]) || parts.length > 1 ? parts[0] : null, city, postalCode: postal ? postal[1] : null };
}

export function resultToCandidate(r: SerperPlace, q: { city?: string | null; region?: string | null; country: string }, query: string, fetchedAt: string): BusinessCandidate | null {
  const id = r.placeId || r.cid || r.fid;
  if (!id || !r.title) return null;
  const { street, city, postalCode } = splitAddress(r.address);
  const category = r.type ?? r.category ?? r.types?.[0] ?? null;
  const closed = /permanently closed|temporarily closed/i.test(`${r.description ?? ""} ${(r as { openState?: string }).openState ?? ""}`);
  const raw: Record<string, unknown> = { placeId: r.placeId, cid: r.cid, address: r.address, type: r.type, types: r.types, category: r.category, rating: r.rating, ratingCount: r.ratingCount, priceLevel: r.priceLevel, openingHours: r.openingHours, bookingLinks: r.bookingLinks, website: r.website, phoneNumber: r.phoneNumber, description: r.description, query };
  return {
    provider: "google_maps",
    providerId: id,
    name: r.title.trim(),
    category,
    matchedBy: `query "${query}"${category ? ` · ${category}` : ""}`,
    website: r.website?.trim() || null,
    phone: r.phoneNumber?.trim() || null,
    email: null,
    street,
    city: city ?? q.city ?? null,
    region: q.region ?? null,
    postalCode,
    country: q.country,
    lat: r.latitude ?? null,
    lng: r.longitude ?? null,
    sourceUrl: r.placeId ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(r.placeId)}` : r.cid ? `https://maps.google.com/?cid=${encodeURIComponent(r.cid)}` : null,
    attribution: GOOGLE_MAPS_ATTRIBUTION,
    raw,
    operatingStatus: closed ? "closed" : "unknown",
    brand: null,
    fetchedAt,
  };
}

export interface MapsPageFetch {
  page: SerperMapsPage;
  cached: boolean;
  fetchedAt: string;
}

/** One page, from the cache when fresh; otherwise a metered Serper call (budget checked first). */
export async function fetchMapsPage(params: { q: string; ll: string; gl: string; hl: string; page: number }, signal?: AbortSignal): Promise<MapsPageFetch> {
  const cfg = getConfig();
  const key = pageCacheKey(params);
  const hit = await cacheGet<SerperMapsPage>(key, cfg.SERPER_CACHE_DAYS);
  if (hit) return { page: hit.value, cached: true, fetchedAt: hit.fetchedAt };
  if (!cfg.SERPER_API_KEY) throw new ProviderError("SERPER_API_KEY is not set", "google_maps");
  const used = await usageTotal("serper");
  if (used >= cfg.SERPER_CREDIT_BUDGET) {
    throw new ProviderError(`Serper credit budget reached (${used}/${cfg.SERPER_CREDIT_BUDGET} credits used); raise SERPER_CREDIT_BUDGET only after buying credits`, "google_maps");
  }
  const body: Record<string, unknown> = { q: params.q, ll: params.ll, gl: params.gl, hl: params.hl };
  if (params.page > 1) body.page = params.page;
  const res = await (serperFetch ?? fetch)(SERPER_MAPS_URL, { method: "POST", headers: { "X-API-KEY": cfg.SERPER_API_KEY, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(60_000) });
  const text = await res.text();
  let page: SerperMapsPage;
  try {
    page = JSON.parse(text) as SerperMapsPage;
  } catch {
    throw new ProviderError(`Serper returned a non-JSON response (HTTP ${res.status})`, "google_maps", res.status >= 500);
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError(`Serper rejected the API key (HTTP ${res.status})`, "google_maps");
  if (res.status === 429) throw new ProviderError(`Serper rate limit (HTTP 429): ${page.message ?? "slow down"}`, "google_maps", true);
  if (!res.ok) throw new ProviderError(`Serper HTTP ${res.status}${page.message ? `: ${page.message}` : ""}`, "google_maps", res.status >= 500);
  // An empty `places` list is Google's answer for the area, not a failure; Serper still charges the credit.
  const fetchedAt = new Date().toISOString();
  await recordUsage("serper", Math.max(1, Number(page.credits) || 1));
  const stored: SerperMapsPage = { ll: page.ll, places: page.places ?? [] };
  await cachePut(key, "serper", stored);
  return { page: stored, cached: false, fetchedAt };
}

export const googleMapsProvider: DiscoveryProvider = {
  key: "google_maps",
  label: "Google Maps",
  status: "active",
  description: "Google Maps listings (name, category, address, phone, website, rating, reviews) read through Serper. 2,500 free credits on sign-up; a page of 20 listings costs 3 credits; every page is cached locally.",
  attribution: GOOGLE_MAPS_ATTRIBUTION,
  isAvailable: () => (getConfig().googleMaps.enabled ? { available: true } : { available: false, reason: "Set SERPER_API_KEY (serper.dev, free credits) to enable" }),
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
      for (let page = 1; page <= cfg.SERPER_MAX_PAGES; page++) {
        opts?.signal?.throwIfAborted();
        opts?.onProgress?.(`Google Maps: "${text}" page ${page}`);
        let fetched: MapsPageFetch;
        try {
          fetched = await fetchMapsPage({ q: text, ll, gl, hl, page }, opts?.signal);
        } catch (err) {
          // Budget exhausted mid-search: keep what was collected, say so, stop.
          if (err instanceof ProviderError && /credit budget/.test(err.message) && seen.size) {
            budgetStop = err.message;
            break outer;
          }
          throw err;
        }
        if (fetched.cached) pagesCached++;
        else pagesFetched++;
        const results = fetched.page.places ?? [];
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
        // A short page means Google has no more; a page with nothing new means paging has looped.
        if (results.length < PAGE_SIZE || fresh === 0) break;
      }
    }
    const used = await usageTotal("serper");
    notes.push(`${seen.size} listing(s) in ${area.label} from ${queries.length} quer${queries.length === 1 ? "y" : "ies"}: ${pagesFetched} page(s) fetched, ${pagesCached} from the local cache${outside ? `, ${outside} outside the search radius dropped` : ""}${offName ? `, ${offName} without "${kw}" in the name dropped` : ""}`);
    notes.push(`Serper credits used: ${used} of ${cfg.SERPER_CREDIT_BUDGET}`);
    if (budgetStop) notes.push(`Stopped early: ${budgetStop}`);
    const closed = [...seen.values()].filter((c) => c.operatingStatus === "closed").length;
    if (closed) notes.push(`${closed} marked closed by Google`);
    return { provider: "google_maps", candidates: [...seen.values()], attribution: GOOGLE_MAPS_ATTRIBUTION, notes, area: area.label, cached: pagesFetched === 0 && pagesCached > 0 ? "all" : pagesCached > 0 ? "some" : "none", release: null };
  },
};
