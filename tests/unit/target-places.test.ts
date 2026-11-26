import { describe, expect, it } from "vitest";
import { citiesFor, pickNextSearch } from "@/lib/discovery/auto-search";
import type { Place } from "@/lib/geo/world";
import { DEFAULT_SETTINGS, parseTargetPlaces, searchTargetsOf } from "@/lib/settings";

const place = (name: string, lat: number, lon: number, population: number, region = "ENG", country = "GB"): Place => ({ name, asciiName: name, country, region, population, lat, lon });
// Leeds, with Bradford 13 km away, Wakefield 14 km, Harrogate 21 km, a village too small to search, and Manchester 58 km.
const PLACES = [place("Manchester", 53.48, -2.24, 550_000), place("Leeds", 53.8, -1.55, 500_000), place("Bradford", 53.79, -1.75, 350_000), place("Wakefield", 53.68, -1.5, 100_000), place("Harrogate", 53.99, -1.54, 75_000), place("Hamlet", 53.81, -1.56, 4_000), place("Lyon", 45.76, 4.84, 500_000, "ARA", "FR")];

describe("where a seller sells", () => {
  it("reads a country, a region, and a town with its distance; a town without a distance gets the usual one", () => {
    expect(parseTargetPlaces("GB\nGB | ENG\nGB | ENG | Leeds | 50\ngb |  | York\nGB | ENG | leeds | 10\nXX1 | bad")).toEqual([
      { country: "GB", region: "" },
      { country: "GB", region: "ENG" },
      { country: "GB", region: "ENG", city: "Leeds", radiusKm: 50 },
      { country: "GB", region: "", city: "York", radiusKm: 25 },
    ]);
    expect(parseTargetPlaces([{ country: "GB", region: "ENG", city: "Leeds", radiusKm: 9999 }])).toEqual([{ country: "GB", region: "ENG", city: "Leeds", radiusKm: 200 }]);
  });

  it("makes one search target per kind and place, carrying the town along", () => {
    const targets = searchTargetsOf({ ...DEFAULT_SETTINGS, targetKinds: ["gyms"], targetPlaces: [{ country: "GB", region: "ENG", city: "Leeds", radiusKm: 25 }, { country: "FR", region: "" }], searchTargets: [] });
    expect(targets).toEqual([
      { what: "gyms", country: "GB", region: "ENG", city: "Leeds", radiusKm: 25 },
      { what: "gyms", country: "FR", region: "" },
    ]);
  });

  it("around a town: that town first, then the places within the distance, nearest first; never beyond it or abroad", () => {
    const near = citiesFor({ what: "gyms", country: "GB", region: "ENG", city: "Leeds", radiusKm: 25 }, PLACES).map((p) => p.name);
    expect(near).toEqual(["Leeds", "Bradford", "Wakefield", "Harrogate"]);
    expect(citiesFor({ what: "gyms", country: "GB", region: "", city: "leeds", radiusKm: 100 }, PLACES).map((p) => p.name)).toContain("Manchester");
    // A whole region or country keeps working through its cities, largest first.
    expect(citiesFor({ what: "gyms", country: "GB", region: "ENG" }, PLACES).map((p) => p.name)).toEqual(["Manchester", "Leeds", "Bradford", "Wakefield"]);
    // A town the list does not know falls back to the region, so searching never stops silently.
    expect(citiesFor({ what: "gyms", country: "GB", region: "ENG", city: "Nowhere", radiusKm: 25 }, PLACES)[0].name).toBe("Manchester");
  });

  it("starts in the seller's own town and moves outward as towns are done", () => {
    const target = { what: "gyms", country: "GB", region: "ENG", city: "Leeds", radiusKm: 25 };
    expect(pickNextSearch([target], [], PLACES)?.place.name).toBe("Leeds");
    expect(pickNextSearch([target], [{ what: "gyms", country: "GB", city: "Leeds" }], PLACES)?.place.name).toBe("Bradford");
    const all = ["Leeds", "Bradford", "Wakefield", "Harrogate"].map((city) => ({ what: "gyms", country: "GB", city }));
    expect(pickNextSearch([target], all, PLACES)).toBeNull();
  });
});
