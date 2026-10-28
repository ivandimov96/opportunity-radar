import { describe, expect, it } from "vitest";
import { matchOsm, matchOverture, parseOsmSelector, resolveCategories, suggestIndustries } from "@/lib/discovery/taxonomy";
import { cellBBox, cellIdFor, cellsForBBox, haversineKm, unionBBox } from "@/lib/discovery/cells";

describe("category mapping", () => {
  it("resolves an industry to hierarchy nodes, primaries and exclusions verified against the Overture taxonomy", () => {
    const r = resolveCategories("auto_repair");
    expect(r.overture.hierarchy).toEqual(["automotive_repair"]);
    expect(r.overture.primary).toContain("tire_shop");
    expect(r.overture.exclude).toContain("car_wash");
    expect(r.osmSelectors).toContain('["shop"="car_repair"]');
    expect(r.osmNameRegex).toContain("mechanic");
  });
  it("narrows to sub-types, keeps exclusions only when every chosen sub-type shares them, and names name-only sub-types", () => {
    const t = resolveCategories("auto_repair", ["tires"]);
    expect(t.overture).toEqual({ hierarchy: [], primary: ["tire_shop", "tire_dealer_and_repair", "wheel_and_rim_repair"], exclude: [], nameRegex: undefined });
    expect(t.osmNameRegex).toBeNull();
    const both = resolveCategories("auto_repair", ["general_repair", "tires"]);
    expect(both.overture.exclude).not.toContain("tire_dealer_and_repair"); // tires wants it, general excludes it → kept
    expect(both.overture.exclude).toEqual([]); // the tires sub-type excludes nothing, so nothing is excluded for the pair
    expect(both.overture.hierarchy).toEqual(["automotive_repair"]);
    expect(both.overture.primary).toContain("tire_shop");
    const euro = resolveCategories("auto_repair", ["european_import"]);
    expect(euro.overture.nameRegex).toContain("bmw");
    expect(euro.overtureNameOnly).toEqual([]);
  });
  it("turns a free-text category into a taxonomy and name match for the generic industry", () => {
    const g = resolveCategories("generic", [], "Roofing Contractor!");
    expect(g.custom).toBe("roofing_contractor");
    expect(g.overture.hierarchy).toEqual(["roofing_contractor"]);
    expect(g.osmNameRegex).toBe("roofing contractor");
    expect(resolveCategories("generic").custom).toBeNull();
  });
  it("matches Overture records by primary, by hierarchy node, honours exclusions and name patterns, and reports what matched", () => {
    const spec = resolveCategories("auto_repair").overture;
    expect(matchOverture(spec, "brake_service_and_repair", ["travel_and_transportation", "vehicle_service", "automotive_service", "automotive_repair", "brake_service_and_repair"], "ABC Brakes")).toBe("category brake_service_and_repair under automotive_repair");
    expect(matchOverture(spec, "tire_shop", ["travel_and_transportation", "vehicle_service", "automotive_service", "tire_shop"], "Lamb's")).toBe("category tire_shop");
    expect(matchOverture(spec, "car_wash", ["travel_and_transportation", "vehicle_service", "automotive_service", "car_wash"], "Sparkle")).toBeNull();
    expect(matchOverture(spec, "bakery", ["food_and_drink", "bakery"], "Bread")).toBeNull();
    const euro = resolveCategories("auto_repair", ["european_import"]).overture;
    expect(matchOverture(euro, "automotive_repair", ["travel_and_transportation", "vehicle_service", "automotive_service", "automotive_repair"], "Euro Motorwerks")).toBe("category automotive_repair + name");
    expect(matchOverture(euro, "automotive_repair", ["travel_and_transportation", "vehicle_service", "automotive_service", "automotive_repair"], "Joe's Garage")).toBeNull();
  });
  it("parses Overpass selectors and re-matches stored OSM tags locally", () => {
    const p = parseOsmSelector('["shop"="car_repair"]["name"~"body|collision",i]');
    expect(p.conds).toHaveLength(2);
    expect(p.conds[0]).toEqual({ key: "shop", value: "car_repair" });
    expect(matchOsm(['["shop"="car_repair"]'], { shop: "car_repair", name: "Joe's" })).toBe('tags ["shop"="car_repair"]');
    expect(matchOsm(['["shop"="car_repair"]["name"~"body|collision",i]'], { shop: "car_repair", name: "ACE Collision" })).toContain("tags");
    expect(matchOsm(['["shop"="car_repair"]["name"~"body|collision",i]'], { shop: "car_repair", name: "Joe's" })).toBeNull();
    expect(matchOsm(['["craft"]["name"~"garage door",i]'], { craft: "yes", name: "Austin Garage Door Co" })).toContain("tags");
    expect(matchOsm(['["shop"="tyres"]'], { shop: "car_repair", name: "Mike's Auto Repair" }, "auto repair|mechanic")).toBe("name pattern");
    expect(matchOsm(['["shop"="tyres"]'], { amenity: "cafe", name: "Auto Repair Cafe" }, "auto repair")).toBeNull(); // name net needs shop/craft/office
  });
  it("suggests industries from everyday words, including other languages", () => {
    expect(suggestIndustries("mechanic").map((s) => s.key)).toEqual(["auto_repair"]);
    expect(suggestIndustries("Zahnarzt").map((s) => s.key)).toEqual(["dental"]);
    expect(suggestIndustries("roofer").map((s) => s.key)).toEqual(["home_services"]);
    expect(suggestIndustries("xy")).toEqual([]);
  });
});

describe("grid cells", () => {
  it("assigns stable cell ids, covers a bbox, and unions cells back to a bbox", () => {
    expect(cellIdFor(30.27, -97.74)).toBe("151:-489");
    expect(cellBBox("151:-489")).toEqual({ south: 30.2, north: 30.4, west: -97.8, east: -97.6 });
    const cells = cellsForBBox({ south: 30.21, west: -97.79, north: 30.39, east: -97.61 });
    expect(cells).toEqual(["151:-489"]);
    const many = cellsForBBox({ south: 30.1, west: -97.9, north: 30.5, east: -97.5 });
    expect(many).toHaveLength(9);
    expect(unionBBox(many)).toEqual({ south: 30, north: 30.6, west: -98, east: -97.4 });
    expect(haversineKm(30.2672, -97.7431, 30.5083, -97.6789)).toBeCloseTo(27.5, 0);
  });
});
