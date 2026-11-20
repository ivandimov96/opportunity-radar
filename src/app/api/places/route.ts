import { NextResponse } from "next/server";
import { defaultRadiusKm, searchPlaces } from "@/lib/geo/world";

/** City suggestions for the search form: /api/places?country=US&region=TX&q=aus (bundled GeoNames data, no lookup service). */
export function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const country = url.searchParams.get("country") ?? (state ? "US" : null);
  const region = url.searchParams.get("region") ?? state;
  const q = url.searchParams.get("q") ?? "";
  // An empty query lists the largest places of the country or region (the form offers them as shortcuts).
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit")) || 8));
  // radiusKm: how far around the centre a "whole city" search reaches for a place of this size.
  const places = searchPlaces(country, region, q, limit).map((p) => ({ name: p.name, country: p.country, region: p.region, state: p.region, population: p.population, lat: p.lat, lon: p.lon, radiusKm: defaultRadiusKm(p.population) }));
  return NextResponse.json({ places }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
