/**
 * OpenStreetMap discovery via the Overpass API, as the secondary net.
 *
 * Compliance (docs/DECISIONS.md): data is ODbL and stored with attribution
 * "© OpenStreetMap contributors"; public instances get an identifying
 * User-Agent, one bounded query per fetch, retries across mirrors with pauses,
 * and results cached locally so the same area is not asked again for
 * OVERTURE_CACHE_DAYS. Sustained commercial volume belongs on a paid or
 * self-hosted instance, or on regional extracts (documented, not built).
 *
 * Same cell architecture as Overture: missing cells for the industry are
 * fetched with one Overpass query over their union (every tag selector of the
 * industry plus its name-pattern net), stored row by row with their tags, and
 * the search then runs locally (sub-type selectors re-matched on the stored
 * tags, radius, keywords). Nodes, ways and relations are all requested
 * (`nwr`, `out center`).
 */
import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sourceCells, sourcePlaces } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { newId, nowIso } from "@/lib/ids";
import { getPlaybook, selectorsFor } from "@/lib/industries";
import { assertReasonableBbox, resolveSearchArea } from "./area";
import { cellIdFor, cellsForBBox, haversineKm, inBBox, unionBBox, type BBox } from "./cells";
import { normalizeName, normalizePhone, normalizeWebsite, websiteDomain } from "./normalize";
import { matchOsm, resolveCategories } from "./taxonomy";
import type { BusinessCandidate, DiscoveryProvider, DiscoveryQuery, ProviderResult } from "./types";
import { ProviderError } from "./types";

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

export { geocodeArea } from "./area";

export type OverpassElement = {
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
  return `[out:json][timeout:60];\n(\n${lines.join("\n")}\n);\nout center tags;`;
}

export type OverpassRun = (query: string, signal?: AbortSignal, onProgress?: (m: string) => void) => Promise<OverpassElement[]>;

/** One attempt per mirror first (bounded ~1 min each), then a second round; never more than ~8 minutes in total. */
export const runOverpass: OverpassRun = async (query, signal, onProgress) => {
  const cfg = getConfig();
  let lastErr: Error | null = null;
  for (let round = 1; round <= 2; round++) {
    for (const endpoint of cfg.overpassEndpoints) {
      try {
        onProgress?.(`OpenStreetMap: querying ${new URL(endpoint).hostname} (round ${round})`);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "User-Agent": cfg.OSM_USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }),
          signal: signal ?? AbortSignal.timeout(75_000),
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
        if (signal?.aborted) throw err;
      }
    }
    if (round === 1) await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new ProviderError(`All Overpass endpoints failed: ${lastErr?.message ?? "unknown"}`, "osm", true);
};

