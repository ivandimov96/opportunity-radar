import { describe, expect, it } from "vitest";
import { findPlace, searchPlaces } from "@/lib/geo/places";

const sample = [
  { name: "Austin", state: "TX", population: 974447, lat: 30.2672, lon: -97.7431 },
  { name: "Austin", state: "MN", population: 24563, lat: 43.6666, lon: -92.9746 },
  { name: "Round Rock", state: "TX", population: 119468, lat: 30.5083, lon: -97.6789 },
  { name: "Port Arthur", state: "TX", population: 55000, lat: 29.885, lon: -93.94 },
  { name: "Round Lake", state: "IL", population: 18000, lat: 42.35, lon: -88.09 },
];

describe("places typeahead", () => {
  it("filters by state and ranks prefix matches by population, then word matches", () => {
    expect(searchPlaces("TX", "au", 5, sample).map((p) => p.name)).toEqual(["Austin"]);
    expect(searchPlaces("TX", "ro", 5, sample).map((p) => p.name)).toEqual(["Round Rock"]);
    expect(searchPlaces("TX", "rock", 5, sample).map((p) => p.name)).toEqual(["Round Rock"]); // word match
    expect(searchPlaces(null, "austin", 5, sample).map((p) => p.state)).toEqual(["TX", "MN"]);
    expect(searchPlaces("TX", "", 2, sample).map((p) => p.name)).toEqual(["Austin", "Round Rock"]);
  });
  it("finds an exact place for a radius center and loads the bundled file", () => {
    expect(findPlace("mn", "austin", sample)?.lat).toBe(43.6666);
    expect(findPlace("TX", "Nowhere", sample)).toBeNull();
    const real = searchPlaces("TX", "Austin", 3);
    expect(real[0]).toMatchObject({ name: "Austin", state: "TX" });
    expect(real[0].population).toBeGreaterThan(900_000);
  });
});
