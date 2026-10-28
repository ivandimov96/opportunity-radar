import { describe, expect, it } from "vitest";
import { describeFilters, parseSearchForm, DEFAULT_FILTERS } from "@/lib/search-input";
import { buildOverpassQuery } from "@/lib/discovery/osm";
import { getPlaybook, selectorsFor } from "@/lib/industries";

const form = (entries: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

describe("search input", () => {
  it("applies defaults and builds a name from type, sub-types and place", () => {
    const r = parseSearchForm(form({ industry: "auto_repair", city: "Austin", region: "TX", providers: "osm", segments: ["body_collision", "tires"] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("Automotive repair (Body & collision, Tire shops) · Austin, TX");
    expect(r.filters).toEqual({ ...DEFAULT_FILTERS, segments: ["body_collision", "tires"], autoInvestigateLimit: null, centerLat: null, centerLon: null }); // field absent/empty = investigate all
    expect(r.values.requireWebsite).toBe(false);
    expect(r.values.maxResults).toBe(25);
  });
  it("reports field-level errors and keeps the submitted values", () => {
    const r = parseSearchForm(form({ industry: "auto_repair", providers: "osm", maxResults: "0", country: "USA", areaMode: "radius", radiusKm: "500", segments: "nope" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.city).toMatch(/city/i);
    expect(r.errors.maxResults).toBe("At least 1");
    expect(r.errors.country).toMatch(/2-letter/);
    expect(r.errors.radiusKm).toMatch(/100 km/);
    expect(r.errors.segments).toMatch(/Unknown segment/);
    expect(r.raw.maxResults).toBe("0");
  });
  it("rejects OSM for industries without selectors and allows demo-only searches without a place", () => {
    const bad = parseSearchForm(form({ industry: "generic", city: "Austin", providers: "osm" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.providers).toMatch(/no OpenStreetMap selectors/);
    const demo = parseSearchForm(form({ industry: "auto_repair", providers: "demo" }));
    expect(demo.ok).toBe(true);
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
  it("adds a name-pattern net for mis-tagged map entries", () => {
    const q = buildOverpassQuery(['["shop"="car_repair"]'], { south: 1, west: 2, north: 3, east: 4 }, null, "auto repair|mechanic");
    expect(q).toContain('nwr["name"~"auto repair|mechanic",i]["shop"]["shop"!~"^(car|car_parts|fuel)$"](1,2,3,4);');
    expect(q).toContain('nwr["name"~"auto repair|mechanic",i]["craft"](1,2,3,4);');
  });
  it("builds bbox and radius queries", () => {
    expect(buildOverpassQuery(['["shop"="tyres"]'], { south: 1, west: 2, north: 3, east: 4 })).toContain('nwr["shop"="tyres"]["name"](1,2,3,4);');
    expect(buildOverpassQuery(['["shop"="tyres"]'], { aroundLat: 30.27, aroundLon: -97.74, radiusM: 15000 }, "lube")).toContain('nwr["shop"="tyres"]["name"]["name"~"lube",i](around:15000,30.27,-97.74);');
  });
});
