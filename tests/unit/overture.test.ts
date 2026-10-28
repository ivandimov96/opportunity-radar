import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { _setStacFetch, buildOvertureSql, ensureOvertureCells, resolveRelease, rowToCandidate, searchLocalOverture, type OvertureRow } from "@/lib/discovery/overture";
import { assertReasonableBbox } from "@/lib/discovery/area";
import { bboxAround, cellsForBBox } from "@/lib/discovery/cells";
import { sourceCells, sourcePlaces } from "@/db/schema";
import { useTempDb, resetEnv } from "../helpers";

const row: OvertureRow = { id: "08f1", name: "Colvin Automotive", category: "automotive_repair", hierarchy: ["travel_and_transportation", "vehicle_service", "automotive_service", "automotive_repair"], operating_status: "open", confidence: 0.91, website: "https://colvinautomotive.com", phone: "+15124532345", email: null, socials: ["https://facebook.com/colvin"], brand: null, street: "2715 Hancock Dr", city: "Austin", region: "TX", postcode: "78731", country: "US", lon: -97.74, lat: 30.33, source_dataset: "meta", source_updated: "2026-09-01" };
const wash: OvertureRow = { ...row, id: "08f2", name: "Sparkle Car Wash", category: "car_wash", hierarchy: ["travel_and_transportation", "vehicle_service", "automotive_service", "car_wash"], website: null, phone: null, lon: -97.75, lat: 30.34 };
const tires: OvertureRow = { ...row, id: "08f3", name: "Lamb's Tire", category: "tire_shop", hierarchy: ["travel_and_transportation", "vehicle_service", "automotive_service", "tire_shop"], lon: -97.73, lat: 30.32 };
const SPEC_ALL = { hierarchy: ["automotive_repair"], primary: ["automotive_service", "tire_shop"], exclude: ["car_wash"] };

