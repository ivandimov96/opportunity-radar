import { describe, expect, it } from "vitest";
import { distanceChoices, distanceText, distanceUnit, kmToShown, nearestChoiceKm, shownToKm, usesMiles } from "@/lib/distance";
import { describeFilters, DEFAULT_FILTERS } from "@/lib/search-input";

describe("distances in the country's own unit", () => {
  it("counts in miles where the country does, in kilometres everywhere else and when the country is unknown", () => {
    expect(["US", "gb", "LR", "MM"].every((c) => usesMiles(c))).toBe(true);
    expect(["DE", "FR", "MK", "AU", "CA", "", null, undefined].some((c) => usesMiles(c))).toBe(false);
    expect([distanceUnit("US"), distanceUnit("DE")]).toEqual(["miles", "km"]);
  });

  it("shows and reads whole numbers, and keeps kilometres underneath", () => {
    expect(distanceText(25, "DE")).toBe("25 km");
    expect(distanceText(24, "US")).toBe("15 miles");
    expect(distanceText(2, "GB")).toBe("1 mile");
    expect(kmToShown(100, "US")).toBe(62);
    expect(shownToKm(15, "US")).toBe(24);
    expect(shownToKm(15, "FR")).toBe(15);
  });

  it("offers round distances in each unit, and moves a saved distance to its nearest neighbour when the unit changes", () => {
    expect(distanceChoices("FR").map((c) => c.label)).toEqual(["10 km", "25 km", "50 km", "100 km"]);
    expect(distanceChoices("US").map((c) => c.label)).toEqual(["5 miles", "15 miles", "30 miles", "60 miles"]);
    expect(distanceChoices("US").map((c) => c.km)).toEqual([8, 24, 48, 97]);
    expect(nearestChoiceKm(25, "US")).toBe(24);
    expect(nearestChoiceKm(24, "FR")).toBe(25);
    expect(nearestChoiceKm(400, "FR")).toBe(100);
  });

  it("a search's summary says its radius in the unit of the country it ran in", () => {
    const search = { filters: { ...DEFAULT_FILTERS, areaMode: "radius" as const, radiusKm: 24 }, requireWebsite: false, autoInvestigate: false, keywords: null, industry: "generic" };
    expect(describeFilters({ ...search, country: "US" })).toContain("15 miles radius");
    expect(describeFilters({ ...search, country: "DE" })).toContain("24 km radius");
    expect(describeFilters(search)).toContain("24 km radius");
  });
});
