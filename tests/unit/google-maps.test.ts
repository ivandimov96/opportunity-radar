/**
 * Google Maps (SerpApi) provider against an injected transport: query
 * building, listing → candidate mapping, pagination, the local page cache
 * (second run costs nothing), the monthly budget guard, radius filtering,
 * closed listings and error handling. No network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnv, useTempDb } from "../helpers";
import { _setSerpFetch, fetchMapsPage, googleMapsProvider, googleQueriesFor, mapPosition, resultToCandidate, splitAddress, type SerpLocalResult } from "@/lib/discovery/google-maps";
import { recordUsage, usageThisMonth } from "@/lib/discovery/usage";
import { ProviderError } from "@/lib/discovery/types";

const listing = (i: number, over: Partial<SerpLocalResult> = {}): SerpLocalResult => ({
  position: i,
  title: `Shop ${i}`,
  place_id: `ChIJ${i}`,
  data_id: `0x${i}`,
  gps_coordinates: { latitude: 30.27 + i * 0.001, longitude: -97.74 },
  rating: 4.5,
  reviews: 10 + i,
  type: "Auto repair shop",
  types: ["Auto repair shop"],
  address: `${100 + i} Main St, Austin, TX 78701, United States`,
  phone: `(512) 555-01${String(i).padStart(2, "0")}`,
  website: `https://shop${i}.example`,
  open_state: "Open ⋅ Closes 6 PM",
  ...over,
});
const page = (items: SerpLocalResult[], next = true) => ({ local_results: items, serpapi_pagination: next ? { next: "https://serpapi.com/next" } : {} });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("google maps provider", () => {
  const calls: URL[] = [];
  beforeEach(async () => {
    resetEnv({ SERPAPI_API_KEY: "k-test", SERPAPI_MAX_PAGES: "3", SERPAPI_MONTHLY_SEARCH_BUDGET: "250" });
    await useTempDb();
    calls.length = 0;
  });
  afterEach(() => _setSerpFetch(null));
  const transport = (responder: (url: URL, n: number) => Response) =>
    _setSerpFetch((async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      calls.push(url);
      return responder(url, calls.length);
    }) as unknown as typeof fetch);
  const query = (over: Record<string, unknown> = {}) => ({ industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 50, requireWebsite: false, segments: [] as string[], areaMode: "radius" as const, radiusKm: 5, lat: 30.2672, lng: -97.7431, ...over });

  it("builds one Google query per chosen sub-type, the industry query otherwise, the free text for the generic industry", () => {
    expect(googleQueriesFor(query())).toEqual(["auto repair shop"]);
    expect(googleQueriesFor(query({ segments: ["tires", "quick_lube"] }))).toEqual(["tire shop", "oil change quick lube"]);
    expect(googleQueriesFor(query({ keywords: "euro" }))).toEqual(["euro auto repair shop"]);
    expect(googleQueriesFor(query({ industry: "generic", customCategory: "bakery" }))).toEqual(["bakery"]);
    expect(googleQueriesFor(query({ industry: "generic" }))).toEqual([]);
  });

  it("positions the map on the center with a height covering the radius, and splits Google's one-line address", () => {
    expect(mapPosition({ bbox: { south: 0, west: 0, north: 0, east: 0 }, center: { lat: 30.2672, lon: -97.7431 }, radiusKm: 5, label: "", source: "typeahead" })).toBe("@30.26720,-97.74310,10000m");
    expect(splitAddress("8215 Research Blvd, Austin, TX 78758, United States")).toEqual({ street: "8215 Research Blvd", city: "Austin", postalCode: "78758" });
    expect(splitAddress("1200 N Interstate 35, Round Rock, TX 78681, United States")).toEqual({ street: "1200 N Interstate 35", city: "Round Rock", postalCode: "78681" });
    expect(splitAddress("Kantstraße 12, 10623 Berlin, Germany")).toEqual({ street: "Kantstraße 12", city: "Berlin", postalCode: "10623" });
    expect(splitAddress("12 High St, London SW1A 1AA, United Kingdom")).toEqual({ street: "12 High St", city: "London", postalCode: "SW1A 1AA" });
    expect(splitAddress("Austin, TX")).toEqual({ street: "Austin", city: null, postalCode: null });
    expect(splitAddress(undefined)).toEqual({ street: null, city: null, postalCode: null });
  });

  it("maps a listing to a candidate with provenance, and flags permanently closed ones", () => {
    const c = resultToCandidate(listing(1), { city: "Austin", region: "TX", country: "US" }, "auto repair shop", "2026-10-28T00:00:00Z")!;
    expect(c).toMatchObject({ provider: "google_maps", providerId: "ChIJ1", name: "Shop 1", category: "Auto repair shop", website: "https://shop1.example", phone: "(512) 555-0101", street: "101 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US", lat: 30.271, lng: -97.74, operatingStatus: "unknown" });
    expect(c.sourceUrl).toBe("https://www.google.com/maps/place/?q=place_id:ChIJ1");
    expect(c.matchedBy).toBe('query "auto repair shop" · Auto repair shop');
    expect(c.raw).toMatchObject({ rating: 4.5, reviews: 11, query: "auto repair shop" });
    expect(resultToCandidate(listing(2, { open_state: "Permanently closed" }), { country: "US" }, "q", "t")!.operatingStatus).toBe("closed");
    // The city comes from Google's address (a radius search reaches neighbouring towns); the search city is the fallback.
    expect(resultToCandidate(listing(3, { address: "1200 N Interstate 35, Round Rock, TX 78681, United States" }), { city: "Austin", region: "TX", country: "US" }, "q", "t")!.city).toBe("Round Rock");
    expect(resultToCandidate(listing(4, { address: undefined }), { city: "Austin", region: "TX", country: "US" }, "q", "t")!.city).toBe("Austin");
    expect(resultToCandidate({ title: "No id" }, { country: "US" }, "q", "t")).toBeNull();
  });

  it("pages until a short page, dedupes across pages, counts every fetched page against the budget, and serves a repeat from the cache for free", async () => {
    transport((url) => {
      const start = Number(url.searchParams.get("start") ?? "0");
      expect(url.searchParams.get("engine")).toBe("google_maps");
      expect(url.searchParams.get("q")).toBe("auto repair shop");
      expect(url.searchParams.get("ll")).toBe("@30.26720,-97.74310,10000m");
      expect(url.searchParams.get("gl")).toBe("us");
      expect(url.searchParams.get("api_key")).toBe("k-test");
      if (start === 0) return json(200, page(Array.from({ length: 20 }, (_, i) => listing(i + 1))));
      if (start === 20) return json(200, page([listing(20), listing(21), listing(22)], false)); // overlap + short page
      throw new Error("should not page further");
    });
    const r = await googleMapsProvider.discover(query());
    expect(calls.length).toBe(2);
    expect(r.candidates.map((c) => c.providerId)).toHaveLength(22);
    expect(r.cached).toBe("none");
    expect(r.notes.join("\n")).toMatch(/22 listing\(s\).*2 page\(s\) fetched, 0 from the local cache/);
    expect(r.notes.join("\n")).toMatch(/SerpApi searches used this month: 2 of 250/);
    expect((await usageThisMonth("serpapi")).used).toBe(2);

    const again = await googleMapsProvider.discover(query());
    expect(calls.length).toBe(2); // nothing fetched
    expect(again.candidates).toHaveLength(22);
    expect(again.cached).toBe("all");
    expect((await usageThisMonth("serpapi")).used).toBe(2);
  });

  it("applies the name keyword as a filter as well as a query term", async () => {
    transport(() => json(200, page([listing(1, { title: "AAMCO Transmissions" }), listing(2, { title: "Joe's Garage" })], false)));
    const r = await googleMapsProvider.discover(query({ keywords: "transmission" }));
    expect(calls[0].searchParams.get("q")).toBe("transmission auto repair shop");
    expect(r.candidates.map((c) => c.name)).toEqual(["AAMCO Transmissions"]);
    expect(r.notes[0]).toMatch(/1 without "transmission" in the name dropped/);
  });

  it("stops at SERPAPI_MAX_PAGES and drops listings outside the search radius", async () => {
    transport((url) => {
      const start = Number(url.searchParams.get("start") ?? "0");
      const far = start === 40 ? { gps_coordinates: { latitude: 31.5, longitude: -97.74 } } : {};
      return json(200, page(Array.from({ length: 20 }, (_, i) => listing(start + i + 1, far))));
    });
    const r = await googleMapsProvider.discover(query());
    expect(calls.length).toBe(3);
    expect(r.candidates).toHaveLength(40);
    expect(r.notes[0]).toMatch(/20 outside the search radius dropped/);
  });

  it("refuses to fetch once the monthly budget is reached, and keeps what it has when the budget runs out mid-search", async () => {
    await recordUsage("serpapi", 250);
    transport(() => json(200, page([listing(1)])));
    await expect(googleMapsProvider.discover(query())).rejects.toThrow(/monthly budget reached \(250\/250/);
    expect(calls.length).toBe(0);

    await useTempDb();
    await recordUsage("serpapi", 249);
    transport(() => json(200, page(Array.from({ length: 20 }, (_, i) => listing(i + 1)))));
    const r = await googleMapsProvider.discover(query());
    expect(calls.length).toBe(1);
    expect(r.candidates).toHaveLength(20);
    expect(r.notes.join("\n")).toMatch(/Stopped early: SerpApi monthly budget reached \(250\/250/);
  });

  it("treats Google's 'no results' as an empty answer that still costs a search, and surfaces key, rate-limit and other errors", async () => {
    transport(() => json(200, { error: "Google hasn't returned any results for this query." }));
    const r = await googleMapsProvider.discover(query());
    expect(r.candidates).toEqual([]);
    expect((await usageThisMonth("serpapi")).used).toBe(1);

    transport(() => json(401, { error: "Invalid API key" }));
    await expect(fetchMapsPage({ q: "x", ll: "@1,1,1000m", gl: "us", hl: "en", start: 0 })).rejects.toThrow(/rejected the API key/);
    transport(() => json(429, { error: "Too many requests" }));
    await expect(fetchMapsPage({ q: "y", ll: "@1,1,1000m", gl: "us", hl: "en", start: 0 })).rejects.toMatchObject({ retryable: true });
    transport(() => new Response("<html>oops</html>", { status: 502 }));
    await expect(fetchMapsPage({ q: "z", ll: "@1,1,1000m", gl: "us", hl: "en", start: 0 })).rejects.toBeInstanceOf(ProviderError);
    expect((await usageThisMonth("serpapi")).used).toBe(1); // failures are not counted
  });

  it("is unavailable without a key, and needs a category for the generic industry", async () => {
    resetEnv({ SERPAPI_API_KEY: undefined });
    expect(googleMapsProvider.isAvailable()).toMatchObject({ available: false });
    resetEnv({ SERPAPI_API_KEY: "k" });
    expect(googleMapsProvider.isAvailable()).toEqual({ available: true });
    await expect(googleMapsProvider.discover(query({ industry: "generic" }))).rejects.toThrow(/enter the category/);
  });

  it("whole-city searches use the bundled metro radius and add the city to the query, with no geocoder call", async () => {
    transport((url) => {
      expect(url.searchParams.get("q")).toBe("auto repair shop in Austin, TX");
      expect(url.searchParams.get("ll")).toMatch(/^@30\.2672\d,-97\.7431\d,\d+m$/);
      return json(200, page([listing(1)], false));
    });
    const r = await googleMapsProvider.discover(query({ areaMode: "area", radiusKm: undefined, lat: null, lng: null }));
    expect(r.area).toMatch(/km around Austin \(metro radius from population\)/);
    expect(r.candidates).toHaveLength(1);
  });
});