describe("Overture provider", () => {
  beforeEach(async () => {
    resetEnv({ OVERTURE_RELEASE: "2026-10-21.0" });
    await useTempDb();
  });
  it("builds a bbox around a center that shrinks longitude with latitude", () => {
    const b = bboxAround(39.74, -104.98, 8);
    expect(b.north - b.south).toBeCloseTo(0.144, 3);
    expect(b.east - b.west).toBeGreaterThan(0.18);
  });
  it("refuses state-sized areas", () => {
    expect(() => assertReasonableBbox({ south: 43.5, north: 49.4, west: -97.2, east: -89.5 }, "Minnesota")).toThrow(/too large/);
    expect(() => assertReasonableBbox(bboxAround(30.27, -97.74, 15), "Austin")).not.toThrow();
  });
  it("builds a bounded SQL query from hierarchy nodes, primaries and exclusions, escaped, on the release path", () => {
    const sql = buildOvertureSql({ south: 1, west: 2, north: 3, east: 4 }, { hierarchy: ["automotive_repair"], primary: ["tire_shop", "it's"], exclude: ["car_wash"] }, "2026-10-21.0");
    expect(sql).toContain("release/2026-10-21.0/theme=places/type=place/*");
    expect(sql).toContain("bbox.xmin BETWEEN 2 AND 4");
    expect(sql).toContain("list_has_any(taxonomy.hierarchy, ['automotive_repair'])");
    expect(sql).toContain("taxonomy.primary IN ('tire_shop', 'it''s')");
    expect(sql).toContain("taxonomy.primary NOT IN ('car_wash')");
    expect(sql).toContain("taxonomy.hierarchy AS hierarchy");
  });
  it("resolves the latest release from the STAC catalog, caches it, and pins when configured", async () => {
    resetEnv({ OVERTURE_RELEASE: "auto" });
    let calls = 0;
    _setStacFetch((async () => {
      calls++;
      return new Response(JSON.stringify({ latest: "2026-11-19.0" }), { status: 200 });
    }) as typeof fetch);
    expect(await resolveRelease()).toEqual({ release: "2026-11-19.0", source: "stac" });
    expect(await resolveRelease()).toEqual({ release: "2026-11-19.0", source: "stac" });
    expect(calls).toBe(1);
    _setStacFetch((async () => new Response("down", { status: 503 })) as typeof fetch);
    expect((await resolveRelease()).source).toBe("fallback");
    resetEnv({ OVERTURE_RELEASE: "2026-10-21.0" });
    expect(await resolveRelease()).toEqual({ release: "2026-10-21.0", source: "pinned" });
    _setStacFetch(null);
  });
  it("fetches missing cells once, stores rows per cell, and serves repeats and sub-type narrowing locally", async () => {
    let calls = 0;
    const query = async () => {
      calls++;
      return [row, wash, tires];
    };
    const bbox = bboxAround(30.33, -97.74, 6);
    const first = await ensureOvertureCells("auto_repair", bbox, SPEC_ALL, { query, release: "r1", cacheDays: 30 });
    expect(first.cached).toBe("none");
    expect(first.fetched).toBe(3);
    expect(first.cells).toEqual(cellsForBBox(bbox));
    const second = await ensureOvertureCells("auto_repair", bbox, SPEC_ALL, { query, release: "r1", cacheDays: 30 });
    expect(second.cached).toBe("all");
    expect(calls).toBe(1);
    // Overlapping area: only the new cells are read.
    const wider = bboxAround(30.33, -97.74, 14);
    const third = await ensureOvertureCells("auto_repair", wider, SPEC_ALL, { query, release: "r1", cacheDays: 30 });
    expect(third.cached).toBe("some");
    expect(third.missing.length).toBeGreaterThan(0);
    expect(third.missing.length).toBeLessThan(third.cells.length);
    // A new release invalidates the cells.
    await ensureOvertureCells("auto_repair", bbox, SPEC_ALL, { query, release: "r2", cacheDays: 30 });
    expect(calls).toBe(3);
    const db = (await import("@/db/client")).getDb;
    const d = await db();
    expect((await d.select().from(sourcePlaces).where(eq(sourcePlaces.provider, "overture")).all()).map((r) => r.providerId).sort()).toEqual(["08f1", "08f2", "08f3"]);
    expect((await d.select().from(sourceCells).all()).every((c) => c.provider === "overture" && c.scope === "auto_repair")).toBe(true);
    // Local search: exclusions and sub-types apply without another fetch; radius narrows.
    const all = await searchLocalOverture(second.cells, bbox, SPEC_ALL, {});
    expect(all.map((h) => h.row.name).sort()).toEqual(["Colvin Automotive", "Lamb's Tire"]);
    expect(all.find((h) => h.row.name === "Colvin Automotive")?.matchedBy).toBe("category automotive_repair");
    const tiresOnly = await searchLocalOverture(second.cells, bbox, { hierarchy: [], primary: ["tire_shop"], exclude: [] }, {});
    expect(tiresOnly.map((h) => h.row.name)).toEqual(["Lamb's Tire"]);
    const near = await searchLocalOverture(second.cells, bbox, SPEC_ALL, { center: { lat: 30.33, lon: -97.74 }, radiusKm: 0.5 });
    expect(near.map((h) => h.row.name)).toEqual(["Colvin Automotive"]);
    expect(calls).toBe(3);
  });
  it("maps stored rows to candidates with provenance, status, brand, socials and the mapping that matched", async () => {
    const query = async () => [row];
    const bbox = bboxAround(30.33, -97.74, 3);
    const f = await ensureOvertureCells("auto_repair", bbox, SPEC_ALL, { query, release: "r1", cacheDays: 30 });
    const hit = (await searchLocalOverture(f.cells, bbox, SPEC_ALL, {}))[0];
    const c = rowToCandidate(hit.row, hit.matchedBy, { country: "US" });
    expect(c).toMatchObject({ provider: "overture", providerId: "08f1", name: "Colvin Automotive", website: "https://colvinautomotive.com", phone: "5124532345", city: "Austin", region: "TX", postalCode: "78731", lat: 30.33, lng: -97.74, operatingStatus: "open", brand: null, matchedBy: "category automotive_repair" });
    expect(c.socials).toEqual(["https://facebook.com/colvin"]);
    expect(c.fetchedAt).toBeTruthy();
    expect((c.raw as { release: string }).release).toBe("r1");
  });
});
