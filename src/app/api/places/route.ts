import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/geo/world";

/** City suggestions for the search form: /api/places?country=US&region=TX&q=aus (bundled GeoNames data, no lookup service). */
export function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const country = url.searchParams.get("country") ?? (state ? "US" : null);
  const region = url.searchParams.get("region") ?? state;
  const q = url.searchParams.get("q") ?? "";
  const places = searchPlaces(country, region, q, 8).map((p) => ({ name: p.name, country: p.country, region: p.region, state: p.region, population: p.population, lat: p.lat, lon: p.lon }));
  return NextResponse.json({ places }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
