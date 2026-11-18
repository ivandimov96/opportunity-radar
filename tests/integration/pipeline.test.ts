/**
 * Integrated pipeline: discovery -> investigate (fetch, detect, AI, score) ->
 * outreach -> pipeline, driven through the real job queue and handlers. HTTP
 * and the model are mocked at module boundaries; everything else runs for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { _setSerperFetch } from "@/lib/discovery/google-maps";

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
import { businesses, facts, investigations, jobs, observations, opportunities, outreachDrafts, pages, prospects, searchResults, searches } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { drainQueue } from "@/lib/jobs/worker";
import { enqueueInvestigation } from "@/lib/jobs/handlers";
import { clearRobotsCache } from "@/lib/research/robots";

const fake = (data: unknown) => ({ data, model: "mock-model", usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 } });
const OPP = {
  role: "primary",
  scope: "internal",
  category: "estimate_quote_followup",
  title: "Estimate-to-booking flow",
  problem_hypothesis: "Free estimates may go unfollowed",
  proposed_solution: "One flow from request to approved estimate",
  why_relevant: "They advertise free estimates and take bookings by phone and form.",
  components: [
    { name: "Online requests", description: "Requests land in the schedule.", evidence: ["booking_method", "contact_form"] },
    { name: "Estimate follow-up", description: "Nudges with an approve link.", evidence: ["estimate_policy", "o1"] },
    { name: "Loyalty app", description: "Points.", evidence: ["bogus"] },
  ],
  why_not_existing_tool: "No suite detected",
  expected_value: "Recover estimates",
  supporting_fact_keys: ["estimate_policy", "booking_method", "shop_management_tool", "bogus"],
  assumptions: ["No follow-up tooling"],
  validation_questions: ["How are estimates approved?"],
  implementation_effort: "small",
  reusability: "high",
  risks: [],
  sales_angle: "You offer free estimates",
  ratings: { value: 4, feasibility: 4, evidence_strength: 4 },
};

/** Four Google Maps listings (served through the injected transport): two complete, one without a street, one without a website. */
const LISTINGS = [
  { position: 1, title: "Barton Creek Auto Care", placeId: "ChIJ1", cid: "1", latitude: 30.27, longitude: -97.74, rating: 4.7, ratingCount: 120, type: "Auto repair shop", types: ["Auto repair shop"], address: "4100 Sample Lane, Austin, TX 78704", phoneNumber: "(512) 555-0101", website: "https://barton-creek-auto-care.example" },
  { position: 2, title: "Northside Transmission & Brake", placeId: "ChIJ2", cid: "2", latitude: 30.28, longitude: -97.74, rating: 4.5, ratingCount: 80, type: "Auto repair shop", types: ["Auto repair shop"], address: "9020 Sample Blvd, Austin, TX 78758", phoneNumber: "(512) 555-0102", website: "https://northside-transmission.example" },
  { position: 3, title: "Lone Star Euro Specialists", placeId: "ChIJ3", cid: "3", latitude: 30.26, longitude: -97.75, rating: 4.6, ratingCount: 40, type: "Auto repair shop", types: ["Auto repair shop"], address: "Austin, TX", phoneNumber: "(512) 555-0103", website: "https://lonestar-euro.example" },
  { position: 4, title: "Quick Lube Corner", placeId: "ChIJ4", cid: "4", latitude: 30.29, longitude: -97.73, rating: 4.1, ratingCount: 15, type: "Oil change service", types: ["Oil change service"], address: "Austin, TX", phoneNumber: "(512) 555-0104" },
];
const CANDIDATES = LISTINGS.map((l) => ({ phone: l.phoneNumber, website: "website" in l ? l.website : null }));

