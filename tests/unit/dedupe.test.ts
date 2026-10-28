import { beforeEach, describe, expect, it } from "vitest";
import { upsertCandidate } from "@/lib/discovery/dedupe";
import type { BusinessCandidate } from "@/lib/discovery/types";
import { businesses, businessSources } from "@/db/schema";
import { useTempDb } from "../helpers";

const base: BusinessCandidate = { provider: "osm", providerId: "node/1", name: "Barton Auto Care LLC", website: "https://bartonauto.com", phone: "512-555-0101", city: "Austin", attribution: "test" };

describe("upsertCandidate deduplication", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    db = await useTempDb();
  });

  it("creates a business and its source", async () => {
    const r = await upsertCandidate(db, base, { industry: "auto_repair" });
    expect(r.wasNew).toBe(true);
    expect(await db.select().from(businesses).all()).toHaveLength(1);
    expect(await db.select().from(businessSources).all()).toHaveLength(1);
  });

  it("matches the same provider id without duplicating", async () => {
    await upsertCandidate(db, base, { industry: "auto_repair" });
    const r = await upsertCandidate(db, { ...base, name: "Barton Auto Care (renamed)" }, { industry: "auto_repair" });
    expect(r.wasNew).toBe(false);
    expect(r.matchedBy).toBe("provider_id");
    expect(await db.select().from(businesses).all()).toHaveLength(1);
  });

  it("merges a different provider by website domain and adds a second source", async () => {
    await upsertCandidate(db, base, { industry: "auto_repair" });
    const r = await upsertCandidate(db, { ...base, provider: "google_maps", providerId: "ChIJ123", website: "http://www.bartonauto.com/", phone: null }, { industry: "auto_repair" });
    expect(r.wasNew).toBe(false);
    expect(r.matchedBy).toBe("domain");
    expect(await db.select().from(businesses).all()).toHaveLength(1);
    expect(await db.select().from(businessSources).all()).toHaveLength(2);
  });

  it("merges by normalized name + city and fills missing fields only", async () => {
    await upsertCandidate(db, { ...base, website: null, phone: null }, { industry: "auto_repair" });
    const r = await upsertCandidate(db, { ...base, provider: "csv", providerId: "abc", name: "Barton Auto Care, Inc.", website: "https://bartonauto.com" }, { industry: "auto_repair" });
    expect(r.matchedBy).toBe("name_city");
    const row = (await db.select().from(businesses).all())[0];
    expect(row.website).toBe("https://bartonauto.com");
    expect(row.name).toBe("Barton Auto Care LLC"); // original name preserved
  });

  it("treats same name in different cities as different businesses", async () => {
    await upsertCandidate(db, { ...base, website: null, phone: null }, { industry: "auto_repair" });
    const r = await upsertCandidate(db, { ...base, providerId: "node/2", website: null, phone: null, city: "Round Rock" }, { industry: "auto_repair" });
    expect(r.wasNew).toBe(true);
    expect(await db.select().from(businesses).all()).toHaveLength(2);
  });

  it("never fabricates a website: businesses without one are marked no_website", async () => {
    await upsertCandidate(db, { ...base, website: null }, { industry: "auto_repair" });
    expect((await db.select().from(businesses).all())[0].status).toBe("no_website");
  });
});
