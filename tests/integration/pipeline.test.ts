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
};

vi.mock("@/lib/research/fetcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/research/fetcher")>();
  return {
    ...orig,
    safeFetch: vi.fn(async (url: string) => {
      const key = url.replace(/\/$/, "");
      if (key.endsWith("/robots.txt")) return { url, finalUrl: url, status: 404, contentType: "text/plain", body: "", bytes: 0, truncated: false };
      if (key === "https://down.example") throw new Error("fetch failed: ECONNREFUSED");
      const body = SITE[key];
      if (!body) return { url, finalUrl: url, status: 404, contentType: "text/html", body: "", bytes: 0, truncated: false };
      return { url, finalUrl: url, status: 200, contentType: "text/html", body, bytes: body.length, truncated: false };
    }),
  };
});

const callStructured = vi.fn();
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...orig, callStructured: (...args: unknown[]) => callStructured(...args) };
});

import { useTempDb, resetEnv } from "../helpers";
import { businesses, facts, jobs, opportunities, outreachDrafts, prospects, searches } from "@/db/schema";
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
    resetEnv({ ANTHROPIC_API_KEY: "test-key" });
    db = await useTempDb();
    clearRobotsCache();
    callStructured.mockReset();
  });

  it("runs discovery (demo provider) and records search stats without investigating demo records", async () => {
    const id = newId();
    await db.insert(searches).values({ id, name: "Demo", industry: "auto_repair", country: "US", city: "Austin", maxResults: 10, providers: ["demo"], requireWebsite: false, autoInvestigate: true }).run();
    await enqueueJob("discover_search", { searchId: id });
    expect(await drainQueue()).toBe(1);
    const s = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
    expect(s.status).toBe("done");
    expect(s.stats?.created).toBe(4);
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
    expect(f.estimate_policy).toMatchObject({ status: "verified", value: "free_estimates", method: "ai" });
    expect(f.shop_management_tool.status).toBe("not_found");
    expect(f.maintenance_plans.status).toBe("not_found");
    expect(f.contact_form.status).toBe("verified");
    const opps = (await db.select().from(opportunities).where(eq(opportunities.businessId, bizId)).all()).sort((a, b) => a.rank - b.rank);
    expect(opps).toHaveLength(2);
    expect(opps[0].supportingFactKeys).toEqual(["estimate_policy", "booking_method", "shop_management_tool"]);
    expect(opps[1].supportingFactKeys).toEqual([]);
    expect(opps[1].confidenceScore).toBeLessThanOrEqual(35);
    expect(opps[0].confidenceScore).toBeGreaterThan(opps[1].confidenceScore);
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

  it("records a no-opportunity verdict explicitly", async () => {
    const bizId = newId();
    await db.insert(businesses).values({ id: bizId, name: "Quiet Shop", nameNormalized: "quiet shop", industry: "auto_repair", website: "https://bartonauto.example", firstProvider: "csv" }).run();
    callStructured.mockImplementationOnce(async () => fake({ facts: [], workflows: [], opportunities: [], verdict: "no_opportunity", verdict_reason: "Nothing compelling." }));
    await enqueueInvestigation(bizId);
    await drainQueue();
    const biz = (await db.select().from(businesses).where(eq(businesses.id, bizId)).get())!;
    expect(biz.status).toBe("profiled");
    expect(biz.verdict).toBe("no_opportunity");
    expect(await db.select().from(opportunities).where(eq(opportunities.businessId, bizId)).all()).toHaveLength(0);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, bizId)).get())!.stage).toBe("lead");
  });

  it("without an API key the investigation still profiles detected facts and sets verdict needs_ai", async () => {
    resetEnv({});
    const good = newId();
    const bad = newId();
    await db.insert(businesses).values({ id: good, name: "Good", nameNormalized: "good", industry: "auto_repair", website: "https://bartonauto.example", firstProvider: "csv" }).run();
    await db.insert(businesses).values({ id: bad, name: "Bad", nameNormalized: "bad", industry: "auto_repair", website: "https://down.example", firstProvider: "csv" }).run();
    await enqueueInvestigation(bad);
    await enqueueInvestigation(good);
    await drainQueue(["investigate_business"]);
    const g = (await db.select().from(businesses).where(eq(businesses.id, good)).get())!;
    expect(g.status).toBe("profiled");
    expect(g.verdict).toBe("needs_ai");
    expect((await db.select().from(facts).where(eq(facts.businessId, good)).all()).some((f) => f.key === "booking_method" && f.status === "verified")).toBe(true);
    const b = (await db.select().from(businesses).where(eq(businesses.id, bad)).get())!;
    expect(b.status).toBe("failed");
    expect(b.statusMessage).toMatch(/could not be fetched/);
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
});
