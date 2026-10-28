/**
 * Overture Maps Places: bulk open data (CDLA-Permissive 2.0) read straight from
 * the public GeoParquet release with DuckDB. No key, no rate limits, ~50M
 * places worldwide with names, categories, websites, phones, emails, socials,
 * brand and open/closed status.
 *
 * Architecture: the latest release comes from Overture's STAC catalog (cached a
 * day; OVERTURE_RELEASE pins one). The search area is split into grid cells;
 * cells not yet cached for the industry (its full category set) are pulled with
 * ONE bounded S3 query for their union and stored row by row in `source_places`;
 * the search itself then runs locally (bbox or radius, sub-type and name
 * filters), so repeated and adjacent searches cost no remote reads. Cells are
 * refreshed after OVERTURE_CACHE_DAYS or when a new release appears. Needs the
 * native DuckDB binary, so it is disabled on serverless hosts.
 */
import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sourceCells, sourcePlaces } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { newId, nowIso } from "@/lib/ids";
import { cellIdFor, cellsForBBox, haversineKm, inBBox, unionBBox, type BBox } from "./cells";
import { assertReasonableBbox, resolveSearchArea } from "./area";
import { normalizeName, normalizePhone, normalizeWebsite, websiteDomain } from "./normalize";
import { matchOverture, resolveCategories, type OvertureSpec } from "./taxonomy";
import type { BusinessCandidate, DiscoveryProvider, DiscoveryQuery, ProviderResult } from "./types";
import { ProviderError } from "./types";

export const OVERTURE_ATTRIBUTION = "Overture Maps Foundation places data (CDLA-Permissive 2.0)";
export const STAC_CATALOG_URL = "https://stac.overturemaps.org/catalog.json";
const FALLBACK_RELEASE = "2026-10-21.0";

export interface OvertureRow {
  id: string;
  name: string | null;
  category: string | null;
  hierarchy: string[] | null;
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
  source_dataset: string | null;
  source_updated: string | null;
}

export type OvertureQuery = (bbox: BBox, spec: OvertureSpec, release: string) => Promise<OvertureRow[]>;

// ------------------------------------------------------------------ release
let releaseCache: { at: number; value: string } | null = null;
let stacFetch: typeof fetch | null = null;
/** Test hook. */
export function _setStacFetch(fn: typeof fetch | null) {
  stacFetch = fn;
  releaseCache = null;
}

