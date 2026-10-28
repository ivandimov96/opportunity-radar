import { NextResponse } from "next/server";
import { listRegions } from "@/lib/geo/world";

/** First-level regions of a country for the search form: /api/regions?country=DE (bundled GeoNames data). */
export function GET(req: Request) {
  const url = new URL(req.url);
  const country = url.searchParams.get("country") ?? "";
  const regions = country ? listRegions(country).map((r) => ({ code: r.code, name: r.name })) : [];
  return NextResponse.json({ regions }, { headers: { "Cache-Control": "public, max-age=86400" } });
}
