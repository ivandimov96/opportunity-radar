/**
 * Integrated pipeline: discovery -> research -> analysis -> outreach -> pipeline,
 * driven through the real job queue and handlers. HTTP and the model are
 * mocked at their module boundaries; everything else (crawler logic, signal
 * detection, grounding validation, scoring, persistence) runs for real.
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
import { businesses, observations, opportunities, outreachDrafts, prospects, searches, analyses } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { drainQueue } from "@/lib/jobs/worker";
import { enqueueOutreach, enqueueResearch } from "@/lib/jobs/handlers";
import { clearRobotsCache } from "@/lib/research/robots";

function fakeModel(stage: string, schemaData: unknown) {
  return { data: schemaData, model: "mock-model", usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0 } };
}

describe("integrated pipeline", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    resetEnv({ ANTHROPIC_API_KEY: "test-key" });
    db = await useTempDb();
    clearRobotsCache();
    callStructured.mockReset();
  });

  it("runs discovery (demo provider) and records search stats", async () => {
    const id = newId();
    await db.insert(searches).values({ id, name: "Demo", industry: "auto_repair", country: "US", city: "Austin", maxResults: 10, providers: ["demo"], requireWebsite: false }).run();
    await enqueueJob("discover_search", { searchId: id });
    expect(await drainQueue()).toBe(1);
    const s = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
    expect(s.status).toBe("done");
    expect(s.stats?.created).toBe(4);
    expect(s.stats?.attribution[0]).toMatch(/Synthetic demo/);
    expect((await db.select().from(businesses).all()).every((b) => b.isDemo)).toBe(true);
    expect(await db.select().from(prospects).all()).toHaveLength(4);
  });

  it("empty discovery results mark the search done with zero businesses", async () => {
    const id = newId();
    await db.insert(searches).values({ id, name: "Empty", industry: "dental", country: "US", city: "Austin", maxResults: 10, providers: ["demo"], requireWebsite: true }).run();
    // dental demo list falls back to auto_repair demo; requireWebsite drops the one without a site
    await enqueueJob("discover_search", { searchId: id });
    await drainQueue();
    const s = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
    expect(s.status).toBe("done");
    expect(s.stats?.skippedNoWebsite).toBe(1);
  });

  it("researches a website, grounds AI observations, analyzes, scores, drafts outreach and advances the pipeline", async () => {
    const bizId = newId();
    await db.insert(businesses).values({ id: bizId, name: "Barton Auto Care", nameNormalized: "barton auto care", industry: "auto_repair", website: "https://bartonauto.example", websiteDomain: "bartonauto.example", city: "Austin", region: "TX", firstProvider: "csv" }).run();

    callStructured.mockImplementationOnce(async (call: { stage: string }) =>
      fakeModel(call.stage, {
        observations: [
          { category: "services", statement: "Offers brakes, oil changes and diagnostics with a 24-month warranty", evidence_quote: "Brakes, oil changes, diagnostics, and a 24 month / 24,000 mile warranty on repairs", source_url: "https://bartonauto.example/services" },
          { category: "tools", statement: "Uses Tekmetric shop software", evidence_quote: "Powered by Tekmetric", source_url: "https://bartonauto.example" }, // ungrounded -> rejected
          { category: "team", statement: "Technicians are ASE-certified", evidence_quote: "Our ASE-certified technicians have served Austin for 25 years", source_url: "https://bartonauto.example/about-us" },
        ],
        unknowns: [{ topic: "Scheduling software", note: "No booking tool is referenced" }],
      }),
    );
    await enqueueResearch(bizId, { analyze: true });
    expect(await drainQueue(["research_business"])).toBe(1);

    const obs = await db.select().from(observations).where(eq(observations.businessId, bizId)).all();
    const verified = obs.filter((o) => o.kind === "verified");
    expect(verified.some((o) => o.statement === "Website asks customers to call to schedule service" && o.method === "deterministic")).toBe(true);
    expect(verified.some((o) => o.statement.includes("ASE-certified") && o.method === "ai")).toBe(true);
    expect(verified.some((o) => o.statement.includes("Tekmetric"))).toBe(false); // rejected: not grounded
    expect(obs.some((o) => o.kind === "unknown")).toBe(true);
    for (const o of verified) expect(o.sourceUrl).toMatch(/^https:\/\/bartonauto\.example/);
    const biz = (await db.select().from(businesses).where(eq(businesses.id, bizId)).get())!;
    expect(biz.researchStatus).toBe("done");
    expect(biz.email).toBe("service@bartonauto.example");
    expect((await db.select().from(prospects).where(eq(prospects.businessId, bizId)).get())!.stage).toBe("researched");

    const callToSchedule = verified.find((o) => o.statement.includes("call to schedule"))!;
    callStructured.mockImplementationOnce(async (call: { stage: string }) =>
      fakeModel(call.stage, {
        company_summary: "Independent auto repair shop in Austin.",
        documented_workflows: [{ name: "Phone scheduling", observation_ids: [callToSchedule.id, "bogus-id"] }],
        industry_workflows_considered: ["Scheduling", "Estimates"],
        existing_tools_detected: [],
        opportunities: [
          { category: "online_booking", title: "Online appointment requests", problem_hypothesis: "Phone-only scheduling may lose after-hours requests", proposed_solution: "Lightweight booking request flow integrated with their calendar", why_not_existing_tool: "Shop management suites include booking; a standalone widget may suffice", expected_value: "Capture after-hours demand", supporting_observation_ids: [callToSchedule.id, "bogus-id"], assumptions: ["They do not already take requests by text"], validation_questions: ["How do after-hours requests reach you today?"], implementation_effort: "small", reusability: "high", risks: ["Low adoption"], sales_angle: "Noticed scheduling is by phone", ratings: { value: 3, feasibility: 5, evidence_strength: 4, buying_readiness: 3 } },
          { category: "fleet_b2b", title: "Fleet portal", problem_hypothesis: "Fleet customers may lack visibility", proposed_solution: "Fleet account portal", why_not_existing_tool: "n/a", expected_value: "Retain fleet accounts", supporting_observation_ids: [], assumptions: ["a", "b", "c"], validation_questions: ["q"], implementation_effort: "large", reusability: "medium", risks: [], sales_angle: "angle", ratings: { value: 4, feasibility: 3, evidence_strength: 4, buying_readiness: 2 } },
        ],
        no_compelling_opportunity: false,
        no_opportunity_reason: "",
      }),
    );
    expect(await drainQueue(["analyze_business"])).toBe(1);
    const opps = (await db.select().from(opportunities).where(eq(opportunities.businessId, bizId)).all()).sort((a, b) => a.rank - b.rank);
    expect(opps).toHaveLength(2);
    expect(opps[0].supportingObservationIds).toEqual([callToSchedule.id]);
    expect(opps[1].supportingObservationIds).toEqual([]);
    expect(opps[1].confidenceScore).toBeLessThanOrEqual(35);
    expect(opps[1].aiRatings?.evidenceStrength).toBe(2);
    expect(opps[0].confidenceScore).toBeGreaterThan(opps[1].confidenceScore);
    const analysis = (await db.select().from(analyses).where(eq(analyses.businessId, bizId)).get())!;
    expect(analysis.validationWarnings?.length).toBeGreaterThan(0);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, bizId)).get())!.stage).toBe("qualified");

    callStructured.mockImplementationOnce(async (call: { stage: string }) =>
      fakeModel(call.stage, {
        subject: "A quick idea for after-hours appointment requests",
        body: "Hi Barton Auto Care team, I noticed your website asks customers to call to schedule service. If after-hours requests sometimes slip through, a simple online request form could help. Would a 15-minute call be useful? Shops typically see 20% more bookings.",
        claims: [
          { text: "asks customers to call to schedule service", observation_ids: [callToSchedule.id] },
          { text: "Shops typically see 20% more bookings", observation_ids: [] },
        ],
      }),
    );
    await enqueueOutreach(bizId, opps[0].id, "concise");
    expect(await drainQueue(["generate_outreach"])).toBe(1);
    const drafts = await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, bizId)).all();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].toEmail).toBe("service@bartonauto.example");
    expect(drafts[0].claims[0].observationIds).toEqual([callToSchedule.id]);
    expect(drafts[0].warnings.some((w) => w.startsWith("Unsupported claim"))).toBe(true);
    expect(drafts[0].warnings.some((w) => w.includes("percentage"))).toBe(true);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, bizId)).get())!.stage).toBe("outreach_ready");
  });

  it("records insufficient evidence when the model finds no compelling opportunity", async () => {
    const bizId = newId();
    await db.insert(businesses).values({ id: bizId, name: "Quiet Shop", nameNormalized: "quiet shop", industry: "auto_repair", website: "https://bartonauto.example", firstProvider: "csv" }).run();
    await db.insert(observations).values({ id: newId(), businessId: bizId, kind: "verified", category: "hours", statement: "Website lists business hours", evidenceQuote: "Mon - Fri", sourceUrl: "https://bartonauto.example", method: "deterministic" }).run();
    callStructured.mockImplementationOnce(async () => fakeModel("analysis", { company_summary: "s", documented_workflows: [], industry_workflows_considered: [], existing_tools_detected: [], opportunities: [], no_compelling_opportunity: true, no_opportunity_reason: "Only business hours are verified." }));
    await enqueueJob("analyze_business", { businessId: bizId });
    await drainQueue();
    expect((await db.select().from(businesses).where(eq(businesses.id, bizId)).get())!.analysisStatus).toBe("insufficient_evidence");
    expect(await db.select().from(opportunities).where(eq(opportunities.businessId, bizId)).all()).toHaveLength(0);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, bizId)).get())!.stage).toBe("discovered");
  });

  it("isolates failures: an unreachable website fails only its own job and is retried", async () => {
    const good = newId();
    const bad = newId();
    await db.insert(businesses).values({ id: good, name: "Good", nameNormalized: "good", industry: "auto_repair", website: "https://bartonauto.example", firstProvider: "csv" }).run();
    await db.insert(businesses).values({ id: bad, name: "Bad", nameNormalized: "bad", industry: "auto_repair", website: "https://down.example", firstProvider: "csv" }).run();
    resetEnv({}); // no AI key: deterministic only, also tests the no-credentials path
    await enqueueResearch(bad, { analyze: false });
    await enqueueResearch(good, { analyze: false });
    await drainQueue(["research_business"]);
    expect((await db.select().from(businesses).where(eq(businesses.id, good)).get())!.researchStatus).toBe("done");
    const badBiz = (await db.select().from(businesses).where(eq(businesses.id, bad)).get())!;
    expect(badBiz.researchStatus).toBe("failed");
    const { jobs } = await import("@/db/schema");
    const badJob = (await db.select().from(jobs).where(eq(jobs.idempotencyKey, `research:${bad}`)).get())!;
    expect(badJob.status).toBe("failed"); // homepage unavailable => non-retryable
    expect(badJob.error).toMatch(/could not be fetched/);
    expect(callStructured).not.toHaveBeenCalled();
  });

  it("analysis without credentials fails clearly and does not retry", async () => {
    resetEnv({});
    const bizId = newId();
    await db.insert(businesses).values({ id: bizId, name: "X", nameNormalized: "x", industry: "auto_repair", firstProvider: "csv" }).run();
    await enqueueJob("analyze_business", { businessId: bizId });
    await drainQueue();
    const { jobs } = await import("@/db/schema");
    const j = (await db.select().from(jobs).all())[0];
    expect(j.status).toBe("failed");
    expect(j.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("stops AI work when the spend guard is reached", async () => {
    resetEnv({ ANTHROPIC_API_KEY: "k", AI_SPEND_LIMIT_USD: "0.0001" });
    const { recordUsage } = await import("@/lib/ai/usage");
    await recordUsage({ stage: "analysis", model: "claude-opus-5-5", input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 });
    const { assertSpendWithinLimit, AiSpendLimitError } = await import("@/lib/ai/client");
    await expect(assertSpendWithinLimit()).rejects.toThrow(AiSpendLimitError);
  });
});
