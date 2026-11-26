/**
 * Finding businesses without being asked. The operator says once who to look
 * for (Settings → Automation: a kind of business and a country, optionally a
 * region); the app then walks the cities of that area from the largest down,
 * one search at a time, and only when the stock of businesses waiting for
 * research runs low. It never repeats a city for the same kind of business,
 * and every search is one page of listings, so its cost is known beforehand.
 */
import { room } from "@/lib/usage";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { searches, type SearchFilters } from "@/db/schema";
import { findPlace, loadPlaces, type Place } from "@/lib/geo/world";
import { haversineKm } from "./cells";
import { newId } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { DEFAULT_FILTERS } from "@/lib/search-input";
import { getSettings, type SearchTarget } from "@/lib/settings";
import { workspaceId } from "@/lib/workspace";

/** Smaller towns have too few businesses of one kind to be worth a search of their own. */
export const AUTO_SEARCH_MIN_POPULATION = 80_000;
/** One page of listings per search. */
export const AUTO_SEARCH_RESULTS = 20;
export const AUTO_SEARCH_CREDITS = 3;

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** Around a town, smaller places are worth a search too: they are where a local seller's customers are. */
export const AUTO_SEARCH_MIN_POPULATION_NEARBY = 20_000;

/**
 * The cities of a target. Around a town: that town first, then the places within its distance, nearest
 * first. A whole region or country: its cities, largest first.
 */
export function citiesFor(target: SearchTarget, places: Place[] = loadPlaces()): Place[] {
  const centre = target.city ? (findPlace(target.country, target.region || null, target.city, places) ?? findPlace(target.country, null, target.city, places)) : null;
  if (centre) {
    const km = target.radiusKm ?? 25;
    return places
      .filter((p) => p.country === centre.country)
      .map((p) => ({ p, d: p === centre ? 0 : haversineKm(centre.lat, centre.lon, p.lat, p.lon) }))
      .filter(({ p, d }) => p === centre || (d <= km && p.population >= AUTO_SEARCH_MIN_POPULATION_NEARBY))
      .sort((a, b) => a.d - b.d)
      .map(({ p }) => p);
  }
  return places.filter((p) => p.country === target.country && (!target.region || (p.region ?? "").toUpperCase() === target.region) && p.population >= AUTO_SEARCH_MIN_POPULATION);
}

export interface DoneSearch {
  what: string | null;
  country: string;
  city: string | null;
}

/**
 * The next search to run: the target searched least so far (so several targets advance side by side),
 * and its largest city not searched yet for that kind of business. Null when every city of every target is done.
 */
export function pickNextSearch(targets: SearchTarget[], done: DoneSearch[], places: Place[] = loadPlaces()): { target: SearchTarget; place: Place } | null {
  const doneFor = (t: SearchTarget) => done.filter((d) => same(d.what, t.what) && d.country === t.country);
  const order = targets.map((t, i) => ({ t, i, n: doneFor(t).length })).sort((a, b) => a.n - b.n || a.i - b.i);
  for (const { t } of order) {
    const searched = doneFor(t);
    const place = citiesFor(t, places).find((p) => !searched.some((d) => same(d.city, p.name) || same(d.city, p.asciiName)));
    if (place) return { target: t, place };
  }
  return null;
}

/** Searches the app started on its own since local midnight, in the acting workspace. */
export async function autoSearchesToday(now = new Date()): Promise<number> {
  const db = await getDb();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const row = await db.select({ n: sql<number>`count(*)` }).from(searches).where(and(eq(searches.workspaceId, await workspaceId()), gte(searches.createdAt, midnight), sql`json_extract(${searches.filters}, '$.auto') = 1`)).get();
  return Number(row?.n ?? 0);
}

/** Starts the next search of the targets in the acting workspace. Returns what was started, or null when nothing is left to search. */
export async function startAutoSearch(targets: SearchTarget[]): Promise<{ id: string; name: string } | null> {
  const db = await getDb();
  const ws = await workspaceId();
  const rows = await db.select({ country: searches.country, city: searches.city, filters: searches.filters }).from(searches).where(eq(searches.workspaceId, ws)).all();
  const next = pickNextSearch(targets, rows.map((r) => ({ what: r.filters?.customCategory ?? null, country: r.country, city: r.city })));
  if (!next) return null;
  // The plan's monthly searches: the app does not start one on its own when none are left.
  if ((await room("searches")).left < 1) return null;
  const { target, place } = next;
  const id = newId();
  const region = place.region ?? (target.region || null);
  const name = `${target.what} · ${[place.name, region].filter(Boolean).join(", ")}`;
  // Not researched by the search itself: the scheduler's research step takes the best leads within the daily allowance.
  // What the profile says a business must have applies to a search the app starts, as it does to one started by hand.
  const needsPhone = (await getSettings()).targetNeedsPhone;
  const filters: SearchFilters = { ...DEFAULT_FILTERS, requirePhone: needsPhone || DEFAULT_FILTERS.requirePhone, skipKnown: true, centerLat: place.lat, centerLon: place.lon, customCategory: target.what, autoSave: true, auto: true };
  await db.insert(searches).values({ id, workspaceId: ws, name, industry: "generic", country: place.country, region, city: place.name, maxResults: AUTO_SEARCH_RESULTS, requireWebsite: true, autoInvestigate: false, filters, providers: ["google_maps"], status: "queued" }).run();
  await enqueueJob("discover_search", { searchId: id }, { idempotencyKey: `discover:${id}` });
  return { id, name };
}
