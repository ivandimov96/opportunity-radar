/**
 * OpenStreetMap discovery via Overpass (POI search) and Nominatim (geocoding).
 *
 * Compliance notes (see docs/DECISIONS.md):
 *  - Data is ODbL; we store it with attribution "© OpenStreetMap contributors".
 *  - Public instances require an identifying User-Agent, modest rates, and
 *    caching. Nominatim results are cached in the database.
 *  - Commercial sustained volume should use a paid/self-hosted Overpass.
 */
import { eq } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { getDb } from "@/db/client";
import { geocodeCache } from "@/db/schema";
import { getPlaybook } from "@/lib/industries";
import type { BusinessCandidate, DiscoveryProvider, DiscoveryQuery, ProviderResult } from "./types";
import { ProviderError } from "./types";

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

type BBox = { south: number; west: number; north: number; east: number };

async function geocodeArea(q: DiscoveryQuery, signal?: AbortSignal): Promise<BBox & { displayName: string }> {
  const cfg = getConfig();
  const parts = [q.city, q.region, q.country].filter(Boolean).join(", ");
  const key = `nominatim:${parts.toLowerCase()}`;
  const db = getDb();
  const cached = db.select().from(geocodeCache).where(eq(geocodeCache.key, key)).get();
  if (cached) return cached.value as BBox & { displayName: string };

  const url = new URL("/search", cfg.NOMINATIM_ENDPOINT);
  url.searchParams.set("q", parts);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const res = await fetch(url, {
    headers: { "User-Agent": cfg.OSM_USER_AGENT, Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new ProviderError(`Nominatim HTTP ${res.status}`, "osm", res.status === 429 || res.status >= 500);
  const data = (await res.json()) as { boundingbox: string[]; display_name: string }[];
  if (!data.length) throw new ProviderError(`Could not geocode location "${parts}"`, "osm");
  const [s, n, w, e] = data[0].boundingbox.map(Number);
  const value = { south: s, north: n, west: w, east: e, displayName: data[0].display_name };
  db.insert(geocodeCache).values({ key, value }).onConflictDoNothing().run();
  return value;
}

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function buildOverpassQuery(selectors: string[], bbox: BBox, keywords?: string | null): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const kw = keywords?.trim() ? `["name"~"${keywords.trim().replace(/["\\]/g, "")}",i]` : "";
  const body = selectors.map((sel) => `nwr${sel}["name"]${kw}(${b});`).join("\n");
  return `[out:json][timeout:60];\n(\n${body}\n);\nout center tags;`;
}

async function runOverpass(query: string, signal?: AbortSignal, onProgress?: (m: string) => void): Promise<OverpassElement[]> {
  const cfg = getConfig();
  let lastErr: Error | null = null;
  for (const endpoint of cfg.overpassEndpoints) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        onProgress?.(`Querying ${new URL(endpoint).hostname} (attempt ${attempt})`);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "User-Agent": cfg.OSM_USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }),
          signal: signal ?? AbortSignal.timeout(90_000),
        });
        if (res.status === 429 || res.status === 504 || res.status === 502 || res.status === 503) {
          lastErr = new ProviderError(`Overpass ${new URL(endpoint).hostname} HTTP ${res.status}`, "osm", true);
          await new Promise((r) => setTimeout(r, attempt * 5_000));
          continue;
        }
        if (!res.ok) throw new ProviderError(`Overpass HTTP ${res.status}`, "osm", false);
        const data = (await res.json()) as { elements: OverpassElement[] };
        return data.elements ?? [];
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (err instanceof ProviderError && !err.retryable) throw err;
      }
    }
  }
  throw new ProviderError(`All Overpass endpoints failed: ${lastErr?.message ?? "unknown"}`, "osm", true);
}

export function elementToCandidate(el: OverpassElement, country: string): BusinessCandidate | null {
  const t = el.tags ?? {};
  if (!t.name) return null;
  const lat = el.lat ?? el.center?.lat ?? null;
  const lng = el.lon ?? el.center?.lon ?? null;
  const website = t.website ?? t["contact:website"] ?? t.url ?? null;
  const phone = t.phone ?? t["contact:phone"] ?? null;
  const email = t.email ?? t["contact:email"] ?? null;
  const category = t.shop ?? t.craft ?? t.amenity ?? t.office ?? t.healthcare ?? null;
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null;
  return {
    provider: "osm",
    providerId: `${el.type}/${el.id}`,
    name: t.name,
    category,
    website,
    phone,
    email,
    street,
    city: t["addr:city"] ?? null,
    region: t["addr:state"] ?? null,
    postalCode: t["addr:postcode"] ?? null,
    country: t["addr:country"] ?? country,
    lat,
    lng,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    attribution: OSM_ATTRIBUTION,
    raw: t,
  };
}

export const osmProvider: DiscoveryProvider = {
  key: "osm",
  label: "OpenStreetMap",
  isAvailable: () => ({ available: true }),
  async discover(q, opts): Promise<ProviderResult> {
    const notes: string[] = [];
    const playbook = getPlaybook(q.industry);
    const selectors = playbook.osmSelectors;
    if (!selectors.length) {
      throw new ProviderError(`No OpenStreetMap selectors configured for industry "${q.industry}"`, "osm");
    }
    if (!q.city && !q.region) throw new ProviderError("OpenStreetMap discovery needs at least a city or region", "osm");
    const area = await geocodeArea(q, opts?.signal);
    notes.push(`Geocoded area: ${area.displayName}`);
    const query = buildOverpassQuery(selectors, area, q.keywords);
    const elements = await runOverpass(query, opts?.signal, opts?.onProgress);
    let candidates = elements.map((e) => elementToCandidate(e, q.country)).filter((c): c is BusinessCandidate => !!c);
    notes.push(`Overpass returned ${candidates.length} named places`);
    // Fill city/region from the query when OSM address tags are missing (common).
    candidates = candidates.map((c) => ({ ...c, city: c.city ?? q.city ?? null, region: c.region ?? q.region ?? null }));
    // Prefer entries with websites first so the operator gets researchable businesses.
    candidates.sort((a, b) => Number(Boolean(b.website)) - Number(Boolean(a.website)));
    return { provider: "osm", candidates, attribution: OSM_ATTRIBUTION, notes };
  },
};
