/**
 * Reuse of stored pages: a second research run within RESEARCH_STALE_DAYS must
 * not pay for a crawl, including when the homepage redirected to another domain
 * (a shop acquired by a group, a moved site). Measured live on 2026-10-28: the
 * redirect made every stored page look foreign and the re-run cost 5 credits.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnv, useTempDb } from "../helpers";
import { getDb } from "@/db/client";
import { businesses, investigations, pages } from "@/db/schema";
import { loadStoredPages } from "@/lib/research/stored";

const HTML = (title: string) => `<html><head><title>${title}</title></head><body><main><p>${title} page with enough words to count as content.</p></main></body></html>`;

describe("stored pages", () => {
  beforeEach(async () => {
    resetEnv();
    await useTempDb();
  });

  async function seed(opts: { finalHost: string; ageDays?: number }) {
    const db = await getDb();
    const startedAt = new Date(Date.now() - (opts.ageDays ?? 0) * 86_400_000).toISOString();
    await db.insert(businesses).values({ id: "b1", name: "Austin Automotive Specialists", nameNormalized: "austin automotive specialists", industry: "auto_repair", firstProvider: "csv", website: "https://austinautomotivespecialists.com", websiteDomain: "austinautomotivespecialists.com", createdAt: startedAt, updatedAt: startedAt }).run();
    await db.insert(investigations).values({ id: "inv1", businessId: "b1", status: "done", startedAt, finishedAt: startedAt }).run();
    const rows = [
      { id: "p1", url: "https://austinautomotivespecialists.com", finalUrl: `https://${opts.finalHost}/auto-group/austins`, kind: "home" },
      { id: "p2", url: `https://${opts.finalHost}/services`, finalUrl: `https://${opts.finalHost}/services`, kind: "services" },
      { id: "p3", url: "https://tracker.example/pixel", finalUrl: "https://tracker.example/pixel", kind: "other" },
    ];
    for (const r of rows) await db.insert(pages).values({ ...r, investigationId: "inv1", businessId: "b1", statusCode: 200, html: HTML(r.kind), credits: 1 }).run();
  }

  it("reuses pages on the recorded website", async () => {
    await seed({ finalHost: "austinautomotivespecialists.com" });
    const stored = await loadStoredPages("b1", "https://austinautomotivespecialists.com", 30);
    expect(stored?.pages.map((p) => p.kind)).toEqual(["home", "services"]);
    expect(stored?.pages.every((p) => p.credits === 0)).toBe(true);
  });

  it("reuses pages on the domain the homepage redirected to, and still drops foreign hosts", async () => {
    await seed({ finalHost: "www.greatwater360autocare.com" });
    const stored = await loadStoredPages("b1", "https://austinautomotivespecialists.com", 30);
    expect(stored?.pages.map((p) => p.kind)).toEqual(["home", "services"]);
    expect(stored?.pages.map((p) => p.url)).not.toContain("https://tracker.example/pixel");
  });

  it("does not reuse pages older than the staleness window", async () => {
    await seed({ finalHost: "austinautomotivespecialists.com", ageDays: 45 });
    expect(await loadStoredPages("b1", "https://austinautomotivespecialists.com", 30)).toBeNull();
    expect(await loadStoredPages("b1", "https://austinautomotivespecialists.com", Number.POSITIVE_INFINITY)).not.toBeNull();
  });
});
