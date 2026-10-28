/**
 * City typeahead over the bundled GeoNames places list (src/data/us-places.json,
 * CC BY 4.0). Loaded lazily on the server; prefix matches first, then word
 * matches, both ordered by population.
 */
import fs from "node:fs";
import path from "node:path";

export interface Place {
  name: string;
  state: string;
  population: number;
  lat: number;
  lon: number;
}

type Row = [string, string, number, number, number];
let cache: Place[] | null = null;

export function loadPlaces(): Place[] {
  if (cache) return cache;
  const file = path.join(process.cwd(), "src", "data", "us-places.json");
  const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Row[];
  cache = rows.map(([name, state, population, lat, lon]) => ({ name, state, population, lat, lon }));
  return cache;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function searchPlaces(state: string | null | undefined, query: string, limit = 8, places = loadPlaces()): Place[] {
  const q = fold(query);
  const st = state?.toUpperCase() || null;
  const pool = st ? places.filter((p) => p.state === st) : places;
  if (!q) return pool.slice(0, limit);
  const prefix: Place[] = [];
  const word: Place[] = [];
  for (const p of pool) {
    const n = fold(p.name);
    if (n.startsWith(q)) prefix.push(p);
    else if (n.includes(` ${q}`) || n.includes(`-${q}`)) word.push(p);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...word].slice(0, limit);
}

/** Exact place lookup (case-insensitive) for a known state; used to seed a radius center without geocoding. */
export function findPlace(state: string | null | undefined, name: string | null | undefined, places = loadPlaces()): Place | null {
  if (!state || !name) return null;
  const st = state.toUpperCase();
  const n = fold(name);
  return places.find((p) => p.state === st && fold(p.name) === n) ?? null;
}
