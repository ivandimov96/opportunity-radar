/**
 * Overture Maps Places: bulk open data (CDLA-Permissive 2.0) read straight from the
 * public S3 release with DuckDB. No key, no rate limits, ~50M places with names,
 * categories, websites, phones, emails, socials, brand and open/closed status.
 * One query per (release, area, category set); results are cached in the database
 * so repeated searches of the same area cost nothing. Needs the native DuckDB
 * binary, so it is disabled on serverless hosts (OpenStreetMap is used there).
 */
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { placeCache } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { findPlace } from "@/lib/geo/places";
import { getPlaybook, selectorsFor } from "@/lib/industries";
import { geocodeArea } from "./osm";
import type { BusinessCandidate, DiscoveryProvider, DiscoveryQuery, ProviderResult } from "./types";
import { ProviderError } from "./types";

export const OVERTURE_ATTRIBUTION = "Overture Maps Foundation places data (CDLA-Permissive 2.0)";

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OvertureRow {
  id: string;
  name: string | null;
  category: string | null;
  operating_status: string | null;
  confidence: number | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  socials: string[] | null;
  brand: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
  lon: number | null;
  lat: number | null;
}

export type OvertureQuery = (bbox: BBox, categories: string[], release: string) => Promise<OvertureRow[]>;

/** A bbox around a center: 1° latitude ≈ 111 km; longitude shrinks with latitude. */
export function bboxAround(lat: number, lon: number, radiusKm: number): BBox {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
}

export function cacheKey(release: string, bbox: BBox, categories: string[]): string {
  const r = (n: number) => n.toFixed(3);
  return `overture|${release}|${r(bbox.south)},${r(bbox.west)},${r(bbox.north)},${r(bbox.east)}|${[...categories].sort().join(",")}`;
}

const sqlStr = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function buildOvertureSql(bbox: BBox, categories: string[], release: string): string {
  return `
SELECT id,
       names.primary AS name,
       taxonomy.primary AS category,
       operating_status,
       confidence,
       websites[1] AS website,
       phones[1] AS phone,
       emails[1] AS email,
       socials,
       brand.names.primary AS brand,
       addresses[1].freeform AS street,
       addresses[1].locality AS city,
       addresses[1].region AS region,
       addresses[1].postcode AS postcode,
       addresses[1].country AS country,
       bbox.xmin AS lon,
       bbox.ymin AS lat
FROM read_parquet('s3://overturemaps-us-west-2/release/${release.replace(/[^0-9.-]/g, "")}/theme=places/type=place/*', hive_partitioning=1)
WHERE bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east}
  AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}
  AND taxonomy.primary IN (${categories.map(sqlStr).join(", ")})
LIMIT 5000`;
}

// ------------------------------------------------------------- DuckDB access
type Duck = { runAndReadAll: (sql: string) => Promise<{ getRowObjects: () => Record<string, unknown>[] }>; run: (sql: string) => Promise<unknown> };
const g = globalThis as unknown as { __radarDuck?: Promise<Duck> };

async function getDuck(): Promise<Duck> {
  if (!g.__radarDuck) {
    g.__radarDuck = (async () => {
      const mod = await import("@duckdb/node-api");
      const inst = await mod.DuckDBInstance.create(":memory:");
      const conn = await inst.connect();
      await conn.run("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';");
      return conn as unknown as Duck;
    })();
    g.__radarDuck.catch(() => {
      g.__radarDuck = undefined;
    });
  }
  return g.__radarDuck;
}

const toStr = (v: unknown) => (v == null ? null : String(v));
const toNum = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

export const queryOvertureS3: OvertureQuery = async (bbox, categories, release) => {
  const duck = await getDuck();
  const res = await duck.runAndReadAll(buildOvertureSql(bbox, categories, release));
  return res.getRowObjects().map((r) => ({
    id: String(r.id),
    name: toStr(r.name),
    category: toStr(r.category),
    operating_status: toStr(r.operating_status),
    confidence: toNum(r.confidence),
    website: toStr(r.website),
    phone: toStr(r.phone),
    email: toStr(r.email),
    socials: Array.isArray(r.socials) ? (r.socials as unknown[]).map(String) : null,
    brand: toStr(r.brand),
    street: toStr(r.street),
    city: toStr(r.city),
    region: toStr(r.region),
    postcode: toStr(r.postcode),
    country: toStr(r.country),
    lon: toNum(r.lon),
    lat: toNum(r.lat),
  }));
};

/** Cached query: database first, S3 on a miss. */
export async function fetchPlaces(bbox: BBox, categories: string[], opts: { query?: OvertureQuery; release?: string; cacheDays?: number } = {}): Promise<{ rows: OvertureRow[]; cached: boolean; durationMs: number }> {
  const cfg = getConfig();
  const release = opts.release ?? cfg.OVERTURE_RELEASE;
  const cacheDays = opts.cacheDays ?? cfg.OVERTURE_CACHE_DAYS;
  const key = cacheKey(release, bbox, categories);
  const db = await getDb();
  const since = new Date(Date.now() - cacheDays * 86_400_000).toISOString();
  const hit = await db.select().from(placeCache).where(and(eq(placeCache.key, key), gt(placeCache.createdAt, since))).get();
  if (hit) return { rows: hit.rows as unknown as OvertureRow[], cached: true, durationMs: hit.durationMs ?? 0 };
  const t0 = Date.now();
  const rows = await (opts.query ?? queryOvertureS3)(bbox, categories, release);
  const durationMs = Date.now() - t0;
  await db
    .insert(placeCache)
    .values({ key, release, rows: rows as unknown as Record<string, unknown>[], rowCount: rows.length, durationMs })
    .onConflictDoUpdate({ target: placeCache.key, set: { release, rows: rows as unknown as Record<string, unknown>[], rowCount: rows.length, durationMs, createdAt: new Date().toISOString() } })
    .run();
  return { rows, cached: false, durationMs };
}

