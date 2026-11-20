import { describe, expect, it } from "vitest";
import { describeFilters, extraCityRuns, moreCitiesOf, parseSearchForm, DEFAULT_FILTERS } from "@/lib/search-input";
import { getPlaybook, selectorsFor } from "@/lib/industries";

const form = (entries: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

describe("search input", () => {
  it("applies defaults and builds a name from type, sub-types and place", () => {
    const r = parseSearchForm(form({ industry: "auto_repair", city: "Austin", region: "TX", providers: "google_maps", segments: ["body_collision", "tires"] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("Automotive repair (Body & collision, Tire shops) · Austin, TX");
    expect(r.filters).toEqual({ ...DEFAULT_FILTERS, segments: ["body_collision", "tires"], autoInvestigateLimit: null, centerLat: null, centerLon: null }); // field absent/empty = investigate all
    expect(r.values.requireWebsite).toBe(false);
    expect(r.values.maxResults).toBe(25);
  });
  it("reports field-level errors and keeps the submitted values", () => {
    const r = parseSearchForm(form({ industry: "auto_repair", providers: "google_maps", maxResults: "0", country: "USA", areaMode: "radius", radiusKm: "500", segments: "nope" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.city).toMatch(/city/i);
    expect(r.errors.maxResults).toBe("At least 1");
    expect(r.errors.country).toMatch(/2-letter/);
    expect(r.errors.radiusKm).toMatch(/100 km/);
    expect(r.errors.segments).toMatch(/Unknown segment/);
    expect(r.raw.maxResults).toBe("0");
  });
  it("requires a category for the generic industry and refuses unknown, disabled or removed sources on the form", () => {
    const bad = parseSearchForm(form({ industry: "generic", city: "Austin", region: "TX", providers: "google_maps" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.customCategory).toMatch(/Enter the business category/);
    // Overture and OpenStreetMap are disabled; the demo provider and the Texas registry are gone.
    for (const p of ["demo", "overture", "osm", "tx_permits"]) expect(parseSearchForm(form({ industry: "auto_repair", city: "Austin", region: "TX", providers: p })).ok).toBe(false);
    expect(parseSearchForm(form({ industry: "auto_repair", providers: [] })).ok).toBe(false);
  });
  it("describes filters for lists", () => {
    const d = describeFilters({ industry: "auto_repair", requireWebsite: true, autoInvestigate: true, keywords: "euro", filters: { ...DEFAULT_FILTERS, segments: ["tires"], areaMode: "radius", radiusKm: 10, requirePhone: true } });
    expect(d).toEqual(["Tire shops", "10 km radius", 'name contains "euro"', "website required", "phone required", "chains excluded", "auto-investigate top 25 (lead ≥ 50)"]);
  });
});

describe("segments → selectors → Overpass", () => {
  it("maps segments to selectors and falls back to the playbook defaults", () => {
    const pb = getPlaybook("auto_repair");
    expect(selectorsFor(pb, ["tires"]).osmSelectors).toEqual(['["shop"="tyres"]']);
    expect(selectorsFor(pb, []).osmSelectors.length).toBeGreaterThan(3);
    expect(selectorsFor(getPlaybook("generic"), []).osmSelectors).toEqual([]);
    expect(selectorsFor(pb, ["hvac", "tires"]).googleQueries).toEqual(["tire shop"]);
  });
  it("reads review limits and describes them", () => {
    const r = parseSearchForm(form({ industry: "generic", customCategory: "sign makers", country: "GB", city: "Leeds", providers: "google_maps", minReviews: "20", minRating: "4.5" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters).toMatchObject({ minReviews: 20, minRating: 4.5 });
    expect(describeFilters({ filters: r.filters, requireWebsite: false, autoInvestigate: false, industry: "generic" })).toEqual(expect.arrayContaining(["at least 20 reviews", "rated 4.5 or more"]));
    const bad = parseSearchForm(form({ industry: "generic", customCategory: "sign makers", country: "GB", city: "Leeds", providers: "google_maps", minRating: "7" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.minRating).toBe("Between 0 and 5");
  });
  it("turns the extra cities of a form into searches of their own, each with its own name and centre", () => {
    const more = JSON.stringify([
      { name: "Bradford", region: "ENG", lat: 53.79, lon: -1.75 },
      { name: "Leeds", region: "ENG", lat: 53.8, lon: -1.55 }, // the main city again: not searched twice
      { name: "bradford", region: "ENG", lat: 1, lon: 1 }, // the same city twice
      { name: "Nowhere", lat: "x", lon: 2 }, // no usable coordinates
      { name: "Glasgow", region: "SCT", lat: 55.86, lon: -4.25 },
    ]);
    const fd = form({ industry: "generic", customCategory: "sign makers", country: "GB", region: "ENG", city: "Leeds", centerLat: "53.8", centerLon: "-1.55", providers: "google_maps", maxResults: "20", name: "My Leeds search", moreCities: more });
    expect(moreCitiesOf(fd).map((c) => c.name)).toEqual(["Bradford", "Leeds", "Glasgow"]);
    const runs = extraCityRuns(fd, "Leeds");
    expect(runs.map((r) => r.name)).toEqual(["sign makers · Bradford, ENG", "sign makers · Glasgow, SCT"]);
    expect(runs.map((r) => [r.values.city, r.values.region, r.filters.centerLat, r.filters.centerLon, r.values.maxResults])).toEqual([["Bradford", "ENG", 53.79, -1.75, 20], ["Glasgow", "SCT", 55.86, -4.25, 20]]);
    expect(extraCityRuns(form({ industry: "generic", customCategory: "x", country: "GB", city: "Leeds", providers: "google_maps", moreCities: "not json" }), "Leeds")).toEqual([]);
    const many = JSON.stringify(Array.from({ length: 15 }, (_, i) => ({ name: `City ${i}`, lat: 50 + i / 10, lon: -1 })));
    expect(moreCitiesOf(form({ moreCities: many }))).toHaveLength(9);
  });
});
