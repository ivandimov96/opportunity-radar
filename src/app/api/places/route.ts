import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/geo/places";

/** City suggestions for the search form: /api/places?state=TX&q=aus */
export function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const q = url.searchParams.get("q") ?? "";
  const places = searchPlaces(state, q, 8).map((p) => ({ name: p.name, state: p.state, population: p.population, lat: p.lat, lon: p.lon }));
  return NextResponse.json({ places }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
