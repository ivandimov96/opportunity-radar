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
import { getPlaybook, selectorsFor } from "@/lib/industries";
import type { BusinessCandidate, DiscoveryProvider, DiscoveryQuery, ProviderResult } from "./types";
import { ProviderError } from "./types";

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

type BBox = { south: number; west: number; north: number; east: number };
export type GeoArea = BBox & { displayName: string; lat: number; lon: number };

export async function geocodeArea(q: DiscoveryQuery, signal?: AbortSignal): Promise<GeoArea> {
  const cfg = getConfig();
  const parts = [q.city, q.region, q.country].filter(Boolean).join(", ");
  const key = `nominatim:${parts.toLowerCase()}`;
  const db = await getDb();
  const cached = await db.select().from(geocodeCache).where(eq(geocodeCache.key, key)).get();
  if (cached && typeof (cached.value as GeoArea).lat === "number") return cached.value as GeoArea;

  const url = new URL("/search", cfg.NOMINATIM_ENDPOINT);
  url.searchParams.set("q", parts);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const res = await fetch(url, {
    headers: { "User-Agent": cfg.OSM_USER_AGENT, Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new ProviderError(`Nominatim HTTP ${res.status}`, "osm", res.status === 429 || res.status >= 500);
  const data = (await res.json()) as { boundingbox: string[]; display_name: string; lat: string; lon: string }[];
  if (!data.length) throw new ProviderError(`Could not geocode location "${parts}"`, "osm");
  const [s, n, w, e] = data[0].boundingbox.map(Number);
  const value: GeoArea = { south: s, north: n, west: w, east: e, displayName: data[0].display_name, lat: Number(data[0].lat), lon: Number(data[0].lon) };
  await db.insert(geocodeCache).values({ key, value }).onConflictDoUpdate({ target: geocodeCache.key, set: { value } }).run();
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

export function buildOverpassQuery(selectors: string[], where: BBox | { aroundLat: number; aroundLon: number; radiusM: number }, keywords?: string | null, nameRegex?: string | null): string {
  const scope = "aroundLat" in where ? `(around:${Math.round(where.radiusM)},${where.aroundLat},${where.aroundLon})` : `(${where.south},${where.west},${where.north},${where.east})`;
  const kw = keywords?.trim() ? `["name"~"${keywords.trim().replace(/["\\]/g, "")}",i]` : "";
  const lines = selectors.map((sel) => `nwr${sel}["name"]${kw}${scope};`);
  if (nameRegex) {
    // Second net: businesses whose name says what they do but whose tags do not (common in map data).
    const re = `["name"~"${nameRegex.replace(/["\\]/g, "")}",i]`;
    lines.push(`nwr${re}["shop"]["shop"!~"^(car|car_parts|fuel)$"]${kw}${scope};`, `nwr${re}["craft"]${kw}${scope};`, `nwr${re}["office"]${kw}${scope};`);
  }
  return `[out:json][timeout:45];\n(\n${lines.join("\n")}\n);\nout center tags;`;
}

/** One attempt per mirror first (bounded ~1 min each), then a second round; never more than ~8 minutes in total. */
async function runOverpass(query: string, signal?: AbortSignal, onProgress?: (m: string) => void): Promise<OverpassElement[]> {
  const cfg = getConfig();
  let lastErr: Error | null = null;
  for (let round = 1; round <= 2; round++) {
    for (const endpoint of cfg.overpassEndpoints) {
      try {
        onProgress?.(`Querying ${new URL(endpoint).hostname} (round ${round})`);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "User-Agent": cfg.OSM_USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }),
          signal: signal ?? AbortSignal.timeout(60_000),
        });
        if (res.status === 429 || res.status === 504 || res.status === 502 || res.status === 503) {
          lastErr = new ProviderError(`Overpass ${new URL(endpoint).hostname} HTTP ${res.status}`, "osm", true);
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
    if (round === 1) await new Promise((r) => setTimeout(r, 10_000));
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
    const { osmSelectors: selectors } = selectorsFor(playbook, q.segments ?? []);
    const nameRegex = q.segments?.length ? null : (playbook.osmNameRegex ?? null);
    if (!selectors.length) {
      throw new ProviderError(`No OpenStreetMap selectors configured for industry "${q.industry}"`, "osm");
    }
    if (!q.city && !q.region) throw new ProviderError("OpenStreetMap discovery needs at least a city or region", "osm");
    const radius = q.areaMode === "radius" && q.radiusKm ? q.radiusKm : null;
    let where: BBox | { aroundLat: number; aroundLon: number; radiusM: number };
    let areaName: string;
    if (radius && q.lat != null && q.lng != null) {
      // Center supplied by the form's city picker: no geocoding call needed.
      areaName = `${[q.city, q.region].filter(Boolean).join(", ")} (${q.lat}, ${q.lng})`;
      notes.push(`Radius ${radius} km around ${areaName}`);
      where = { aroundLat: q.lat, aroundLon: q.lng, radiusM: radius * 1000 };
    } else {
      const area = await geocodeArea(q, opts?.signal);
      areaName = area.displayName;
      notes.push(radius ? `Geocoded center: ${area.displayName} (${radius} km radius)` : `Geocoded area: ${area.displayName}`);
      where = radius ? { aroundLat: area.lat, aroundLon: area.lon, radiusM: radius * 1000 } : area;
    }
    // Precise tag query first (cheap for the shared servers); the name-pattern net only when the result is thin.
    const query = buildOverpassQuery(selectors, where, q.keywords);
    const elements = await runOverpass(query, opts?.signal, opts?.onProgress);
    let candidates = elements.map((e) => elementToCandidate(e, q.country)).filter((c): c is BusinessCandidate => !!c);
    notes.push(`Overpass returned ${candidates.length} named places from tag selectors`);
    if (nameRegex && candidates.length < q.maxResults) {
      try {
        opts?.onProgress?.("Few tagged results; running the name-pattern net");
        const extra = await runOverpass(buildOverpassQuery([], where, q.keywords, nameRegex), opts?.signal, opts?.onProgress);
        const known = new Set(candidates.map((c) => c.providerId));
        let added = 0;
        for (const el of extra) {
          const c = elementToCandidate(el, q.country);
          if (c && !known.has(c.providerId)) {
            candidates.push(c);
            added++;
          }
        }
        notes.push(`Name-pattern net added ${added} place(s)`);
      } catch (err) {
        notes.push(`Name-pattern net skipped: ${(err as Error).message}`);
      }
    }
    if (playbook.excludeNameRegex) {
      const before = candidates.length;
      candidates = candidates.filter((c) => !playbook.excludeNameRegex!.test(c.name));
      if (before !== candidates.length) notes.push(`Dropped ${before - candidates.length} adjacent businesses by name (tint, detailing, towing…)`);
    }
    // Fill city/region from the query when OSM address tags are missing (common).
    candidates = candidates.map((c) => ({ ...c, city: c.city ?? q.city ?? null, region: c.region ?? q.region ?? null }));
    // Prefer entries with websites first so the operator gets researchable businesses.
    candidates.sort((a, b) => Number(Boolean(b.website)) - Number(Boolean(a.website)));
    return { provider: "osm", candidates, attribution: OSM_ATTRIBUTION, notes, area: areaName };
  },
};
