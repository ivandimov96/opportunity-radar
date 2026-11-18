/**
 * Google Maps (Serper) provider against an injected transport: query
 * building, listing → candidate mapping, pagination, the local page cache
 * (second run costs nothing), the credit budget guard, radius filtering and
 * error handling. No network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnv, useTempDb } from "../helpers";
import { _setSerperFetch, fetchMapsPage, googleMapsProvider, googleQueriesFor, mapPosition, resultToCandidate, splitAddress, zoomFor, type SerperPlace } from "@/lib/discovery/google-maps";
import { recordUsage, usageTotal } from "@/lib/discovery/usage";
import { ProviderError } from "@/lib/discovery/types";

const listing = (i: number, over: Partial<SerperPlace> = {}): SerperPlace => ({
  position: i,
  title: `Shop ${i}`,
  placeId: `ChIJ${i}`,
  cid: `${1000 + i}`,
  latitude: 30.27 + i * 0.001,
  longitude: -97.74,
  rating: 4.5,
  ratingCount: 10 + i,
  type: "Auto repair shop",
  types: ["Auto repair shop"],
  address: `${100 + i} Main St, Austin, TX 78701`,
  phoneNumber: `(512) 555-01${String(i).padStart(2, "0")}`,
  website: `https://shop${i}.example`,
  ...over,
});
const page = (items: SerperPlace[]) => ({ ll: "@30.26720,-97.74310,13z", places: items, credits: 1 });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("google maps provider (Serper)", () => {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  beforeEach(async () => {
    resetEnv({ SERPER_API_KEY: "k-test", SERPER_MAX_PAGES: "3", SERPER_CREDIT_BUDGET: "2500" });
    await useTempDb();
    calls.length = 0;
  });
  afterEach(() => _setSerperFetch(null));
  const transport = (responder: (body: Record<string, unknown>, n: number) => Response) =>
    _setSerperFetch((async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ url: String(input), body, headers: (init?.headers ?? {}) as Record<string, string> });
      return responder(body, calls.length);
    }) as unknown as typeof fetch);
  const query = (over: Record<string, unknown> = {}) => ({ industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 50, requireWebsite: false, segments: [] as string[], areaMode: "radius" as const, radiusKm: 5, lat: 30.2672, lng: -97.7431, ...over });

  it("builds one Google query per chosen sub-type, the industry query otherwise, the free text for the generic industry", () => {
    expect(googleQueriesFor(query())).toEqual(["auto repair shop"]);
    expect(googleQueriesFor(query({ segments: ["tires", "quick_lube"] }))).toEqual(["tire shop", "oil change quick lube"]);
    expect(googleQueriesFor(query({ keywords: "euro" }))).toEqual(["euro auto repair shop"]);
    expect(googleQueriesFor(query({ industry: "generic", customCategory: "bakery" }))).toEqual(["bakery"]);
    expect(googleQueriesFor(query({ industry: "generic" }))).toEqual([]);
  });

  it("positions the map on the center with a zoom covering the radius, and splits Google's one-line address", () => {
    expect(zoomFor(2.5)).toBe(14);
    expect(zoomFor(5)).toBe(13);
    expect(zoomFor(20)).toBe(11);
    expect(zoomFor(0.1)).toBe(16);
    expect(zoomFor(5000)).toBe(8);
    expect(mapPosition({ bbox: { south: 0, west: 0, north: 0, east: 0 }, center: { lat: 30.2672, lon: -97.7431 }, radiusKm: 5, label: "", source: "typeahead" })).toBe("@30.26720,-97.74310,13z");
    expect(splitAddress("8215 Research Blvd, Austin, TX 78758, United States")).toEqual({ street: "8215 Research Blvd", city: "Austin", postalCode: "78758" });
    expect(splitAddress("8215 Research Blvd, Austin, TX 78758")).toEqual({ street: "8215 Research Blvd", city: "Austin", postalCode: "78758" }); // Serper omits the country
    expect(splitAddress("1200 N Interstate 35, Round Rock, TX 78681, United States")).toEqual({ street: "1200 N Interstate 35", city: "Round Rock", postalCode: "78681" });
    expect(splitAddress("Kantstraße 12, 10623 Berlin, Germany")).toEqual({ street: "Kantstraße 12", city: "Berlin", postalCode: "10623" });
    expect(splitAddress("12 High St, London SW1A 1AA, United Kingdom")).toEqual({ street: "12 High St", city: "London", postalCode: "SW1A 1AA" });
    expect(splitAddress("Austin, TX")).toEqual({ street: "Austin", city: null, postalCode: null });
    expect(splitAddress(undefined)).toEqual({ street: null, city: null, postalCode: null });
  });

  it("maps a listing to a candidate with provenance, falling back to the cid when there is no place id", () => {
    const c = resultToCandidate(listing(1), { city: "Austin", region: "TX", country: "US" }, "auto repair shop", "2026-10-29T00:00:00Z")!;
    expect(c).toMatchObject({ provider: "google_maps", providerId: "ChIJ1", name: "Shop 1", category: "Auto repair shop", website: "https://shop1.example", phone: "(512) 555-0101", street: "101 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US", lat: 30.271, lng: -97.74, operatingStatus: "unknown" });
    expect(c.sourceUrl).toBe("https://www.google.com/maps/place/?q=place_id:ChIJ1");
    expect(c.matchedBy).toBe('query "auto repair shop" · Auto repair shop');
    expect(c.raw).toMatchObject({ rating: 4.5, ratingCount: 11, query: "auto repair shop" });
    const byCid = resultToCandidate(listing(2, { placeId: undefined, type: undefined, category: "Tire shop" }), { country: "US" }, "q", "t")!;
    expect(byCid.providerId).toBe("1002");
    expect(byCid.category).toBe("Tire shop");
    expect(byCid.sourceUrl).toBe("https://maps.google.com/?cid=1002");
    expect(resultToCandidate(listing(5, { description: "Permanently closed" }), { country: "US" }, "q", "t")!.operatingStatus).toBe("closed");
    // The city comes from Google's address (a radius search reaches neighbouring towns); the search city is the fallback.
    expect(resultToCandidate(listing(3, { address: "1200 N Interstate 35, Round Rock, TX 78681" }), { city: "Austin", region: "TX", country: "US" }, "q", "t")!.city).toBe("Round Rock");
    expect(resultToCandidate(listing(4, { address: undefined }), { city: "Austin", region: "TX", country: "US" }, "q", "t")!.city).toBe("Austin");
    expect(resultToCandidate({ title: "No id" }, { country: "US" }, "q", "t")).toBeNull();
  });

  it("pages until a short page, dedupes across pages, counts every fetched page as a credit, and serves a repeat from the cache for free", async () => {
    transport((body) => {
      expect(body.q).toBe("auto repair shop");
      expect(body.ll).toBe("@30.26720,-97.74310,13z");
      expect(body.gl).toBe("us");
      const p = Number(body.page ?? 1);
      if (p === 1) return json(200, page(Array.from({ length: 20 }, (_, i) => listing(i + 1))));
      if (p === 2) return json(200, page([listing(20), listing(21), listing(22)])); // overlap + short page
      throw new Error("should not page further");
    });
    const r = await googleMapsProvider.discover(query());
    expect(calls.length).toBe(2);
    expect(calls[0].url).toBe("https://google.serper.dev/maps");
    expect(calls[0].headers["X-API-KEY"]).toBe("k-test");
    expect(calls[0].body.page).toBeUndefined();
    expect(calls[1].body.page).toBe(2);
    expect(r.candidates.map((c) => c.providerId)).toHaveLength(22);
    expect(r.cached).toBe("none");
    expect(r.notes.join("\n")).toMatch(/22 listing\(s\).*2 page\(s\) fetched, 0 from the local cache/);
    expect(r.notes.join("\n")).toMatch(/Serper credits used: 2 of 2500/);
    expect(await usageTotal("serper")).toBe(2);

    const again = await googleMapsProvider.discover(query());
    expect(calls.length).toBe(2); // nothing fetched
    expect(again.candidates).toHaveLength(22);
    expect(again.cached).toBe("all");
    expect(await usageTotal("serper")).toBe(2);
  });

  it("applies the name keyword as a filter as well as a query term", async () => {
    transport(() => json(200, page([listing(1, { title: "AAMCO Transmissions" }), listing(2, { title: "Joe's Garage" })])));
    const r = await googleMapsProvider.discover(query({ keywords: "transmission" }));
    expect(calls[0].body.q).toBe("transmission auto repair shop");
    expect(r.candidates.map((c) => c.name)).toEqual(["AAMCO Transmissions"]);
    expect(r.notes[0]).toMatch(/1 without "transmission" in the name dropped/);
  });

  it("stops at SERPER_MAX_PAGES and drops listings outside the search radius", async () => {
    transport((body) => {
      const p = Number(body.page ?? 1);
      const far = p === 3 ? { latitude: 31.5, longitude: -97.74 } : {};
      return json(200, page(Array.from({ length: 20 }, (_, i) => listing((p - 1) * 20 + i + 1, far))));
    });
    const r = await googleMapsProvider.discover(query());
    expect(calls.length).toBe(3);
    expect(r.candidates).toHaveLength(40);
    expect(r.notes[0]).toMatch(/20 outside the search radius dropped/);
  });

  it("refuses to fetch once the credit budget is reached, and keeps what it has when the budget runs out mid-search", async () => {
    await recordUsage("serper", 2500);
    transport(() => json(200, page([listing(1)])));
    await expect(googleMapsProvider.discover(query())).rejects.toThrow(/credit budget reached \(2500\/2500/);
    expect(calls.length).toBe(0);

    await useTempDb();
    await recordUsage("serper", 2499);
    transport(() => json(200, page(Array.from({ length: 20 }, (_, i) => listing(i + 1)))));
    const r = await googleMapsProvider.discover(query());
    expect(calls.length).toBe(1);
    expect(r.candidates).toHaveLength(20);
    expect(r.notes.join("\n")).toMatch(/Stopped early: Serper credit budget reached \(2500\/2500/);
  });

  it("treats an empty answer as a result that still costs a credit, and surfaces key, rate-limit and other errors", async () => {
    transport(() => json(200, { ll: "@1,1,13z", places: [], credits: 1 }));
    const r = await googleMapsProvider.discover(query());
    expect(r.candidates).toEqual([]);
    expect(await usageTotal("serper")).toBe(1);

    transport(() => json(403, { message: "Unauthorized." }));
    await expect(fetchMapsPage({ q: "x", ll: "@1,1,13z", gl: "us", hl: "en", page: 1 })).rejects.toThrow(/rejected the API key/);
    transport(() => json(429, { message: "Too many requests" }));
    await expect(fetchMapsPage({ q: "y", ll: "@1,1,13z", gl: "us", hl: "en", page: 1 })).rejects.toMatchObject({ retryable: true });
    transport(() => new Response("<html>oops</html>", { status: 502 }));
    await expect(fetchMapsPage({ q: "z", ll: "@1,1,13z", gl: "us", hl: "en", page: 1 })).rejects.toBeInstanceOf(ProviderError);
    expect(await usageTotal("serper")).toBe(1); // failures are not counted
  });

  it("is unavailable without a key, and needs a category for the generic industry", async () => {
    resetEnv({ SERPER_API_KEY: undefined });
    expect(googleMapsProvider.isAvailable()).toMatchObject({ available: false });
    resetEnv({ SERPER_API_KEY: "k" });
    expect(googleMapsProvider.isAvailable()).toEqual({ available: true });
    await expect(googleMapsProvider.discover(query({ industry: "generic" }))).rejects.toThrow(/enter the category/);
  });

  it("whole-city searches use the bundled metro radius and add the city to the query, with no geocoder call", async () => {
    transport((body) => {
      expect(body.q).toBe("auto repair shop in Austin, TX");
      expect(body.ll).toMatch(/^@30\.2672\d,-97\.7431\d,\d+z$/);
      return json(200, page([listing(1)]));
    });
    const r = await googleMapsProvider.discover(query({ areaMode: "area", radiusKm: undefined, lat: null, lng: null }));
    expect(r.area).toMatch(/km around Austin \(metro radius from population\)/);
    expect(r.candidates).toHaveLength(1);
  });
});