/** The release to read: pinned by OVERTURE_RELEASE, otherwise the STAC catalog's `latest` (cached 24 h, last known value on failure). */
export async function resolveRelease(): Promise<{ release: string; source: "pinned" | "stac" | "fallback" }> {
  const cfg = getConfig();
  if (cfg.OVERTURE_RELEASE && cfg.OVERTURE_RELEASE !== "auto") return { release: cfg.OVERTURE_RELEASE, source: "pinned" };
  if (releaseCache && Date.now() - releaseCache.at < 86_400_000) return { release: releaseCache.value, source: "stac" };
  try {
    const res = await (stacFetch ?? fetch)(STAC_CATALOG_URL, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cat = (await res.json()) as { latest?: string };
    if (!cat.latest || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(cat.latest)) throw new Error("catalog has no latest release");
    releaseCache = { at: Date.now(), value: cat.latest };
    return { release: cat.latest, source: "stac" };
  } catch {
    return { release: releaseCache?.value ?? FALLBACK_RELEASE, source: "fallback" };
  }
}

// ------------------------------------------------------------------ SQL
const sqlStr = (v: string) => `'${v.replace(/'/g, "''")}'`;
const sqlList = (vs: string[]) => vs.map(sqlStr).join(", ");

export function buildOvertureSql(bbox: BBox, spec: OvertureSpec, release: string): string {
  const where: string[] = [];
  if (spec.hierarchy.length) where.push(`list_has_any(taxonomy.hierarchy, [${sqlList(spec.hierarchy)}])`);
  if (spec.primary.length) where.push(`taxonomy.primary IN (${sqlList(spec.primary)})`);
  if (!where.length) throw new ProviderError("No Overture categories to search", "overture");
  const excl = spec.exclude.length ? ` AND taxonomy.primary NOT IN (${sqlList(spec.exclude)})` : "";
  return `
SELECT id,
       names.primary AS name,
       taxonomy.primary AS category,
       taxonomy.hierarchy AS hierarchy,
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
       bbox.ymin AS lat,
       sources[1].dataset AS source_dataset,
       sources[1].update_time AS source_updated
FROM read_parquet('s3://overturemaps-us-west-2/release/${release.replace(/[^0-9.-]/g, "")}/theme=places/type=place/*', hive_partitioning=1)
WHERE bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east}
  AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}
  AND (${where.join(" OR ")})${excl}
LIMIT 20000`;
}

// ------------------------------------------------------------------ DuckDB access
type Duck = { runAndReadAll: (sql: string) => Promise<{ getRowObjects: () => Record<string, unknown>[] }>; run: (sql: string) => Promise<unknown> };
const g = globalThis as unknown as { __radarDuck?: Promise<Duck>; __radarDuckQueue?: Promise<unknown> };

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
const toList = (v: unknown): string[] | null => (Array.isArray(v) ? v.map(String) : v && typeof v === "object" && Array.isArray((v as { items?: unknown[] }).items) ? ((v as { items: unknown[] }).items.map(String)) : null);

/** S3 reads run one at a time: a remote GeoParquet scan is the expensive step, and two at once only slow each other. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__radarDuckQueue ?? Promise.resolve()).then(fn, fn);
  g.__radarDuckQueue = run.catch(() => {});
  return run;
}

export const queryOvertureS3: OvertureQuery = (bbox, spec, release) =>
  serialized(async () => {
    const duck = await getDuck();
    const res = await duck.runAndReadAll(buildOvertureSql(bbox, spec, release));
    return res.getRowObjects().map((r) => ({
      id: String(r.id),
      name: toStr(r.name),
      category: toStr(r.category),
      hierarchy: toList(r.hierarchy),
      operating_status: toStr(r.operating_status),
      confidence: toNum(r.confidence),
      website: toStr(r.website),
      phone: toStr(r.phone),
      email: toStr(r.email),
      socials: toList(r.socials),
      brand: toStr(r.brand),
      street: toStr(r.street),
      city: toStr(r.city),
      region: toStr(r.region),
      postcode: toStr(r.postcode),
      country: toStr(r.country),
      lon: toNum(r.lon),
      lat: toNum(r.lat),
      source_dataset: toStr(r.source_dataset),
      source_updated: toStr(r.source_updated),
    }));
  });

// ------------------------------------------------------------------ cell cache
export interface CellFetch {
  cells: string[];
  missing: string[];
  cached: "all" | "some" | "none";
  fetched: number;
  durationMs: number;
  release: string;
}

/** Make every cell of the bbox present in the local table for this scope (one S3 query for the missing ones). */
export async function ensureOvertureCells(scope: string, bbox: BBox, specAll: OvertureSpec, opts: { query?: OvertureQuery; release?: string; cacheDays?: number; onProgress?: (m: string) => void } = {}): Promise<CellFetch> {
  const cfg = getConfig();
  const release = opts.release ?? (await resolveRelease()).release;
  const cacheDays = opts.cacheDays ?? cfg.OVERTURE_CACHE_DAYS;
  const db = await getDb();
  const cells = cellsForBBox(bbox);
  const since = new Date(Date.now() - cacheDays * 86_400_000).toISOString();
  const fresh = await db
    .select({ cell: sourceCells.cell })
    .from(sourceCells)
    .where(and(eq(sourceCells.provider, "overture"), eq(sourceCells.scope, scope), inArray(sourceCells.cell, cells), eq(sourceCells.release, release), gt(sourceCells.fetchedAt, since)))
    .all();
  const freshSet = new Set(fresh.map((f) => f.cell));
  const missing = cells.filter((c) => !freshSet.has(c));
  if (!missing.length) return { cells, missing, cached: "all", fetched: 0, durationMs: 0, release };
  const pull = unionBBox(missing);
  assertReasonableBbox(pull, "requested area");
  opts.onProgress?.(`Overture ${release}: reading ${missing.length} of ${cells.length} cell(s) from the public release`);
  const t0 = Date.now();
  const rows = await (opts.query ?? queryOvertureS3)(pull, specAll, release);
  const durationMs = Date.now() - t0;
  const ts = nowIso();
  const counts = new Map<string, number>(missing.map((c) => [c, 0]));
  const values = rows
    .filter((r) => r.name?.trim() && r.lat != null && r.lon != null)
    .map((r) => {
      const cell = cellIdFor(r.lat!, r.lon!);
      if (counts.has(cell)) counts.set(cell, (counts.get(cell) ?? 0) + 1);
      const website = normalizeWebsite(r.website);
      return {
        id: newId(),
        provider: "overture" as const,
        providerId: r.id,
        release,
        cell,
        name: r.name!.trim(),
        nameNormalized: normalizeName(r.name!),
        category: r.category,
        categoryPath: r.hierarchy?.length ? `|${r.hierarchy.join("|")}|` : r.category ? `|${r.category}|` : null,
        website,
        websiteDomain: websiteDomain(website),
        phone: normalizePhone(r.phone),
        email: r.email?.toLowerCase() ?? null,
        street: r.street,
        city: r.city,
        region: r.region,
        postalCode: r.postcode,
        country: r.country?.toUpperCase() ?? null,
        lat: r.lat!,
        lon: r.lon!,
        operatingStatus: r.operating_status ?? "unknown",
        brand: r.brand,
        confidence: r.confidence,
        sourceUrl: null,
        raw: { overtureId: r.id, confidence: r.confidence, category: r.category, hierarchy: r.hierarchy, operatingStatus: r.operating_status, brand: r.brand, socials: r.socials, phoneRaw: r.phone, websiteRaw: r.website, dataset: r.source_dataset, sourceUpdated: r.source_updated },
        fetchedAt: ts,
      };
    })
    // Only cells we asked for: the union bbox may spill into cells that stay "unknown" until their own fetch.
    .filter((v) => counts.has(v.cell));
  const CHUNK = 200;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    await db.batch(slice.map((v) => db.insert(sourcePlaces).values(v).onConflictDoUpdate({ target: [sourcePlaces.provider, sourcePlaces.providerId], set: { ...v, id: undefined as unknown as string } })) as unknown as Parameters<typeof db.batch>[0]);
  }
  await db.batch(
    missing.map((cell) =>
      db
        .insert(sourceCells)
        .values({ id: newId(), provider: "overture", scope, cell, release, rowCount: counts.get(cell) ?? 0, durationMs, fetchedAt: ts })
        .onConflictDoUpdate({ target: [sourceCells.provider, sourceCells.scope, sourceCells.cell], set: { release, rowCount: counts.get(cell) ?? 0, durationMs, fetchedAt: ts } }),
    ) as unknown as Parameters<typeof db.batch>[0],
  );
  return { cells, missing, cached: missing.length === cells.length ? "none" : "some", fetched: values.length, durationMs, release };
}