describe("integrated pipeline", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    resetEnv({ ANTHROPIC_API_KEY: "test-key", FIRECRAWL_API_KEY: "test", SERPER_API_KEY: "k-test", SERPER_MAX_PAGES: "1" });
    _setSerperFetch((async () => new Response(JSON.stringify({ ll: "@30.26720,-97.74310,13z", places: LISTINGS }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch);
    db = await useTempDb();
    clearRobotsCache();
    callStructured.mockReset();
    scrapeCalls.length = 0;
  });
  afterEach(() => _setSerperFetch(null));

  it("runs discovery (Google Maps through the injected transport) and records search stats", async () => {
    const id = newId();
    await db.insert(searches).values({ id, name: "Austin", industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 10, providers: ["google_maps"], requireWebsite: false, autoInvestigate: false }).run();
    await enqueueJob("discover_search", { searchId: id });
    expect(await drainQueue()).toBe(1);
    const s = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
    expect(s.status).toBe("done");
    expect(s.stats?.created).toBe(4);
    // Everything the run learned is kept: per-source counts/timings and an ordered log.
    expect(s.stats?.providerResults.google_maps?.durationMs).toBeGreaterThanOrEqual(0);
    expect(s.stats?.candidates).toBe(4);
    expect(s.stats?.durationMs).toBeGreaterThanOrEqual(0);
    expect(s.stats?.notes?.some((n) => /Ranking: 4 unique business/.test(n))).toBe(true);
    expect(s.stats?.notes?.at(-1)).toMatch(/4 result\(s\) listed and saved/);
    const { exportSearchCsv } = await import("@/lib/queries");
    const csv = (await exportSearchCsv(id))!.csv.split("\n");
    expect(csv[0]).toContain("lead_score");
    expect(csv).toHaveLength(5);
    expect(await db.select().from(prospects).all()).toHaveLength(4);
    expect(await db.select().from(jobs).where(eq(jobs.type, "investigate_business")).all()).toHaveLength(0);
  });

  it("investigates a website: grounded facts and observations, ONE consolidated opportunity, qualification, pipeline", async () => {
    const bizId = newId();
    await db.insert(businesses).values({ id: bizId, name: "Barton Auto Care", nameNormalized: "barton auto care", industry: "auto_repair", website: "https://bartonauto.example", websiteDomain: "bartonauto.example", city: "Austin", region: "TX", country: "US", firstProvider: "csv", reviewCount: 120, rating: 4.7 }).run();
    callStructured.mockImplementationOnce(async () =>
      fake({
        facts: [
          { key: "summary", status: "verified", value: "Family-owned auto repair shop", evidence_quote: "Family-owned since 1998", source_url: "https://bartonauto.example" },
          { key: "estimate_policy", status: "verified", value: "free_estimates", evidence_quote: "Free estimates on brakes", source_url: "https://bartonauto.example" },
          { key: "warranty", status: "verified", value: "24 month / 24,000 mile", evidence_quote: "24 month / 24,000 mile warranty on repairs", source_url: "https://bartonauto.example/services" },
          { key: "shop_management_tool", status: "verified", value: "Tekmetric", evidence_quote: "Powered by Tekmetric", source_url: "https://bartonauto.example" }, // ungrounded -> rejected; detected not_found stays
          { key: "maintenance_plans", status: "not_found", value: "", evidence_quote: "", source_url: "" },
        ],
        observations: [
          { ref: "o1", kind: "offering", statement: "They welcome fleet accounts from local businesses.", evidence_quote: "Fleet accounts welcome for local businesses", source_url: "https://bartonauto.example" },
          { ref: "o2", kind: "limitation", statement: "Quotes are faxed.", evidence_quote: "We fax every quote", source_url: "https://bartonauto.example" }, // not on the page -> rejected
        ],
        opportunities: [
          OPP,
          { ...OPP, role: "secondary", category: "fleet_b2b", title: "Fleet portal", components: [], supporting_fact_keys: [] }, // nothing supports it -> dropped
          { ...OPP, role: "secondary", category: "reminder_automation", title: "Service reminders", components: [], supporting_fact_keys: ["maintenance_plans"] }, // a gap only -> not an alternative worth offering
          { ...OPP, role: "secondary", scope: "new_for_customers", category: "fleet_b2b", title: "Fleet accounts online", components: [], supporting_fact_keys: ["o1", "warranty", "maintenance_plans"] }, // two verified facts of its own -> kept
        ],
        verdict: "opportunity",
        verdict_reason: "Phone-only booking and free estimates.",
      }),
    );
    await enqueueInvestigation(bizId);
    expect(await drainQueue(["investigate_business"])).toBe(1);
    // The model was told what the listing says and which rule patterns matched, as candidates.
    const userMessage = (callStructured.mock.calls[0][0] as { user: string }).user;
    expect(userMessage).toContain("4.7 rating from 120 reviews");
    expect(userMessage).toMatch(/Patterns a fixed rule set matched[\s\S]*\[estimate_quote_followup\]/);

    const biz = (await db.select().from(businesses).where(eq(businesses.id, bizId)).get())!;
    expect(biz.status).toBe("profiled");
    expect(biz.verdict).toBe("qualified");
    expect(biz.verdictReasons?.[0]).toContain("Estimate-to-booking flow");
    expect(biz.statusMessage).toBe("Qualified: Estimate-to-booking flow");
    expect(biz.summary).toBe("Family-owned auto repair shop");
    expect(biz).toMatchObject({ email: "service@bartonauto.example", emailSource: "site", emailSourceUrl: "https://bartonauto.example", emailStatus: "unchecked" });
    expect(biz.priority).toBeGreaterThan(0);
    const f = Object.fromEntries((await db.select().from(facts).where(eq(facts.businessId, bizId)).all()).map((x) => [x.key, x]));
    expect(f.booking_method).toMatchObject({ status: "verified", value: "mixed", method: "detected" });
    expect(f.website_platform).toMatchObject({ status: "verified", value: "Wix" });
    expect(f.estimate_policy).toMatchObject({ status: "verified", value: "free_estimates", method: "detected" }); // text cue detects it before the model
    expect(f.fleet_program).toMatchObject({ status: "verified", method: "detected" });
    expect(f.shop_management_tool.status).toBe("not_found");
    expect(f.maintenance_plans.status).toBe("not_found");
    expect(f.contact_form.status).toBe("verified");
    expect(f.customer_portal.status).toBe("not_found");
    const obs = await db.select().from(observations).where(eq(observations.businessId, bizId)).all();
    expect(obs.map((o) => [o.ref, o.kind])).toEqual([["o1", "offering"]]);
    const all = (await db.select().from(opportunities).where(eq(opportunities.businessId, bizId)).all()).sort((a, b) => a.rank - b.rank);
    // One primary with its supported components; the unsupported idea is gone; no rule pattern is kept beside the model's result.
    expect(all.map((o) => [o.role, o.source, o.title])).toEqual([["primary", "ai", "Estimate-to-booking flow"], ["secondary", "ai", "Fleet accounts online"]]);
    expect(all[0].components?.map((c) => c.name)).toEqual(["Online requests", "Estimate follow-up"]);
    expect(all[0].supportingFactKeys).toEqual(["estimate_policy", "booking_method", "shop_management_tool", "contact_form", "o1"]);
    expect(all[0].whyRelevant).toContain("free estimates");
    expect(all[0].promptVersion).toBe("research-5");
    expect(all.map((o) => o.scope)).toEqual(["internal", "new_for_customers"]); // the kind of idea is stored with it
    expect(all[1].confidenceScore).toBeGreaterThanOrEqual(50); // an alternative stands on verified facts of its own
    expect(biz.bestConfidence).toBe(all[0].confidenceScore);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, bizId)).get())!.stage).toBe("qualified");
    const inv = (await db.select().from(investigations).where(eq(investigations.businessId, bizId)).get())!;
    expect(inv).toMatchObject({ verdict: "qualified", promptVersion: "research-5", factsRejected: 2, creditsUsed: 4 });
    // Qualified with a usable address: the email is queued without anyone asking (and not written twice).
    const queued = await db.select().from(jobs).where(eq(jobs.type, "generate_outreach")).all();
    expect(queued.map((j) => [j.status, j.payload.businessId, j.payload.step])).toEqual([["queued", bizId, 0]]);
    expect(await db.select().from(outreachDrafts).all()).toHaveLength(0);
  });

  it("the model's no is final: rule patterns never override it; weak support needs review; a later no moves the business back", async () => {
    const bizId = newId();
    await db.insert(businesses).values({ id: bizId, name: "Quiet Shop", nameNormalized: "quiet shop", industry: "auto_repair", website: "https://bartonauto.example", websiteDomain: "bartonauto.example", firstProvider: "csv" }).run();
    // 1. Supported only by something not found on the site: a hypothesis to review, not a qualified lead.
    callStructured.mockImplementationOnce(async () => fake({ facts: [], observations: [], opportunities: [{ ...OPP, components: [], supporting_fact_keys: ["booking_tool"] }], verdict: "opportunity", verdict_reason: "Maybe." }));
    await enqueueInvestigation(bizId);
    await drainQueue();
    let biz = (await db.select().from(businesses).where(eq(businesses.id, bizId)).get())!;
    expect(biz.verdict).toBe("needs_review");
    expect(biz.verdictReasons?.join(" ")).toMatch(/rests on 0 verified observation\(s\) and 1 thing\(s\) not found/);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, bizId)).get())!.stage).toBe("discovered");

    // 2. Well supported: qualified and moved forward.
    callStructured.mockImplementationOnce(async () => fake({ facts: [], observations: [], opportunities: [OPP], verdict: "opportunity", verdict_reason: "Yes." }));
    await enqueueInvestigation(bizId, "reanalyze");
    await drainQueue();
    expect((await db.select().from(businesses).where(eq(businesses.id, bizId)).get())!.verdict).toBe("qualified");
    expect((await db.select().from(prospects).where(eq(prospects.businessId, bizId)).get())!.stage).toBe("qualified");

    // 3. The model says no while several rule patterns match the same facts: not a fit, nothing kept, back out of "qualified".
    callStructured.mockImplementationOnce(async () => fake({ facts: [], observations: [], opportunities: [], verdict: "no_opportunity", verdict_reason: "Nothing compelling: a mature shop with its own stack." }));
    await enqueueInvestigation(bizId, "reanalyze");
    await drainQueue();
    biz = (await db.select().from(businesses).where(eq(businesses.id, bizId)).get())!;
    expect(biz.status).toBe("profiled");
    expect(biz.verdict).toBe("not_a_fit");
    expect(biz.verdictReasons).toEqual(["Nothing compelling: a mature shop with its own stack."]);
    expect(biz.priority).toBeNull();
    expect(await db.select().from(opportunities).where(eq(opportunities.businessId, bizId)).all()).toHaveLength(0);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, bizId)).get())!.stage).toBe("discovered");
  });

  it("stops after the homepage and contact page when no public email exists: no further credits, no model call, earlier research kept", async () => {
    const id = newId();
    await db.insert(businesses).values({ id, name: "Modern Shop", nameNormalized: "modern shop", industry: "auto_repair", website: "https://modern.example", websiteDomain: "modern.example", firstProvider: "csv" }).run();
    await enqueueInvestigation(id);
    await drainQueue();
    let b = (await db.select().from(businesses).where(eq(businesses.id, id)).get())!;
    expect(b).toMatchObject({ status: "profiled", verdict: "no_contact", email: null });
    expect(b.verdictReasons?.[0]).toMatch(/No public email address was found/);
    expect(scrapeCalls).toEqual(["https://modern.example"]);
    expect(callStructured).not.toHaveBeenCalled();
    expect((await db.select().from(facts).where(eq(facts.businessId, id)).all()).some((f) => f.key === "booking_tool" && f.status === "verified")).toBe(true); // detected facts are still recorded
    expect((await db.select().from(investigations).where(eq(investigations.businessId, id)).get())!).toMatchObject({ verdict: "no_contact", creditsUsed: 1 });
    // The operator adds an address: the two probe pages are not mistaken for a full crawl, and the model now runs.
    await db.update(businesses).set({ email: "owner@modern.example", emailSource: "manual" }).where(eq(businesses.id, id)).run();
    callStructured.mockImplementationOnce(async () => fake({ facts: [], observations: [], opportunities: [], verdict: "no_opportunity", verdict_reason: "Modern stack already in place." }));
    await enqueueInvestigation(id);
    await drainQueue();
    b = (await db.select().from(businesses).where(eq(businesses.id, id)).get())!;
    expect(b).toMatchObject({ verdict: "not_a_fit", email: "owner@modern.example", emailSource: "manual" });
    expect(scrapeCalls).toHaveLength(2);
    expect(callStructured).toHaveBeenCalledTimes(1);
    // With the gate switched off the business is researched even without an address.
    resetEnv({ FIRECRAWL_API_KEY: "test", RESEARCH_REQUIRE_EMAIL: "false" });
    await db.update(businesses).set({ email: null }).where(eq(businesses.id, id)).run();
    await enqueueInvestigation(id, "recrawl");
    await drainQueue();
    expect((await db.select().from(businesses).where(eq(businesses.id, id)).get())!.verdict).not.toBe("no_contact");
  });

  it("without an API key the investigation still profiles detected facts and groups the rule patterns into one idea that needs review", async () => {
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
    expect(g.verdict).toBe("needs_review");
    expect(g.verdictReasons?.join(" ")).toMatch(/Only fixed rule patterns produced this idea/);
    expect(g.summary).toBeNull(); // no meta description on the test site; no model → no summary is invented
    const gf = await db.select().from(facts).where(eq(facts.businessId, good)).all();
    expect(gf.some((f) => f.key === "booking_method" && f.status === "verified")).toBe(true);
    expect(gf.every((f) => f.method === "detected")).toBe(true);
    const gopps = (await db.select().from(opportunities).where(eq(opportunities.businessId, good)).all()).sort((a, b) => a.rank - b.rank);
    expect(gopps.every((o) => o.source === "rules")).toBe(true);
    expect(gopps.map((o) => o.role)).toEqual(["primary", "secondary"]);
    expect(gopps[0].title).toBe("Lead intake, booking and quote follow-up in one flow");
    expect(gopps[0].components?.length).toBe(2);
    expect(gopps[0].category).toBe("estimate_quote_followup");
    expect(gopps[1].category).toBe("fleet_b2b");
    expect((await db.select().from(prospects).where(eq(prospects.businessId, good)).get())!.stage).toBe("discovered");
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
    const all = CANDIDATES;
    const withoutPhone = all.filter((c) => !c.phone).length;
    const withoutSite = all.filter((c) => c.phone && !c.website).length;
    expect(withoutSite).toBeGreaterThan(0);
    const first = newId();
    await db.insert(searches).values({ id: first, name: "First", industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 10, providers: ["google_maps"], requireWebsite: true, autoInvestigate: false, filters: { segments: [], areaMode: "area", radiusKm: 15, requirePhone: true, excludeChains: true, skipKnown: false, minLeadScore: 0, autoInvestigateLimit: null } }).run();
    await enqueueJob("discover_search", { searchId: first });
    await drainQueue();
    const s1 = (await db.select().from(searches).where(eq(searches.id, first)).get())!;
    expect(s1.stats?.skippedNoPhone).toBe(withoutPhone);
    expect(s1.stats?.skippedNoWebsite).toBe(withoutSite);
    expect(s1.stats?.total).toBe(all.length - withoutPhone - withoutSite);

    const second = newId();
    await db.insert(searches).values({ id: second, name: "Second", industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 10, providers: ["google_maps"], requireWebsite: false, autoInvestigate: true, filters: { segments: [], areaMode: "area", radiusKm: 15, requirePhone: false, excludeChains: true, skipKnown: true, minLeadScore: 0, autoInvestigateLimit: 1 } }).run();
    await enqueueJob("discover_search", { searchId: second });
    await drainQueue(["discover_search"]);
    const s2 = (await db.select().from(searches).where(eq(searches.id, second)).get())!;
    expect(s2.stats?.skippedKnown).toBe(all.length - withoutPhone - withoutSite);
    expect(s2.stats?.total).toBe(withoutPhone + withoutSite); // only the previously unseen records are listed
    expect(s2.stats?.queuedForInvestigation).toBe(1); // auto-investigate limit 1: the best unseen lead is queued
  });

  it("ranks candidates by lead score before applying the result cap", async () => {
    const id = newId();
    await db.insert(searches).values({ id, name: "Top 2", industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 2, providers: ["google_maps"], requireWebsite: false, autoInvestigate: false }).run();
    await enqueueJob("discover_search", { searchId: id });
    await drainQueue(["discover_search"]);
    const s = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
    expect(s.stats?.total).toBe(2);
    const listed = await db.select({ name: businesses.name, leadScore: businesses.leadScore }).from(searchResults).innerJoin(businesses, eq(searchResults.businessId, businesses.id)).where(eq(searchResults.searchId, id)).all();
    // The two shops with website + phone + street address outrank the one without a street and the one without a website.
    expect(listed.map((b) => b.name).sort()).toEqual(["Barton Creek Auto Care", "Northside Transmission & Brake"]);
  });

  it("lists businesses with server-side paging, sorting and date ranges", async () => {
    const { listBusinesses, listSearches } = await import("@/lib/queries");
    const mk = (name: string, createdAt: string, priority: number | null) => db.insert(businesses).values({ id: newId(), name, nameNormalized: name.toLowerCase(), industry: "auto_repair", firstProvider: "csv", createdAt, updatedAt: createdAt, priority, status: priority != null ? "profiled" : "new", verdict: priority != null ? "qualified" : null, investigatedAt: priority != null ? createdAt : null }).run();
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