/** An Overpass element as a candidate (used by tests and one-off scripts; the provider itself goes through the local cache). */
export function elementToCandidate(el: OverpassElement, country: string): BusinessCandidate | null {
  const t = el.tags ?? {};
  if (!t.name) return null;
  const lat = el.lat ?? el.center?.lat ?? null;
  const lng = el.lon ?? el.center?.lon ?? null;
  const { category } = elementCategory(t);
  return {
    provider: "osm",
    providerId: `${el.type}/${el.id}`,
    name: t.name,
    category,
    website: t.website ?? t["contact:website"] ?? t.url ?? null,
    phone: t.phone ?? t["contact:phone"] ?? null,
    email: t.email ?? t["contact:email"] ?? null,
    street: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null,
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

export function elementCategory(t: Record<string, string>): { category: string | null; path: string | null } {
  // Category = the tag value (what the lead score and the interface read); path keeps the key for local re-matching.
  for (const k of ["shop", "craft", "amenity", "office", "healthcare"]) if (t[k]) return { category: t[k], path: `|${k}=${t[k]}|` };
  return { category: null, path: null };
}

export interface OsmCellFetch {
  cells: string[];
  missing: string[];
  cached: "all" | "some" | "none";
  fetched: number;
  durationMs: number;
  release: string;
}

/** Make every cell of the bbox present locally for this industry (one Overpass query for the missing ones). */
export async function ensureOsmCells(industryKey: string, bbox: BBox, opts: { run?: OverpassRun; cacheDays?: number; signal?: AbortSignal; onProgress?: (m: string) => void; customNameRegex?: string | null } = {}): Promise<OsmCellFetch> {
  const cfg = getConfig();
  const playbook = getPlaybook(industryKey);
  const selectors = selectorsFor(playbook, []).osmSelectors;
  const nameRegex = opts.customNameRegex ?? playbook.osmNameRegex ?? null;
  if (!selectors.length && !nameRegex) throw new ProviderError(`No OpenStreetMap selectors configured for ${playbook.label}`, "osm");
  const scope = opts.customNameRegex ? `custom:${opts.customNameRegex}` : industryKey;
  const cacheDays = opts.cacheDays ?? cfg.OVERTURE_CACHE_DAYS;
  const db = await getDb();
  const cells = cellsForBBox(bbox);
  const since = new Date(Date.now() - cacheDays * 86_400_000).toISOString();
  const fresh = await db
    .select({ cell: sourceCells.cell })
    .from(sourceCells)
    .where(and(eq(sourceCells.provider, "osm"), eq(sourceCells.scope, scope), inArray(sourceCells.cell, cells), gt(sourceCells.fetchedAt, since)))
    .all();
  const freshSet = new Set(fresh.map((f) => f.cell));
  const missing = cells.filter((c) => !freshSet.has(c));
  const release = nowIso().slice(0, 10);
  if (!missing.length) return { cells, missing, cached: "all", fetched: 0, durationMs: 0, release };
  const pull = unionBBox(missing);
  assertReasonableBbox(pull, "requested area");
  const t0 = Date.now();
  const elements = await (opts.run ?? runOverpass)(buildOverpassQuery(selectors, pull, null, nameRegex), opts.signal, opts.onProgress);
  const durationMs = Date.now() - t0;
  const ts = nowIso();
  const counts = new Map<string, number>(missing.map((c) => [c, 0]));
  const values = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!t.name?.trim() || lat == null || lon == null) continue;
    const cell = cellIdFor(lat, lon);
    if (!counts.has(cell)) continue;
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
    const website = normalizeWebsite(t.website ?? t["contact:website"] ?? t.url ?? null);
    const { category, path } = elementCategory(t);
    values.push({
      id: newId(),
      provider: "osm" as const,
      providerId: `${el.type}/${el.id}`,
      release,
      cell,
      name: t.name.trim(),
      nameNormalized: normalizeName(t.name),
      category,
      categoryPath: path,
      website,
      websiteDomain: websiteDomain(website),
      phone: normalizePhone(t.phone ?? t["contact:phone"] ?? null),
      email: (t.email ?? t["contact:email"] ?? null)?.toLowerCase() ?? null,
      street: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null,
      city: t["addr:city"] ?? null,
      region: t["addr:state"] ?? null,
      postalCode: t["addr:postcode"] ?? null,
      country: t["addr:country"]?.toUpperCase() ?? null,
      lat,
      lon,
      operatingStatus: t.disused || t["disused:shop"] ? "closed" : "unknown",
      brand: t.brand ?? null,
      confidence: null,
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      raw: t as Record<string, unknown>,
      fetchedAt: ts,
    });
  }
  const CHUNK = 200;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    await db.batch(slice.map((v) => db.insert(sourcePlaces).values(v).onConflictDoUpdate({ target: [sourcePlaces.provider, sourcePlaces.providerId], set: { ...v, id: undefined as unknown as string } })) as unknown as Parameters<typeof db.batch>[0]);
  }
  await db.batch(
    missing.map((cell) =>
      db
        .insert(sourceCells)
        .values({ id: newId(), provider: "osm", scope, cell, release, rowCount: counts.get(cell) ?? 0, durationMs, fetchedAt: ts })
        .onConflictDoUpdate({ target: [sourceCells.provider, sourceCells.scope, sourceCells.cell], set: { release, rowCount: counts.get(cell) ?? 0, durationMs, fetchedAt: ts } }),
    ) as unknown as Parameters<typeof db.batch>[0],
  );
  return { cells, missing, cached: missing.length === cells.length ? "none" : "some", fetched: values.length, durationMs, release };
}