/** Local search over cached rows: bbox or radius, category spec, keywords. */
export async function searchLocalOverture(cells: string[], bbox: BBox, spec: OvertureSpec, opts: { center?: { lat: number; lon: number } | null; radiusKm?: number | null; keywords?: string | null }) {
  const db = await getDb();
  const rows = await db.select().from(sourcePlaces).where(and(eq(sourcePlaces.provider, "overture"), inArray(sourcePlaces.cell, cells))).all();
  const kw = opts.keywords?.trim().toLowerCase();
  const out: { row: (typeof rows)[number]; matchedBy: string }[] = [];
  for (const r of rows) {
    if (!inBBox(r.lat, r.lon, bbox)) continue;
    if (opts.radiusKm && opts.center && haversineKm(opts.center.lat, opts.center.lon, r.lat, r.lon) > opts.radiusKm) continue;
    const path = r.categoryPath ? r.categoryPath.split("|").filter(Boolean) : null;
    const matchedBy = matchOverture(spec, r.category, path, r.name);
    if (!matchedBy) continue;
    if (kw && !r.name.toLowerCase().includes(kw)) continue;
    out.push({ row: r, matchedBy });
  }
  return out;
}

export function rowToCandidate(r: typeof sourcePlaces.$inferSelect, matchedBy: string, fallback: { city?: string | null; region?: string | null; country: string }): BusinessCandidate {
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  return {
    provider: "overture",
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
    sourceUrl: null,
    attribution: OVERTURE_ATTRIBUTION,
    operatingStatus: r.operatingStatus ?? "unknown",
    brand: r.brand,
    socials: Array.isArray(raw.socials) ? (raw.socials as string[]) : [],
    raw: { ...raw, release: r.release },
    fetchedAt: r.fetchedAt,
  };
}

