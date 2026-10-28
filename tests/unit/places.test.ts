import { describe, expect, it } from "vitest";
import { countryName, defaultRadiusKm, findPlace, listCountries, listRegions, regionName, searchPlaces, type Place } from "@/lib/geo/world";

// Sorted by population, as the bundled files are.
const sample: Place[] = [
  { name: "São Paulo", asciiName: "Sao Paulo", country: "BR", region: "27", population: 12000000, lat: -23.55, lon: -46.63 },
  { name: "Austin", asciiName: "Austin", country: "US", region: "TX", population: 974447, lat: 30.2672, lon: -97.7431 },
  { name: "Zürich", asciiName: "Zurich", country: "CH", region: "ZH", population: 400000, lat: 47.37, lon: 8.54 },
  { name: "Round Rock", asciiName: "Round Rock", country: "US", region: "TX", population: 119468, lat: 30.5083, lon: -97.6789 },
  { name: "Austin", asciiName: "Austin", country: "US", region: "MN", population: 24563, lat: 43.6666, lon: -92.9746 },
];

describe("worldwide places", () => {
  it("filters by country and region and ranks prefix matches by population, then word matches", () => {
    expect(searchPlaces("US", "TX", "au", 5, sample).map((p) => p.name)).toEqual(["Austin"]);
    expect(searchPlaces("US", "TX", "rock", 5, sample).map((p) => p.name)).toEqual(["Round Rock"]); // word match
    expect(searchPlaces("US", null, "austin", 5, sample).map((p) => p.region)).toEqual(["TX", "MN"]);
    expect(searchPlaces(null, null, "", 2, sample).map((p) => p.name)).toEqual(["São Paulo", "Austin"]);
  });
  it("matches diacritics-insensitively in both directions", () => {
    expect(searchPlaces("BR", null, "sao", 5, sample).map((p) => p.name)).toEqual(["São Paulo"]);
    expect(searchPlaces("CH", null, "zür", 5, sample).map((p) => p.name)).toEqual(["Zürich"]);
    expect(findPlace("CH", null, "zurich", sample)?.lat).toBe(47.37);
  });
  it("finds an exact place for a radius center and loads the bundled files", () => {
    expect(findPlace("us", "mn", "austin", sample)?.lat).toBe(43.6666);
    expect(findPlace("US", "TX", "Nowhere", sample)).toBeNull();
    const real = searchPlaces("US", "TX", "Austin", 3);
    expect(real[0]).toMatchObject({ name: "Austin", country: "US", region: "TX" });
    expect(real[0].population).toBeGreaterThan(900_000);
    expect(searchPlaces("DE", null, "Berl", 3)[0]).toMatchObject({ name: "Berlin", country: "DE" });
    expect(listCountries().length).toBeGreaterThan(200);
    expect(countryName("DE")).toBe("Germany");
    expect(listRegions("US").some((r) => r.code === "TX" && r.name === "Texas")).toBe(true);
    expect(regionName("DE", "02")).toBe("Bavaria");
    expect(defaultRadiusKm(12_000_000)).toBe(30);
    expect(defaultRadiusKm(30_000)).toBe(6);
  });
});
