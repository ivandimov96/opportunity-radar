/**
 * Location resolution, done once per search and shared by every provider.
 *  1. Radius around a center the form already knows (bundled GeoNames place): no lookup.
 *  2. Whole city or region: the geocoder's boundary (Nominatim, one query per
 *     distinct place, cached in the database, identifying user agent, ≥ 1 s
 *     between calls as its policy requires; never autocomplete, never bulk).
 *  3. Geocoder unavailable: the bundled place's center with a radius from its population.
 * Areas larger than a metro are refused: sources are pulled cell by cell and a
 * whole state would mean millions of rows; the form asks for a city instead.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { geocodeCache } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { countryName, defaultRadiusKm, findPlace, regionName } from "@/lib/geo/world";
import { bboxAround, bboxSpanKm, haversineKm, type BBox } from "./cells";
import { ProviderError, type DiscoveryQuery, type ResolvedArea } from "./types";

/** Largest span a search may cover (~130 km N–S). */
export const MAX_SPAN_DEG = 1.2;

export function assertReasonableBbox(bbox: BBox, label: string) {
  const dLat = bbox.north - bbox.south;
  const dLon = bbox.east - bbox.west;
  if (dLat > MAX_SPAN_DEG || dLon > MAX_SPAN_DEG * 1.6) {
    const { nsKm, ewKm } = bboxSpanKm(bbox);
    throw new ProviderError(`Area too large (${label}: ${Math.round(nsKm)} × ${Math.round(ewKm)} km). Pick a city, or a radius around one; whole regions are searched city by city.`, "overture");
  }
}

export interface GeoArea extends BBox {
  displayName: string;
  lat: number;
  lon: number;
}

let lastNominatimAt = 0;
let geocodeFetch: typeof fetch | null = null;
/** Test hook. */
export function _setGeocodeFetch(fn: typeof fetch | null) {
  geocodeFetch = fn;
}

/**
 * Nominatim boundary for a city, as a structured query (city / state / country +
 * country code) rather than free text: free text happily answers "Berlin" with
 * a Berlinstraße somewhere else. Cached forever per distinct place.
 */