export const overtureProvider: DiscoveryProvider = {
  key: "overture",
  label: "Overture Maps",
  // Disabled on 2026-10-28 (D25): Google Maps is the only offered source. Code and tests kept so it can be re-enabled.
  status: "disabled",
  description: "Open places data read straight from the public release (no key): names, categories, websites, phones, emails, brand and open/closed status, worldwide. Areas are cached locally once read.",
  attribution: OVERTURE_ATTRIBUTION,
  isAvailable: () => (getConfig().overture.enabled ? { available: true } : { available: false, reason: "OVERTURE_ENABLED=false or serverless host (needs the native DuckDB binary)" }),
  async discover(q, opts): Promise<ProviderResult> {
    const cats = resolveCategories(q.industry, q.segments ?? [], q.customCategory);
    if (!cats.overture.hierarchy.length && !cats.overture.primary.length) throw new ProviderError(`No Overture categories for ${cats.industry.label}${cats.custom ? ` / "${cats.custom}"` : ""}; enter a category to look for`, "overture");
    const notes: string[] = [];
    if (cats.overtureNameOnly.length) notes.push(`Sub-type(s) without an Overture category, matched by name pattern: ${cats.overtureNameOnly.join(", ")}`);
    const area = q.area ?? (await resolveSearchArea(q, opts?.signal));
    const scope = cats.custom ? `custom:${cats.custom}` : cats.industry.key;
    const fetch = await ensureOvertureCells(scope, area.bbox, cats.overtureAll, { onProgress: opts?.onProgress });
    const hits = await searchLocalOverture(fetch.cells, area.bbox, cats.overture, { center: area.center, radiusKm: area.radiusKm, keywords: q.keywords });
    notes.push(`${hits.length} place(s) in ${area.label}: ${fetch.cached === "all" ? `all ${fetch.cells.length} cell(s) from the local cache` : `${fetch.missing.length} of ${fetch.cells.length} cell(s) read from release ${fetch.release} in ${(fetch.durationMs / 1000).toFixed(1)} s (${fetch.fetched} rows stored)`}`);
    const closed = hits.filter((h) => h.row.operatingStatus === "closed").length;
    if (closed) notes.push(`${closed} marked closed by the source`);
    let candidates = hits.map((h) => rowToCandidate(h.row, h.matchedBy, { city: q.city, region: q.region, country: q.country }));
    if (cats.industry.excludeNameRegex) {
      const before = candidates.length;
      candidates = candidates.filter((c) => !cats.industry.excludeNameRegex!.test(c.name));
      if (before !== candidates.length) notes.push(`Dropped ${before - candidates.length} adjacent business(es) by name`);
    }
    return { provider: "overture", candidates, attribution: OVERTURE_ATTRIBUTION, notes, area: area.label, cached: fetch.cached, release: fetch.release };
  },
};