export function rowToCandidate(r: typeof sourcePlaces.$inferSelect, matchedBy: string, fallback: { city?: string | null; region?: string | null; country: string }): BusinessCandidate {
  return {
    provider: "osm",
    providerId: r.providerId,
    name: r.name,
    category: r.category,
    matchedBy,
    website: r.website,
    phone: r.phone,
    email: r.email,
    street: r.street,
    city: r.city ?? fallback.city ?? null,
    region: r.region ?? fallback.region ?? null,
    postalCode: r.postalCode,
    country: r.country ?? fallback.country,
    lat: r.lat,
    lng: r.lon,
    sourceUrl: r.sourceUrl,
    attribution: OSM_ATTRIBUTION,
    operatingStatus: r.operatingStatus,
    brand: r.brand,
    raw: r.raw ?? undefined,
    fetchedAt: r.fetchedAt,
  };
}

export const osmProvider: DiscoveryProvider = {
  key: "osm",
  label: "OpenStreetMap",
  // Disabled on 2026-10-28 (D25): Google Maps is the only offered source. Code and tests kept so it can be re-enabled.
  status: "disabled",
  description: "Community map data (ODbL, no key) as a second net: catches places the primary source misses; many entries lack a website. Public servers are shared, so areas are cached locally once read.",
  attribution: OSM_ATTRIBUTION,
  isAvailable: () => ({ available: true }),
  async discover(q, opts): Promise<ProviderResult> {
    const notes: string[] = [];
    const cats = resolveCategories(q.industry, q.segments ?? [], q.customCategory);
    if (!cats.osmSelectors.length && !cats.custom) throw new ProviderError(`No OpenStreetMap selectors configured for ${cats.industry.label}`, "osm");
    const area = q.area ?? (await resolveSearchArea(q, opts?.signal));
    const fetch = await ensureOsmCells(q.industry, area.bbox, { signal: opts?.signal, onProgress: opts?.onProgress, customNameRegex: cats.custom ? cats.osmNameRegex : null });
    const db = await getDb();
    const rows = await db.select().from(sourcePlaces).where(and(eq(sourcePlaces.provider, "osm"), inArray(sourcePlaces.cell, fetch.cells))).all();
    const kw = q.keywords?.trim().toLowerCase();
    let candidates: BusinessCandidate[] = [];
    for (const r of rows) {
      if (!inBBox(r.lat, r.lon, area.bbox)) continue;
      if (area.radiusKm && area.center && haversineKm(area.center.lat, area.center.lon, r.lat, r.lon) > area.radiusKm) continue;
      const tags = (r.raw ?? {}) as Record<string, string>;
      const matchedBy = matchOsm(cats.osmSelectors, tags, cats.osmNameRegex);
      if (!matchedBy) continue;
      if (kw && !r.name.toLowerCase().includes(kw)) continue;
      candidates.push(rowToCandidate(r, matchedBy, { city: q.city, region: q.region, country: q.country }));
    }
    notes.push(`${candidates.length} named place(s) in ${area.label}: ${fetch.cached === "all" ? `all ${fetch.cells.length} cell(s) from the local cache` : `${fetch.missing.length} of ${fetch.cells.length} cell(s) fetched from Overpass in ${(fetch.durationMs / 1000).toFixed(1)} s (${fetch.fetched} rows stored)`}`);
    if (cats.industry.excludeNameRegex) {
      const before = candidates.length;
      candidates = candidates.filter((c) => !cats.industry.excludeNameRegex!.test(c.name));
      if (before !== candidates.length) notes.push(`Dropped ${before - candidates.length} adjacent business(es) by name (tint, detailing, towing…)`);
    }
    candidates.sort((a, b) => Number(Boolean(b.website)) - Number(Boolean(a.website)));
    return { provider: "osm", candidates, attribution: OSM_ATTRIBUTION, notes, area: area.label, cached: fetch.cached, release: fetch.release };
  },
};
