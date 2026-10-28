/**
 * The search engine against fake providers: merge rules with confidence,
 * uncertain matches kept separate, filters with skip counts, future providers
 * refused, partial failure, cached state, persistence of candidates, saving
 * (automatic and on request) and the "already saved" match.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { businesses, businessSources, searchCandidates, searchResults, searches } from "@/db/schema";
import { mergeCandidates, runDiscovery, saveCandidates } from "@/lib/discovery/engine";
import type { BusinessCandidate, DiscoveryProvider, ProviderResult } from "@/lib/discovery/types";
import { ProviderError } from "@/lib/discovery/types";
import { newId } from "@/lib/ids";
import { useTempDb, resetEnv } from "../helpers";

const ov = (over: Partial<BusinessCandidate>): BusinessCandidate => ({ provider: "overture", providerId: newId(), name: "X", attribution: "Overture", lat: 30.27, lng: -97.74, ...over });
const osm = (over: Partial<BusinessCandidate>): BusinessCandidate => ({ provider: "osm", providerId: newId(), name: "X", attribution: "OSM", sourceUrl: "https://osm.org/node/1", lat: 30.27, lng: -97.74, ...over });

describe("merge rules", () => {
  it("merges the same business across sources by domain, phone or name + proximity, keeping every source and the strongest fields", () => {
    const m = mergeCandidates([
      ov({ providerId: "a", name: "Colvin Automotive", website: "https://colvinautomotive.com", phone: null, category: "automotive_repair", matchedBy: "category automotive_repair" }),
      osm({ providerId: "n1", name: "Colvin Auto", website: "https://www.colvinautomotive.com/", phone: "512-453-2345", matchedBy: "tags shop=car_repair" }),
      ov({ providerId: "b", name: "Lamb's Tire", phone: "+1 512 555 0100" }),
      osm({ providerId: "n2", name: "Lambs Tire & Auto", phone: "(512) 555-0100", lat: 30.2705, lng: -97.741 }),
      ov({ providerId: "c", name: "Joe's Garage", lat: 30.3, lng: -97.7 }),
      osm({ providerId: "n3", name: "Joe's Garage", lat: 30.3001, lng: -97.7001 }),
    ]);
    expect(m).toHaveLength(3);
    const colvin = m.find((x) => x.name === "Colvin Automotive")!;
    expect(colvin.sources.map((s) => s.provider)).toEqual(["overture", "osm"]);
    expect(colvin.phone).toBe("5124532345"); // filled from the second source
    expect(colvin.mergeRule).toBe("domain");
    expect(colvin.mergeConfidence).toBe(0.95);
    expect(colvin.matchedBy).toEqual(["category automotive_repair", "tags shop=car_repair"]);
    expect(m.find((x) => x.name === "Lamb's Tire")!.mergeRule).toBe("phone");
    expect(m.find((x) => x.name === "Joe's Garage")!.mergeRule).toBe("name_proximity");
  });
  it("keeps distinct branches and uncertain matches separate", () => {
    const m = mergeCandidates([
      ov({ providerId: "a", name: "Firestone Complete Auto Care", website: "https://firestone.com/x", lat: 30.2, lng: -97.7 }),
      ov({ providerId: "b", name: "Firestone Complete Auto Care", website: "https://firestone.com/y", lat: 30.4, lng: -97.9 }), // same domain, 25 km apart
      osm({ providerId: "n1", name: "Firestone Auto Care Center", lat: 30.2001, lng: -97.7001 }), // similar name, 10 m from the first, no domain/phone
    ]);
    expect(m).toHaveLength(3);
    const uncertain = m.find((x) => x.sources[0].providerId === "n1")!;
    expect(uncertain.possibleDuplicateOf).toBe(0);
    expect(uncertain.mergeRule).toBeNull();
    const far = mergeCandidates([ov({ providerId: "a", name: "Same Name Shop", lat: 30.2, lng: -97.7 }), osm({ providerId: "n", name: "Same Name Shop", lat: 30.25, lng: -97.7 })]);
    expect(far).toHaveLength(2); // same name 5 km apart: two businesses
  });
  it("prefers closed status and never invents values", () => {
    const m = mergeCandidates([ov({ providerId: "a", name: "Old Shop", operatingStatus: "closed" }), osm({ providerId: "n", name: "Old Shop", operatingStatus: "unknown" })]);
    expect(m[0].operatingStatus).toBe("closed");
    expect(m[0].website).toBeNull();
    expect(m[0].email).toBeNull();
  });
});

function fakeProvider(key: DiscoveryProvider["key"], impl: () => Promise<ProviderResult> | ProviderResult, status: DiscoveryProvider["status"] = "active"): DiscoveryProvider {
  return { key, label: key, status, description: "", attribution: key, isAvailable: () => ({ available: true }), discover: async () => impl() };
}
const result = (provider: DiscoveryProvider["key"], candidates: BusinessCandidate[], extra: Partial<ProviderResult> = {}): ProviderResult => ({ provider, candidates, attribution: provider, notes: [], area: "test area", cached: "none", release: "r1", ...extra });

describe("engine run", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    resetEnv({});
    db = await useTempDb();
  });
  const mkSearch = async (over: Partial<typeof searches.$inferInsert> = {}) => {
    const id = newId();
    await db.insert(searches).values({ id, name: "t", industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 10, providers: ["overture", "osm"], requireWebsite: false, autoInvestigate: false, filters: { segments: [], areaMode: "radius", radiusKm: 5, requirePhone: false, excludeChains: true, skipKnown: false, minLeadScore: 50, autoInvestigateLimit: null, centerLat: 30.27, centerLon: -97.74 }, ...over }).run();
    return (await db.select().from(searches).where(eq(searches.id, id)).get())!;
  };

  it("runs both sources, merges overlaps, stores candidates with provenance and saves them", async () => {
    const s = await mkSearch();
    const run = await runDiscovery(db, s, {
      providers: {
        overture: fakeProvider("overture", () => result("overture", [ov({ providerId: "a", name: "Colvin Automotive", website: "https://colvinautomotive.com", phone: "5124532345", street: "2715 Hancock Dr", city: "Austin" }), ov({ providerId: "b", name: "Sparkle Wash", operatingStatus: "closed" }), ov({ providerId: "c", name: "Firestone Complete Auto Care", website: "https://firestone.com" })], { cached: "all" })),
        osm: fakeProvider("osm", () => result("osm", [osm({ providerId: "n1", name: "Colvin Auto", website: "https://colvinautomotive.com" }), osm({ providerId: "n2", name: "Mike's Mechanic", phone: "5125550199" })])),
      },
    });
    expect(run.errors).toEqual([]);
    expect(run.stats.candidates).toBe(5);
    expect(run.stats.skippedClosed).toBe(1);
    expect(run.stats.skippedChains).toBe(1);
    expect(run.stats.total).toBe(2);
    expect(run.stats.partial).toBe(false);
    expect(run.stats.cached).toBe("some");
    expect(run.stats.releases).toEqual({ overture: "r1", osm: "r1" });
    expect(run.stats.area).toMatch(/5 km around Austin/);
    const cands = await db.select().from(searchCandidates).where(eq(searchCandidates.searchId, s.id)).all();
    expect(cands.map((c) => c.name)).toEqual(["Colvin Automotive", "Mike's Mechanic"]); // lead score order
    expect(cands[0].sources.map((x) => x.provider)).toEqual(["overture", "osm"]);
    expect(cands[0].mergeRule).toBe("domain");
    expect(cands[0].completeness).toBeGreaterThan(cands[1].completeness);
    expect(cands.every((c) => c.businessId)).toBe(true); // auto-saved
    expect(run.stats.saved).toBe(2);
    expect(await db.select().from(searchResults).where(eq(searchResults.searchId, s.id)).all()).toHaveLength(2);
    const srcs = await db.select().from(businessSources).where(eq(businessSources.businessId, cands[0].businessId!)).all();
    expect(srcs.map((x) => x.provider).sort()).toEqual(["osm", "overture"]); // both source records kept on the saved business
    // A repeat run lists the same businesses as already saved and merges instead of duplicating.
    const again = await runDiscovery(db, s, { providers: { overture: fakeProvider("overture", () => result("overture", [ov({ providerId: "a", name: "Colvin Automotive", website: "https://colvinautomotive.com" })])), osm: fakeProvider("osm", () => result("osm", [])) } });
    expect(again.stats.created).toBe(0);
    expect(again.stats.merged).toBe(1);
    expect(await db.select().from(businesses).all()).toHaveLength(2);
  });

  it("refuses future providers before any call, records a partial failure, and keeps going", async () => {
    const s = await mkSearch({ providers: ["overture", "osm", "linkedin"] });
    let linkedinCalled = false;
    const run = await runDiscovery(db, s, {
      providers: {
        overture: fakeProvider("overture", () => {
          throw new ProviderError("S3 timeout", "overture", true);
        }),
        osm: fakeProvider("osm", () => result("osm", [osm({ providerId: "n1", name: "Mike's Mechanic", phone: "5125550199" })])),
        linkedin: fakeProvider("linkedin", () => {
          linkedinCalled = true;
          return result("linkedin", []);
        }, "future"),
      },
    });
    expect(linkedinCalled).toBe(false);
    expect(run.stats.providerResults.linkedin?.error).toMatch(/not available yet/);
    expect(run.stats.providerResults.overture?.error).toBe("S3 timeout");
    expect(run.stats.partial).toBe(true);
    expect(run.stats.total).toBe(1);
    expect(run.retryable?.message).toBe("S3 timeout");
  });

  it("returns zero results honestly and applies website, phone and known-business filters", async () => {
    const s = await mkSearch({ requireWebsite: true, filters: { segments: [], areaMode: "radius", radiusKm: 5, requirePhone: true, excludeChains: true, skipKnown: true, minLeadScore: 50, autoInvestigateLimit: null, centerLat: 30.27, centerLon: -97.74 } });
    const empty = await runDiscovery(db, s, { providers: { overture: fakeProvider("overture", () => result("overture", [])), osm: fakeProvider("osm", () => result("osm", [])) } });
    expect(empty.stats.total).toBe(0);
    expect(empty.errors).toEqual([]);
    await db.insert(businesses).values({ id: "known", name: "Known Shop", nameNormalized: "known shop", industry: "auto_repair", website: "https://known.example", websiteDomain: "known.example", phone: "5125550100", firstProvider: "csv" }).run();
    const run = await runDiscovery(db, s, { providers: { overture: fakeProvider("overture", () => result("overture", [ov({ providerId: "a", name: "No Site", phone: "5125550101" }), ov({ providerId: "b", name: "No Phone", website: "https://nophone.example" }), ov({ providerId: "c", name: "Known Shop", website: "https://known.example", phone: "5125550100" }), ov({ providerId: "d", name: "Fresh Shop", website: "https://fresh.example", phone: "5125550102" })])), osm: fakeProvider("osm", () => result("osm", [])) } });
    expect(run.stats.skippedNoWebsite).toBe(1);
    expect(run.stats.skippedNoPhone).toBe(1);
    expect(run.stats.skippedKnown).toBe(1);
    expect(run.stats.total).toBe(1);
  });

  it("lists without saving when asked, then saves the chosen candidates and marks the rest", async () => {
    const s = await mkSearch({ filters: { segments: [], areaMode: "radius", radiusKm: 5, requirePhone: false, excludeChains: true, skipKnown: false, minLeadScore: 50, autoInvestigateLimit: null, centerLat: 30.27, centerLon: -97.74, autoSave: false } });
    const run = await runDiscovery(db, s, { providers: { overture: fakeProvider("overture", () => result("overture", [ov({ providerId: "a", name: "Shop A", website: "https://a.example" }), ov({ providerId: "b", name: "Shop B", website: "https://b.example" })])), osm: fakeProvider("osm", () => result("osm", [])) } });
    expect(run.stats.saved).toBe(0);
    const cands = await db.select().from(searchCandidates).where(eq(searchCandidates.searchId, s.id)).all();
    expect(cands.every((c) => !c.businessId)).toBe(true);
    expect(await db.select().from(businesses).all()).toHaveLength(0);
    const saved = await saveCandidates(db, s, [cands.find((c) => c.name === "Shop B")!.id]);
    expect(saved.created).toBe(1);
    const after = await db.select().from(searchCandidates).where(eq(searchCandidates.searchId, s.id)).all();
    expect(after.find((c) => c.name === "Shop B")?.savedVia).toBe("new");
    expect(after.find((c) => c.name === "Shop A")?.businessId).toBeNull();
    expect(await db.select().from(businesses).all()).toHaveLength(1);
    const all = await saveCandidates(db, s);
    expect(all.created + all.merged).toBe(2);
    expect(await db.select().from(businesses).all()).toHaveLength(2);
  });
});
