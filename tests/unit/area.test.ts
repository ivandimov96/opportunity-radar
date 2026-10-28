import { beforeEach, describe, expect, it } from "vitest";
import { _setGeocodeFetch, geocodeArea, resolveSearchArea } from "@/lib/discovery/area";
import { useTempDb, resetEnv } from "../helpers";

const nominatim = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("location resolution", () => {
  beforeEach(async () => {
    resetEnv({});
    await useTempDb();
    _setGeocodeFetch(null);
  });
  it("uses the typeahead center for a radius search without any lookup", async () => {
    let called = false;
    _setGeocodeFetch((async () => {
      called = true;
      return new Response("[]");
    }) as typeof fetch);
    const a = await resolveSearchArea({ industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 10, requireWebsite: false, areaMode: "radius", radiusKm: 10, lat: 30.27, lng: -97.74 });
    expect(called).toBe(false);
    expect(a).toMatchObject({ source: "typeahead", radiusKm: 10, center: { lat: 30.27, lon: -97.74 } });
    expect(a.label).toBe("10 km around Austin, Texas, United States");
  });
  it("takes the geocoder's boundary for a whole-city search, with the country and region spelled out, and caches it", async () => {
    let calls = 0;
    const urls: string[] = [];
    _setGeocodeFetch((async (url: string | URL) => {
      calls++;
      urls.push(String(url));
      return new Response(JSON.stringify([{ boundingbox: ["52.3", "52.7", "13.1", "13.8"], display_name: "Berlin, Deutschland", lat: "52.52", lon: "13.4" }]));
    }) as typeof fetch);
    const q = { industry: "auto_repair", country: "DE", region: "16", city: "Berlin", maxResults: 10, requireWebsite: false, areaMode: "area" as const };
    const a = await resolveSearchArea(q);
    expect(a).toMatchObject({ source: "geocoder", bbox: { south: 52.3, north: 52.7, west: 13.1, east: 13.8 }, radiusKm: null });
    const sp = new URL(urls[0]).searchParams;
    expect([sp.get("city"), sp.get("state"), sp.get("country"), sp.get("countrycodes")]).toEqual(["Berlin", "Berlin", "Germany", "de"]);
    await resolveSearchArea(q);
    expect(calls).toBe(1);
  });
  it("falls back to the bundled place with a population-based radius when the geocoder fails or answers with a region", async () => {
    _setGeocodeFetch(nominatim({ error: "down" }, 503));
    const a = await resolveSearchArea({ industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 10, requireWebsite: false, areaMode: "area" });
    expect(a.source).toBe("bundled");
    expect(a.radiusKm).toBe(15); // ~975k inhabitants
    _setGeocodeFetch(nominatim([{ boundingbox: ["25.8", "36.5", "-106.6", "-93.5"], display_name: "Texas", lat: "31", lon: "-99" }]));
    const b = await resolveSearchArea({ industry: "auto_repair", country: "US", region: "TX", city: "Houston", maxResults: 10, requireWebsite: false, areaMode: "area" });
    expect(b.source).toBe("bundled");
    expect(b.label).toMatch(/different place|boundary too large/);
  });
  it("rejects a geocoder answer far from the city's known center (wrong place) and uses the bundled center instead", async () => {
    _setGeocodeFetch(nominatim([{ boundingbox: ["49.4", "49.5", "10.9", "11.0"], display_name: "Berlinstraße, Fürth, Bayern, Deutschland", lat: "49.47", lon: "10.98" }]));
    const a = await resolveSearchArea({ industry: "dental", country: "DE", region: "16", city: "Berlin", maxResults: 10, requireWebsite: false, areaMode: "area" });
    expect(a.source).toBe("bundled");
    expect(a.center?.lat).toBeCloseTo(52.52, 1);
    expect(a.label).toMatch(/different place: Berlinstraße/);
  });
  it("treats a point-sized geocoder answer as no boundary and asks for settlements only", async () => {
    const urls: string[] = [];
    _setGeocodeFetch((async (url: string | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify([{ boundingbox: ["52.545", "52.546", "13.38", "13.381"], display_name: "Rheinmetall Werk Berlin, Mitte, Berlin", lat: "52.5455", lon: "13.3805", addresstype: "industrial" }]));
    }) as typeof fetch);
    await expect(geocodeArea({ city: "Berlin", region: "16", country: "DE" })).rejects.toThrow(/not a settlement/);
    expect(new URL(urls[0]).searchParams.get("featureType")).toBe("settlement");
    _setGeocodeFetch(nominatim([{ boundingbox: ["52.545", "52.546", "13.38", "13.381"], display_name: "Somewhere tiny, Berlin", lat: "52.5455", lon: "13.3805", addresstype: "city" }]));
    const a = await resolveSearchArea({ industry: "dental", country: "DE", region: "16", city: "Berlin", maxResults: 10, requireWebsite: false, areaMode: "area" });
    expect(a.source).toBe("bundled");
    expect(a.label).toMatch(/point, not a boundary/);
    expect(a.radiusKm).toBe(30);
  });
  it("refuses an area that is too large and reports a geocoder miss", async () => {
    _setGeocodeFetch(nominatim([]));
    await expect(geocodeArea({ city: "Nowhereville", country: "US" })).rejects.toThrow(/Could not geocode/);
    _setGeocodeFetch(nominatim([{ boundingbox: ["25.8", "36.5", "-106.6", "-93.5"], display_name: "Texas", lat: "31", lon: "-99" }]));
    await expect(resolveSearchArea({ industry: "auto_repair", country: "US", region: "TX", city: "Not A Real Place", maxResults: 10, requireWebsite: false, areaMode: "area" })).rejects.toThrow(/too large/);
  });
});