export function rowToCandidate(r: OvertureRow, fallback: { city?: string | null; region?: string | null; country: string }): BusinessCandidate | null {
  const name = r.name?.trim();
  if (!name) return null;
  return {
    provider: "overture",
    providerId: r.id,
    name,
    category: r.category,
    website: r.website,
    phone: r.phone,
    email: r.email,
    street: r.street,
    city: r.city ?? fallback.city ?? null,
    region: r.region ?? fallback.region ?? null,
    postalCode: r.postcode,
    country: r.country ?? fallback.country,
    lat: r.lat,
    lng: r.lon,
    sourceUrl: null,
    attribution: OVERTURE_ATTRIBUTION,
    operatingStatus: r.operating_status ?? "unknown",
    brand: r.brand,
    socials: r.socials ?? [],
    raw: { overtureId: r.id, confidence: r.confidence, category: r.category, operatingStatus: r.operating_status, brand: r.brand },
  };
}

/** Largest span (degrees) a single pull may cover: ~110 km. Whole states or regions must be searched city by city. */
export const MAX_BBOX_SPAN_DEG = 1.0;

export function assertReasonableBbox(bbox: BBox, label: string) {
  const dLat = bbox.north - bbox.south;
  const dLon = bbox.east - bbox.west;
  if (dLat > MAX_BBOX_SPAN_DEG || dLon > MAX_BBOX_SPAN_DEG * 1.4) throw new ProviderError(`Area too large for a bulk pull (${label}: ${Math.round(dLat * 111)} × ${Math.round(dLon * 85)} km). Pick a city, or a radius around one.`, "overture");
}

/** Resolve the search area to a bbox: typeahead center + radius, geocoded polygon bbox, or bundled place + default radius. */
export async function resolveArea(q: DiscoveryQuery, signal?: AbortSignal): Promise<{ bbox: BBox; label: string }> {
  const radius = q.areaMode === "radius" && q.radiusKm ? q.radiusKm : null;
  if (radius && q.lat != null && q.lng != null) return { bbox: bboxAround(q.lat, q.lng, radius), label: `${radius} km around ${[q.city, q.region].filter(Boolean).join(", ")} (${q.lat}, ${q.lng})` };
  try {
    const area = await geocodeArea(q, signal);
    if (radius) return { bbox: bboxAround(area.lat, area.lon, radius), label: `${radius} km around ${area.displayName}` };
    return { bbox: { south: area.south, west: area.west, north: area.north, east: area.east }, label: area.displayName };
  } catch (err) {
    const place = q.country === "US" ? findPlace(q.region, q.city) : null;
    if (!place) throw err;
    const km = radius ?? 15;
    return { bbox: bboxAround(place.lat, place.lon, km), label: `${km} km around ${place.name}, ${place.state} (bundled place; geocoder unavailable)` };
  }
}

export const overtureProvider: DiscoveryProvider = {
  key: "overture",
  label: "Overture Maps (open data)",
  isAvailable: () => (getConfig().overture.enabled ? { available: true } : { available: false, reason: "OVERTURE_ENABLED=false or serverless host (needs the native DuckDB binary)" }),
  async discover(q, opts): Promise<ProviderResult> {
    if (!q.city && !q.region && q.lat == null) throw new ProviderError("Overture discovery needs a city, a region, or a center", "overture");
    const playbook = getPlaybook(q.industry);
    const sel = selectorsFor(playbook, q.segments ?? []);
    if (!sel.overture.length) throw new ProviderError(`No Overture categories configured for ${playbook.label}`, "overture");
    const notes: string[] = [];
    if (sel.unsupportedByOverture.length) notes.push(`Overture cannot target: ${sel.unsupportedByOverture.join(", ")} (name-based sub-types need the map source)`);
    const { bbox, label } = await resolveArea(q, opts?.signal);
    assertReasonableBbox(bbox, label);
    opts?.onProgress?.(`Overture: reading places in ${label}`);
    const { rows, cached, durationMs } = await fetchPlaces(bbox, sel.overture);
    notes.push(`${rows.length} place(s) for ${sel.overture.length} categor${sel.overture.length === 1 ? "y" : "ies"} in ${label}${cached ? " (cached)" : ` (${(durationMs / 1000).toFixed(1)} s from S3)`}`);
    const closed = rows.filter((r) => r.operating_status === "closed").length;
    if (closed) notes.push(`${closed} marked closed by the source`);
    let candidates = rows.map((r) => rowToCandidate(r, { city: q.city, region: q.region, country: q.country })).filter((c): c is BusinessCandidate => !!c);
    if (q.keywords?.trim()) {
      const kw = q.keywords.trim().toLowerCase();
      candidates = candidates.filter((c) => c.name.toLowerCase().includes(kw));
    }
    if (playbook.excludeNameRegex) {
      const before = candidates.length;
      candidates = candidates.filter((c) => !playbook.excludeNameRegex!.test(c.name));
      if (before !== candidates.length) notes.push(`Dropped ${before - candidates.length} adjacent businesses by name`);
    }
    return { provider: "overture", candidates, attribution: OVERTURE_ATTRIBUTION, notes, area: label };
  },
};
