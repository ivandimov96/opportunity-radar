/**
 * Integrated pipeline: discovery -> investigate (fetch, detect, AI, score) ->
 * outreach -> pipeline, driven through the real job queue and handlers. HTTP
 * and the model are mocked at module boundaries; everything else runs for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const SITE: Record<string, string> = {
  "https://bartonauto.example": `<html><head><title>Barton Auto Care</title><script src="https://static.parastorage.com/a.js"></script></head><body>
    <nav><a href="/services">Our Services</a><a href="/contact">Contact</a><a href="/about-us">About</a></nav>
    <h1>Barton Auto Care</h1><p>Family-owned since 1998. Call us today to schedule your appointment. Free estimates on brakes.</p>
    <p>Fleet accounts welcome for local businesses.</p><a href="mailto:service@bartonauto.example">Email us</a></body></html>`,
  "https://bartonauto.example/services": `<html><head><title>Services</title></head><body><h1>Services</h1><p>Brakes, oil changes, diagnostics, and a 24 month / 24,000 mile warranty on repairs.</p></body></html>`,
  "https://bartonauto.example/contact": `<html><head><title>Contact</title></head><body><p>Mon - Fri: 8am - 6pm</p><form action="/send"><input name="name"><input name="phone"><textarea name="message"></textarea></form></body></html>`,
  "https://bartonauto.example/about-us": `<html><head><title>About</title></head><body><p>Our ASE-certified technicians have served Austin for 25 years.</p></body></html>`,
  "https://modern.example": `<html><head><title>Modern Shop</title><meta name="viewport" content="width=device-width"><script src="https://book.shopgenie.io/w.js"></script><script src="https://widget.podium.com/x.js"></script></head><body><main>
    <p>Book online 24/7. We text you updates and digital inspection photos while we work. Join our maintenance plan. Read our Google reviews. © ${new Date().getFullYear()} Modern Shop</p>
    <form action="/contact"><input name="name"><input name="email"><textarea name="message"></textarea></form></main></body></html>`,
  "https://pitstop.example": `<html><head><title>Pit Stop Garage - Austin, TX</title></head><body><main><p>Pit Stop Garage, Austin TX. Call <a href="tel:512-555-0142">512-555-0142</a> to schedule.</p></main></body></html>`,
};
vi.mock("@/lib/search", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/search")>();
  return { ...orig, webSearch: vi.fn(async (q: string) => (/Pit Stop/.test(q) ? [{ url: "https://www.yelp.com/biz/pit-stop", title: "Yelp", snippet: "" }, { url: "https://pitstop.example/about", title: "Pit Stop Garage", snippet: "" }] : [])) };
});

// Firecrawl is the only way pages are fetched; here it answers from the fixture above.
const scrapeCalls: string[] = [];
vi.mock("@/lib/research/firecrawl", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/research/firecrawl")>();
  const scrapePage = vi.fn(async (url: string) => {
    scrapeCalls.push(url);
    const key = url.replace(/\/$/, "");
    const base = { url, finalUrl: url, markdown: null, links: [] as string[], title: null, description: null, ms: 1, credits: 1 };
    if (key === "https://down.example") throw new orig.FirecrawlError("Firecrawl HTTP 500: unable to fetch https://down.example", 500, true);
    const body = SITE[key];
    if (!body) return { ...base, statusCode: 404, rawHtml: null, error: "HTTP 404" };
    return { ...base, statusCode: 200, rawHtml: body, error: null };
  });
  return { ...orig, scrapePage, mapSite: vi.fn(async () => ({ links: [], credits: 1 })) };
});
vi.mock("@/lib/research/robots", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/research/robots")>();
  return { ...orig, isAllowedByRobots: async () => true };
});

const callStructured = vi.fn();
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...orig, callStructured: (...args: unknown[]) => callStructured(...args) };
});

import { useTempDb, resetEnv } from "../helpers";
import { businesses, facts, investigations, jobs, opportunities, outreachDrafts, pages, prospects, searchResults, searches } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { drainQueue } from "@/lib/jobs/worker";
import { enqueueInvestigation, enqueueOutreach } from "@/lib/jobs/handlers";
import { clearRobotsCache } from "@/lib/research/robots";

const fake = (data: unknown) => ({ data, model: "mock-model", usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 } });
const OPP = { category: "estimate_quote_followup", title: "Estimate follow-up", problem_hypothesis: "Free estimates may go unfollowed", proposed_solution: "Follow-up workflow", why_not_existing_tool: "No suite detected", expected_value: "Recover estimates", supporting_fact_keys: ["estimate_policy", "booking_method", "shop_management_tool", "bogus"], assumptions: ["No follow-up tooling"], validation_questions: ["How are estimates approved?"], implementation_effort: "small", reusability: "high", risks: [], sales_angle: "You offer free estimates", ratings: { value: 4, feasibility: 4, evidence_strength: 4, buying_readiness: 3 } };

describe("integrated pipeline", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    resetEnv({ ANTHROPIC_API_KEY: "test-key", FIRECRAWL_API_KEY: "test" });
    db = await useTempDb();
    clearRobotsCache();
    callStructured.mockReset();
    scrapeCalls.length = 0;
  });

  it("runs discovery (demo provider) and records search stats without investigating demo records", async () => {
    const id = newId();
    await db.insert(searches).values({ id, name: "Demo", industry: "auto_repair", country: "US", city: "Austin", maxResults: 10, providers: ["demo"], requireWebsite: false, autoInvestigate: true }).run();
    await enqueueJob("discover_search", { searchId: id });
    expect(await drainQueue()).toBe(1);
    const s = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
    expect(s.status).toBe("done");
    expect(s.stats?.created).toBe(4);
    // Everything the run learned is kept: per-source counts/timings and an ordered log.
    expect(s.stats?.providerResults.demo?.durationMs).toBeGreaterThanOrEqual(0);
    expect(s.stats?.candidates).toBe(4);
    expect(s.stats?.durationMs).toBeGreaterThanOrEqual(0);
    expect(s.stats?.notes?.some((n) => /Ranking: 4 unique business/.test(n))).toBe(true);
    expect(s.stats?.notes?.at(-1)).toMatch(/4 result\(s\) listed and saved/);
    const { exportSearchCsv } = await import("@/lib/queries");
    const csv = (await exportSearchCsv(id))!.csv.split("\n");
    expect(csv[0]).toContain("lead_score");
    expect(csv).toHaveLength(5);
    expect((await db.select().from(businesses).all()).every((b) => b.isDemo)).toBe(true);
    expect(await db.select().from(prospects).all()).toHaveLength(4);
    expect(await db.select().from(jobs).where(eq(jobs.type, "investigate_business")).all()).toHaveLength(0);
  });

  it("investigates a website: detected + grounded AI facts, scored opportunities, verdict, drafts, pipeline", async () => {
    const bizId = newId();
    await db.insert(businesses).values({ id: bizId, name: "Barton Auto Care", nameNormalized: "barton auto care", industry: "auto_repair", website: "https://bartonauto.example", websiteDomain: "bartonauto.example", city: "Austin", region: "TX", firstProvider: "csv" }).run();
    callStructured.mockImplementationOnce(async () =>
      fake({
        facts: [
          { key: "summary", status: "verified", value: "Family-owned auto repair shop", evidence_quote: "Family-owned since 1998", source_url: "https://bartonauto.example" },
          { key: "estimate_policy", status: "verified", value: "free_estimates", evidence_quote: "Free estimates on brakes", source_url: "https://bartonauto.example" },
          { key: "warranty", status: "verified", value: "24 month / 24,000 mile", evidence_quote: "24 month / 24,000 mile warranty on repairs", source_url: "https://bartonauto.example/services" },
          { key: "shop_management_tool", status: "verified", value: "Tekmetric", evidence_quote: "Powered by Tekmetric", source_url: "https://bartonauto.example" }, // ungrounded -> rejected; detected not_found stays
          { key: "maintenance_plans", status: "not_found", value: "", evidence_quote: "", source_url: "" },
        ],
        workflows: [{ name: "Phone scheduling", fact_keys: ["booking_method"] }],
        opportunities: [OPP, { ...OPP, category: "fleet_b2b", title: "Fleet portal", supporting_fact_keys: [], ratings: { value: 4, feasibility: 3, evidence_strength: 4, buying_readiness: 2 } }],
        verdict: "opportunity",
        verdict_reason: "Phone-only booking and free estimates.",
      }),
    );
    await enqueueInvestigation(bizId);
    expect(await drainQueue(["investigate_business"])).toBe(1);

    const biz = (await db.select().from(businesses).where(eq(businesses.id, bizId)).get())!;
    expect(biz.status).toBe("profiled");
    expect(biz.verdict).toBe("opportunity");
    expect(biz.summary).toBe("Family-owned auto repair shop");
    expect(biz.email).toBe("service@bartonauto.example");
    expect(biz.priority).toBeGreaterThan(0);
    const f = Object.fromEntries((await db.select().from(facts).where(eq(facts.businessId, bizId)).all()).map((x) => [x.key, x]));
    expect(f.booking_method).toMatchObject({ status: "verified", value: "mixed", method: "detected" });
    expect(f.website_platform).toMatchObject({ status: "verified", value: "Wix" });
    expect(f.estimate_policy).toMatchObject({ status: "verified", value: "free_estimates", method: "detected" }); // text cue now detects it before the model
    expect(f.fleet_program).toMatchObject({ status: "verified", method: "detected" });
    expect(f.shop_management_tool.status).toBe("not_found");
    expect(f.maintenance_plans.status).toBe("not_found");
    expect(f.contact_form.status).toBe("verified");
    const all = (await db.select().from(opportunities).where(eq(opportunities.businessId, bizId)).all()).sort((a, b) => a.rank - b.rank);
    // Model hypotheses are kept; rule-based patterns fill categories the model did not cover; ranked by priority, capped.
    const opps = all.filter((o) => o.source === "ai");
    expect(opps).toHaveLength(2);
    expect(all.length).toBeLessThanOrEqual(5);
    expect(all.some((o) => o.source === "rules")).toBe(true);
    expect(new Set(all.map((o) => o.category)).size).toBe(all.length);
    expect(opps[0].supportingFactKeys).toEqual(["estimate_policy", "booking_method", "shop_management_tool"]);
    expect(opps[1].supportingFactKeys).toEqual([]);
    expect(opps[1].confidenceScore).toBeLessThanOrEqual(35);
    expect(opps[0].confidenceScore).toBeGreaterThan(opps[1].confidenceScore);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].attractivenessScore * 0.6 + all[i - 1].confidenceScore * 0.4).toBeGreaterThanOrEqual(all[i].attractivenessScore * 0.6 + all[i].confidenceScore * 0.4 - 1);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, bizId)).get())!.stage).toBe("qualified");

    callStructured.mockImplementationOnce(async () =>
      fake({ subject: "A quick idea", body: "Hi Barton Auto Care team, I noticed you offer free estimates and ask customers to call to schedule. Would a 15-minute call be useful? Shops see 20% more bookings.", claims: [{ text: "offer free estimates", fact_keys: ["estimate_policy"] }, { text: "Shops see 20% more bookings", fact_keys: [] }] }),
    );
    await enqueueOutreach(bizId, opps[0].id, "concise");
    expect(await drainQueue(["generate_outreach"])).toBe(1);
    const drafts = await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, bizId)).all();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].toEmail).toBe("service@bartonauto.example");
    expect(drafts[0].claims[0].factKeys).toEqual(["estimate_policy"]);
    expect(drafts[0].warnings.some((w) => w.startsWith("Unsupported claim"))).toBe(true);
    expect(drafts[0].warnings.some((w) => w.includes("percentage"))).toBe(true);
  });

  it("keeps rule-based patterns as hypotheses when the model finds nothing, and records no_opportunity when neither does", async () => {
    const bizId = newId();
    await db.insert(businesses).values({ id: bizId, name: "Quiet Shop", nameNormalized: "quiet shop", industry: "auto_repair", website: "https://bartonauto.example", firstProvider: "csv" }).run();
    callStructured.mockImplementationOnce(async () => fake({ facts: [], workflows: [], opportunities: [], verdict: "no_opportunity", verdict_reason: "Nothing compelling." }));
    await enqueueInvestigation(bizId);
    await drainQueue();
    const biz = (await db.select().from(businesses).where(eq(businesses.id, bizId)).get())!;
    expect(biz.status).toBe("profiled");
    expect(biz.verdict).toBe("opportunity");
    expect(biz.statusMessage).toContain("rule-based");
    const opps = await db.select().from(opportunities).where(eq(opportunities.businessId, bizId)).all();
    expect(opps.length).toBeGreaterThan(0);
    expect(opps.every((o) => o.source === "rules")).toBe(true);
    const inv = (await db.select().from(investigations).where(eq(investigations.businessId, bizId)).get())!;
    expect(inv.verdictReason).toContain("Nothing compelling");
    expect(inv.verdictReason).toContain("rule-based");

    // A site with a modern stack and nothing for the rules to flag.
    const quietId = newId();
    await db.insert(businesses).values({ id: quietId, name: "Modern Shop", nameNormalized: "modern shop", industry: "auto_repair", website: "https://modern.example", firstProvider: "csv" }).run();
    callStructured.mockImplementationOnce(async () => fake({ facts: [], workflows: [], opportunities: [], verdict: "no_opportunity", verdict_reason: "Nothing compelling." }));
    await enqueueInvestigation(quietId);
    await drainQueue();
    const quiet = (await db.select().from(businesses).where(eq(businesses.id, quietId)).get())!;
    expect(quiet.verdict).toBe("no_opportunity");
    expect(await db.select().from(opportunities).where(eq(opportunities.businessId, quietId)).all()).toHaveLength(0);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, quietId)).get())!.stage).toBe("lead");
  });

  it("without an API key the investigation still profiles detected facts and gives a rule-based verdict", async () => {
    resetEnv({ FIRECRAWL_API_KEY: "test" });
    const good = newId();
    const bad = newId();
    await db.insert(businesses).values({ id: good, name: "Good", nameNormalized: "good", industry: "auto_repair", website: "https://bartonauto.example", firstProvider: "csv" }).run();
    await db.insert(businesses).values({ id: bad, name: "Bad", nameNormalized: "bad", industry: "auto_repair", website: "https://down.example", firstProvider: "csv" }).run();
    await enqueueInvestigation(bad);
    await enqueueInvestigation(good);
    await drainQueue(["investigate_business"]);
    const g = (await db.select().from(businesses).where(eq(businesses.id, good)).get())!;
    expect(g.status).toBe("profiled");
    expect(g.verdict).toBe("opportunity");
    expect(g.statusMessage).toMatch(/rule-based/);
    expect(g.summary).toBeNull(); // no meta description on the test site; no model → no summary is invented
    const gf = await db.select().from(facts).where(eq(facts.businessId, good)).all();
    expect(gf.some((f) => f.key === "booking_method" && f.status === "verified")).toBe(true);
    expect(gf.every((f) => f.method === "detected")).toBe(true);
    const gopps = await db.select().from(opportunities).where(eq(opportunities.businessId, good)).all();
    expect(gopps.every((o) => o.source === "rules")).toBe(true);
    expect(gopps.map((o) => o.category)).toContain("estimate_quote_followup");
    // Outreach without a key: a template draft grounded in the facts, claims mapped, no model call.
    await enqueueOutreach(good, null, "concise");
    expect(await drainQueue(["generate_outreach"])).toBe(1);
    const tdraft = (await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, good)).get())!;
    expect(tdraft.model).toBe("template");
    expect(tdraft.body).toContain("Good team");
    expect(tdraft.claims.length).toBeGreaterThan(0);
    expect(tdraft.claims.every((c) => c.factKeys.length > 0)).toBe(true);
    expect(tdraft.warnings[0]).toMatch(/Template draft/);
    expect(callStructured).not.toHaveBeenCalled();
    const b = (await db.select().from(businesses).where(eq(businesses.id, bad)).get())!;
    expect(b.status).toBe("failed");
    expect(b.statusMessage).toMatch(/could not be fetched/);
    expect(b.statusMessage).toContain("unable to fetch");
    const badJob = (await db.select().from(jobs).where(eq(jobs.idempotencyKey, `investigate:${bad}`)).get())!;
    expect(badJob.status).toBe("failed");
    expect(callStructured).not.toHaveBeenCalled();
  });

  it("stops AI work when the spend guard is reached", async () => {
    resetEnv({ ANTHROPIC_API_KEY: "k", AI_SPEND_LIMIT_USD: "0.0001" });
    const { recordUsage } = await import("@/lib/ai/usage");
    await recordUsage({ stage: "investigate", model: "claude-opus-5-5", input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 });
    const { assertSpendWithinLimit, AiSpendLimitError } = await import("@/lib/ai/client");
    await expect(assertSpendWithinLimit()).rejects.toThrow(AiSpendLimitError);
  });

  it("locates and verifies a website for a business without one, then investigates it; records no_website when nothing verifies", async () => {
    resetEnv({ FIRECRAWL_API_KEY: "test" });
    const found = newId();
    const lost = newId();
    await db.insert(businesses).values({ id: found, name: "Pit Stop Garage", nameNormalized: "pit stop garage", industry: "auto_repair", city: "Austin", region: "TX", phone: "5125550142", firstProvider: "osm", status: "new" }).run();
    await db.insert(businesses).values({ id: lost, name: "Ghost Garage", nameNormalized: "ghost garage", industry: "auto_repair", city: "Austin", region: "TX", phone: "5125550199", firstProvider: "osm", status: "new" }).run();
    await enqueueInvestigation(found);
    await enqueueInvestigation(lost);
    await drainQueue(["investigate_business"]);
    const f = (await db.select().from(businesses).where(eq(businesses.id, found)).get())!;
    expect(f.website).toBe("https://pitstop.example");
    expect(f.websiteSource).toBe("found_search");
    expect(f.status).toBe("profiled");
    expect(f.kind).toBe("independent");
    const l = (await db.select().from(businesses).where(eq(businesses.id, lost)).get())!;
    expect(l.website).toBeNull();
    expect(l.status).toBe("no_website");
    expect(l.statusMessage).toMatch(/could not be located/);
  });

  it("applies discovery filters (phone required, skip known, auto-investigate limit by lead score) and reports what was skipped", async () => {
    const { demoProvider } = await import("@/lib/discovery/demo");
    const all = (await demoProvider.discover({ industry: "auto_repair", country: "US", city: "Austin", maxResults: 10, requireWebsite: false })).candidates;
    const withoutPhone = all.filter((c) => !c.phone).length;
    const withoutSite = all.filter((c) => c.phone && !c.website).length;
    expect(withoutSite).toBeGreaterThan(0);
    const first = newId();
    await db.insert(searches).values({ id: first, name: "First", industry: "auto_repair", country: "US", city: "Austin", maxResults: 10, providers: ["demo"], requireWebsite: true, autoInvestigate: false, filters: { segments: [], areaMode: "area", radiusKm: 15, requirePhone: true, excludeChains: true, skipKnown: false, minLeadScore: 0, autoInvestigateLimit: null } }).run();
    await enqueueJob("discover_search", { searchId: first });
    await drainQueue();
    const s1 = (await db.select().from(searches).where(eq(searches.id, first)).get())!;
    expect(s1.stats?.skippedNoPhone).toBe(withoutPhone);
    expect(s1.stats?.skippedNoWebsite).toBe(withoutSite);
    expect(s1.stats?.total).toBe(all.length - withoutPhone - withoutSite);

    const second = newId();
    await db.insert(searches).values({ id: second, name: "Second", industry: "auto_repair", country: "US", city: "Austin", maxResults: 10, providers: ["demo"], requireWebsite: false, autoInvestigate: true, filters: { segments: [], areaMode: "area", radiusKm: 15, requirePhone: false, excludeChains: true, skipKnown: true, minLeadScore: 0, autoInvestigateLimit: 1 } }).run();
    await enqueueJob("discover_search", { searchId: second });
    await drainQueue(["discover_search"]);
    const s2 = (await db.select().from(searches).where(eq(searches.id, second)).get())!;
    expect(s2.stats?.skippedKnown).toBe(all.length - withoutPhone - withoutSite);
    expect(s2.stats?.total).toBe(withoutPhone + withoutSite); // only the previously unseen records are listed
    expect(s2.stats?.queuedForInvestigation).toBe(0); // demo records are never auto-investigated
  });

  it("ranks candidates by lead score before applying the result cap", async () => {
    const id = newId();
    await db.insert(searches).values({ id, name: "Top 2", industry: "auto_repair", country: "US", city: "Austin", maxResults: 2, providers: ["demo"], requireWebsite: false, autoInvestigate: false }).run();
    await enqueueJob("discover_search", { searchId: id });
    await drainQueue(["discover_search"]);
    const s = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
    expect(s.stats?.total).toBe(2);
    const listed = await db.select({ name: businesses.name, leadScore: businesses.leadScore }).from(searchResults).innerJoin(businesses, eq(searchResults.businessId, businesses.id)).where(eq(searchResults.searchId, id)).all();
    // The two demo shops with website + phone + street address outrank the one without a street and the one without a website.
    expect(listed.map((b) => b.name).sort()).toEqual(["Barton Creek Auto Care (Demo)", "Northside Transmission & Brake (Demo)"]);
  });

  it("lists businesses with server-side paging, sorting and date ranges", async () => {
    const { listBusinesses, listSearches } = await import("@/lib/queries");
    const mk = (name: string, createdAt: string, priority: number | null) => db.insert(businesses).values({ id: newId(), name, nameNormalized: name.toLowerCase(), industry: "auto_repair", firstProvider: "csv", createdAt, updatedAt: createdAt, priority, status: priority != null ? "profiled" : "new", verdict: priority != null ? "opportunity" : null, investigatedAt: priority != null ? createdAt : null }).run();
    await mk("Alpha", "2026-10-01T10:00:00.000Z", 80);
    await mk("Bravo", "2026-10-15T10:00:00.000Z", null);
    await mk("Charlie", "2026-10-20T10:00:00.000Z", 60);
    const page1 = await listBusinesses({ sort: "name", dir: "asc", page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.rows.map((r) => r.business.name)).toEqual(["Alpha", "Bravo"]);
    const page2 = await listBusinesses({ sort: "name", dir: "asc", page: 2, pageSize: 2 });
    expect(page2.rows.map((r) => r.business.name)).toEqual(["Charlie"]);
    const ranged = await listBusinesses({ dateField: "createdAt", from: "2026-10-10T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z", sort: "discovered", dir: "desc" });
    expect(ranged.rows.map((r) => r.business.name)).toEqual(["Charlie", "Bravo"]);
    const investigated = await listBusinesses({ dateField: "investigatedAt", from: "2026-10-02T00:00:00.000Z", to: null });
    expect(investigated.rows.map((r) => r.business.name)).toEqual(["Charlie"]);
    expect((await listBusinesses({ q: "charl" })).rows).toHaveLength(1);
    const s = await listSearches({ q: "nothing-matches" });
    expect(s.total).toBe(0);
  });

  it("reuses stored pages within the staleness window, re-crawls on request, stops at the budget, and re-analyzes without a key", async () => {
    resetEnv({ FIRECRAWL_API_KEY: "test" });
    const id = newId();
    await db.insert(businesses).values({ id, name: "Good", nameNormalized: "good", industry: "auto_repair", website: "https://bartonauto.example", websiteDomain: "bartonauto.example", firstProvider: "csv" }).run();
    await enqueueInvestigation(id);
    await drainQueue(["investigate_business"]);
    const first = scrapeCalls.length;
    expect(first).toBe(4); // home + services + contact + about
    let inv = await db.select().from(investigations).where(eq(investigations.businessId, id)).all();
    expect(inv[0].creditsUsed).toBe(4);
    // Second run within RESEARCH_STALE_DAYS: stored pages, no Firecrawl call, no credits.
    await enqueueInvestigation(id);
    await drainQueue(["investigate_business"]);
    expect(scrapeCalls.length).toBe(first);
    inv = await db.select().from(investigations).where(eq(investigations.businessId, id)).all();
    expect(inv).toHaveLength(2);
    expect(inv.map((i) => i.creditsUsed).sort()).toEqual([0, 4]);
    const stored = await db.select().from(pages).where(eq(pages.businessId, id)).all();
    expect(stored.filter((p) => p.renderer === "stored")).toHaveLength(4);
    expect(stored.every((p) => p.html)).toBe(true);
    expect((await db.select().from(businesses).where(eq(businesses.id, id)).get())!.status).toBe("profiled");
    // "Research again" crawls again.
    await enqueueInvestigation(id, "recrawl");
    await drainQueue(["investigate_business"]);
    expect(scrapeCalls.length).toBe(first * 2);
    // Monthly budget guard: 8 credits recorded, budget 8 → refused, explicit, no credits spent.
    resetEnv({ FIRECRAWL_API_KEY: "test", FIRECRAWL_MONTHLY_CREDIT_BUDGET: "8" });
    await enqueueInvestigation(id, "recrawl");
    await drainQueue(["investigate_business"]);
    let b = (await db.select().from(businesses).where(eq(businesses.id, id)).get())!;
    expect(b.status).toBe("failed");
    expect(b.statusMessage).toMatch(/budget reached/);
    expect(scrapeCalls.length).toBe(first * 2);
    // Without a key, re-analysis of stored pages still profiles the business; a new crawl does not.
    resetEnv({});
    await enqueueInvestigation(id, "reanalyze");
    await drainQueue(["investigate_business"]);
    b = (await db.select().from(businesses).where(eq(businesses.id, id)).get())!;
    expect(b.status).toBe("profiled");
    await enqueueInvestigation(id, "recrawl");
    await drainQueue(["investigate_business"]);
    b = (await db.select().from(businesses).where(eq(businesses.id, id)).get())!;
    expect(b.status).toBe("failed");
    expect(b.statusMessage).toMatch(/FIRECRAWL_API_KEY/);
    expect(scrapeCalls.length).toBe(first * 2);
  });
});
