import { beforeEach, describe, expect, it } from "vitest";
import { assertReasonableBbox, bboxAround, buildOvertureSql, cacheKey, fetchPlaces, rowToCandidate, type OvertureRow } from "@/lib/discovery/overture";
import { useTempDb, resetEnv } from "../helpers";

const row: OvertureRow = { id: "08f1", name: "Colvin Automotive", category: "automotive_repair", operating_status: "open", confidence: 0.91, website: "https://colvinautomotive.com", phone: "+15124532345", email: null, socials: ["https://facebook.com/colvin"], brand: null, street: "2715 Hancock Dr", city: "Austin", region: "TX", postcode: "78731", country: "US", lon: -97.74, lat: 30.33 };

describe("Overture provider", () => {
  beforeEach(async () => {
    resetEnv({});
    await useTempDb();
  });
  it("builds a bbox around a center that shrinks longitude with latitude", () => {
    const b = bboxAround(39.74, -104.98, 8);
    expect(b.north - b.south).toBeCloseTo(0.144, 3);
    expect(b.east - b.west).toBeGreaterThan(0.18); // wider in degrees than latitude at 40°N
  });
  it("refuses state-sized areas", () => {
    expect(() => assertReasonableBbox({ south: 43.5, north: 49.4, west: -97.2, east: -89.5 }, "Minnesota")).toThrow(/too large/);
    expect(() => assertReasonableBbox(bboxAround(30.27, -97.74, 15), "Austin")).not.toThrow();
  });
  it("builds a bounded SQL query with escaped categories and the release path", () => {
    const sql = buildOvertureSql({ south: 1, west: 2, north: 3, east: 4 }, ["automotive_repair", "it's"], "2026-10-21.0");
    expect(sql).toContain("release/2026-10-21.0/theme=places/type=place/*");
    expect(sql).toContain("bbox.xmin BETWEEN 2 AND 4");
    expect(sql).toContain("taxonomy.primary IN ('automotive_repair', 'it''s')");
    expect(sql).toContain("LIMIT 5000");
  });
  it("maps rows to candidates with provenance, status, brand and socials", () => {
    const c = rowToCandidate(row, { country: "US" })!;
    expect(c).toMatchObject({ provider: "overture", providerId: "08f1", name: "Colvin Automotive", website: "https://colvinautomotive.com", phone: "+15124532345", city: "Austin", region: "TX", postalCode: "78731", lat: 30.33, lng: -97.74, operatingStatus: "open", brand: null });
    expect(c.socials).toEqual(["https://facebook.com/colvin"]);
    expect(rowToCandidate({ ...row, name: null }, { country: "US" })).toBeNull();
    expect(rowToCandidate({ ...row, city: null, operating_status: null }, { city: "Austin", country: "US" })).toMatchObject({ city: "Austin", operatingStatus: "unknown" });
  });
  it("caches S3 results per release, area and category set", async () => {
    let calls = 0;
    const query = async () => {
      calls++;
      return [row];
    };
    const bbox = { south: 30.2, west: -97.9, north: 30.4, east: -97.6 };
    const a = await fetchPlaces(bbox, ["automotive_repair"], { query, release: "r1", cacheDays: 30 });
    const b = await fetchPlaces(bbox, ["automotive_repair"], { query, release: "r1", cacheDays: 30 });
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(b.rows[0].name).toBe("Colvin Automotive");
    expect(calls).toBe(1);
    await fetchPlaces(bbox, ["tire_shop"], { query, release: "r1", cacheDays: 30 });
    expect(calls).toBe(2);
    expect(cacheKey("r1", bbox, ["b", "a"])).toBe("overture|r1|30.200,-97.900,30.400,-97.600|a,b");
  });
});
