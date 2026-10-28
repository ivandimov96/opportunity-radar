/**
 * Worldwide location reference data, bundled (GeoNames, CC BY 4.0), loaded
 * lazily on the server, no network:
 *  - countries (ISO 3166-1 alpha-2 → name, continent)
 *  - first-level regions per country (US states carry their USPS code; other
 *    countries use GeoNames admin1 codes)
 *  - places: every US place ≥ 1,000 inhabitants and every other place ≥ 15,000,
 *    with coordinates and population, for the city typeahead and radius centers
 * Nothing here geocodes: a whole-area search still resolves its boundary once
 * through the geocoder (cached); these records only name and center things.
 */
import fs from "node:fs";
import path from "node:path";

export interface Country {
  code: string;
  name: string;
  continent: string;
}
export interface Region {
  country: string;
  code: string;
  name: string;
}
export interface Place {
  name: string;
  asciiName: string;
  country: string;
  /** Region code within the country (US: state code). */
  region: string | null;
  population: number;
  lat: number;
  lon: number;
}

const dataDir = () => path.join(process.cwd(), "src", "data");
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(dataDir(), file), "utf8")) as T;

let countriesCache: Country[] | null = null;
let regionsCache: Region[] | null = null;
let placesCache: Place[] | null = null;

export function listCountries(): Country[] {
  if (!countriesCache) countriesCache = readJson<[string, string, string][]>("countries.json").map(([code, name, continent]) => ({ code, name, continent }));
  return countriesCache;
}

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  return listCountries().find((c) => c.code === code.toUpperCase())?.name ?? code;
}

export function listRegions(country: string): Region[] {
  if (!regionsCache) regionsCache = readJson<[string, string, string, string][]>("regions.json").map(([c, code, name]) => ({ country: c, code, name }));
  const cc = country.toUpperCase();
  return regionsCache.filter((r) => r.country === cc);
}

export function regionName(country: string | null | undefined, code: string | null | undefined): string {
  if (!country || !code) return code ?? "";
  return listRegions(country).find((r) => r.code.toUpperCase() === code.toUpperCase())?.name ?? code;
}

/** Folded for matching: lowercase, diacritics removed. Handles "São Paulo" ↔ "sao paulo", "Zürich" ↔ "zurich". */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function loadPlaces(): Place[] {
  if (placesCache) return placesCache;
  const us = readJson<[string, string, number, number, number][]>("us-places.json").map(([name, state, population, lat, lon]) => ({ name, asciiName: name, country: "US", region: state, population, lat, lon }));
  const world = readJson<[string, string, string, string, number, number, number][]>("world-places.json").map(([name, asciiName, country, region, population, lat, lon]) => ({ name, asciiName, country, region: region || null, population, lat, lon }));
  placesCache = [...us, ...world].sort((a, b) => b.population - a.population);
  return placesCache;
}

/** Typeahead: prefix matches first, then word matches, both by population; optional country and region filters. */
export function searchPlaces(country: string | null | undefined, region: string | null | undefined, query: string, limit = 8, places = loadPlaces()): Place[] {
  const q = fold(query);
  const cc = country?.toUpperCase() || null;
  const rc = region?.toUpperCase() || null;
  const pool = places.filter((p) => (!cc || p.country === cc) && (!rc || (p.region ?? "").toUpperCase() === rc));
  if (!q) return pool.slice(0, limit);
  const prefix: Place[] = [];
  const word: Place[] = [];
  for (const p of pool) {
    const names = [fold(p.name), fold(p.asciiName)];
    if (names.some((n) => n.startsWith(q))) prefix.push(p);
    else if (names.some((n) => n.includes(` ${q}`) || n.includes(`-${q}`))) word.push(p);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...word].slice(0, limit);
}

/** Exact place lookup (diacritics-insensitive) for a radius center without geocoding; the most populous match wins. */
export function findPlace(country: string | null | undefined, region: string | null | undefined, name: string | null | undefined, places = loadPlaces()): Place | null {
  if (!country || !name) return null;
  const cc = country.toUpperCase();
  const rc = region?.toUpperCase() || null;
  const n = fold(name);
  return places.find((p) => p.country === cc && (!rc || (p.region ?? "").toUpperCase() === rc) && (fold(p.name) === n || fold(p.asciiName) === n)) ?? null;
}

/** A sensible search radius for a whole-city search when no boundary is available, from population. */
export function defaultRadiusKm(population: number): number {
  if (population >= 3_000_000) return 30;
  if (population >= 1_000_000) return 22;
  if (population >= 300_000) return 15;
  if (population >= 80_000) return 9;
  if (population >= 20_000) return 6;
  return 4;
}