export async function geocodeArea(parts: { city?: string | null; region?: string | null; country: string }, signal?: AbortSignal): Promise<GeoArea> {
  const cfg = getConfig();
  const state = parts.region ? regionName(parts.country, parts.region).replace(/^(state|province|region|department) of /i, "") : null;
  const q = [parts.city, state, countryName(parts.country)].filter(Boolean).join(", ");
  const key = `nominatim2:${parts.country.toLowerCase()}:${q.toLowerCase()}`;
  const db = await getDb();
  const cached = await db.select().from(geocodeCache).where(eq(geocodeCache.key, key)).get();
  if (cached && typeof (cached.value as unknown as GeoArea).lat === "number") return cached.value as unknown as GeoArea;

  const wait = 1100 - (Date.now() - lastNominatimAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
  const url = new URL("/search", cfg.NOMINATIM_ENDPOINT);
  if (parts.city) url.searchParams.set("city", parts.city);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("country", countryName(parts.country));
  url.searchParams.set("countrycodes", parts.country.toLowerCase());
  url.searchParams.set("featureType", "settlement");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const res = await (geocodeFetch ?? fetch)(url, { headers: { "User-Agent": cfg.OSM_USER_AGENT, Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (!res.ok) throw new ProviderError(`Nominatim HTTP ${res.status}`, "osm", res.status === 429 || res.status >= 500);
  const data = (await res.json()) as { boundingbox: string[]; display_name: string; lat: string; lon: string; addresstype?: string; type?: string }[];
  if (!data.length) throw new ProviderError(`Could not geocode location "${q}"`, "osm");
  const kind = data[0].addresstype ?? data[0].type ?? "";
  if (kind && !/^(city|town|village|municipality|borough|suburb|hamlet|county|state|administrative|boundary|locality|district|neighbourhood|quarter|city_district)$/i.test(kind)) {
    throw new ProviderError(`Geocoder answered "${q}" with a ${kind} (${data[0].display_name.split(",")[0]}), not a settlement`, "osm");
  }
  const [s, n, w, e] = data[0].boundingbox.map(Number);
  const value: GeoArea = { south: s, north: n, west: w, east: e, displayName: data[0].display_name, lat: Number(data[0].lat), lon: Number(data[0].lon) };
  const stored = value as unknown as Record<string, unknown>;
  await db.insert(geocodeCache).values({ key, value: stored }).onConflictDoUpdate({ target: geocodeCache.key, set: { value: stored } }).run();
  return value;
}

/**
 * `offline`: never call the geocoder; a whole-city search becomes a
 * population-based metro radius around the bundled place's center (used by
 * sources that take a map position rather than a boundary).
 */
export async function resolveSearchArea(q: DiscoveryQuery, signal?: AbortSignal, opts: { offline?: boolean } = {}): Promise<ResolvedArea> {
  const radius = q.areaMode === "radius" && q.radiusKm ? q.radiusKm : null;
  const placeLabel = [q.city, q.region ? regionName(q.country, q.region) : null, countryName(q.country)].filter(Boolean).join(", ");
  if (radius && q.lat != null && q.lng != null) {
    const bbox = bboxAround(q.lat, q.lng, radius);
    return { bbox, center: { lat: q.lat, lon: q.lng }, radiusKm: radius, label: `${radius} km around ${placeLabel}`, source: "typeahead" };
  }
  const bundled = findPlace(q.country, q.region, q.city);
  if (opts.offline) {
    if (!bundled) throw new ProviderError(`"${q.city ?? ""}" is not in the bundled place list; pick the city from the suggestions`, "google_maps");
    const km = radius ?? defaultRadiusKm(bundled.population);
    return { bbox: bboxAround(bundled.lat, bundled.lon, km), center: { lat: bundled.lat, lon: bundled.lon }, radiusKm: km, label: radius ? `${radius} km around ${placeLabel}` : `${km} km around ${bundled.name} (metro radius from population)`, source: "bundled" };
  }
  try {
    const area = await geocodeArea({ city: q.city, region: q.region, country: q.country }, signal);
    // Sanity check against the bundled place: a geocoder answer far from the city's known center is the wrong place.
    if (bundled && haversineKm(bundled.lat, bundled.lon, area.lat, area.lon) > 40) {
      const km = radius ?? defaultRadiusKm(bundled.population);
      return { bbox: bboxAround(bundled.lat, bundled.lon, km), center: { lat: bundled.lat, lon: bundled.lon }, radiusKm: km, label: `${km} km around ${bundled.name} (geocoder answered with a different place: ${area.displayName.split(",")[0]})`, source: "bundled" };
    }
    if (radius) return { bbox: bboxAround(area.lat, area.lon, radius), center: { lat: area.lat, lon: area.lon }, radiusKm: radius, label: `${radius} km around ${area.displayName}`, source: "geocoder" };
    const bbox: BBox = { south: area.south, west: area.west, north: area.north, east: area.east };
    const span = bbox.north - bbox.south;
    if (bundled && bboxSpanKm(bbox).nsKm < defaultRadiusKm(bundled.population) * 0.6) {
      // A point or a single building, not a city boundary: use a metro-sized radius around the known center.
      const km = radius ?? defaultRadiusKm(bundled.population);
      return { bbox: bboxAround(bundled.lat, bundled.lon, km), center: { lat: bundled.lat, lon: bundled.lon }, radiusKm: km, label: `${km} km around ${bundled.name} (geocoder returned a point, not a boundary)`, source: "bundled" };
    }
    if (span > MAX_SPAN_DEG && bundled) {
      // The geocoder answered with a whole region: fall back to a metro-sized radius around the bundled center.
      const km = defaultRadiusKm(bundled.population);
      return { bbox: bboxAround(bundled.lat, bundled.lon, km), center: { lat: bundled.lat, lon: bundled.lon }, radiusKm: km, label: `${km} km around ${bundled.name} (boundary too large to pull whole)`, source: "bundled" };
    }
    assertReasonableBbox(bbox, area.displayName);
    return { bbox, center: { lat: area.lat, lon: area.lon }, radiusKm: null, label: area.displayName, source: "geocoder" };
  } catch (err) {
    if (!bundled) throw err;
    const km = radius ?? defaultRadiusKm(bundled.population);
    return { bbox: bboxAround(bundled.lat, bundled.lon, km), center: { lat: bundled.lat, lon: bundled.lon }, radiusKm: km, label: `${km} km around ${bundled.name} (bundled place; geocoder unavailable)`, source: "bundled" };
  }
}
