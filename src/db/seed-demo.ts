/**
 * Seeds clearly-labeled synthetic demo data so the complete workflow can be
 * explored without credentials. Idempotent: re-running replaces demo records.
 * Nothing here is real company data; domains use the reserved .example TLD.
 */
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { analyses, businesses, observations, opportunities, outreachDrafts, prospects, researchRuns, searchResults, searches } from "./schema";
import { DEMO_BUSINESSES } from "@/lib/discovery/demo";
import { upsertCandidate } from "@/lib/discovery/dedupe";
import { nowIso, stableId } from "@/lib/ids";
import { ensureProspect, logActivity } from "@/lib/pipeline/prospects";
import { scoreOpportunity } from "@/lib/scoring/score";
import type { OpportunityCategory } from "@/lib/industries";

export async function seedDemo() {
  const db = await getDb();
  // Remove previous demo data (cascades through FKs).
  for (const b of await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.isDemo, true)).all()) await db.delete(businesses).where(eq(businesses.id, b.id)).run();
  await db.delete(searches).where(eq(searches.isDemo, true)).run();

  const searchId = stableId("search:auto_repair:austin");
  await db.insert(searches)
    .values({ id: searchId, name: "DEMO — Auto repair, Austin TX (synthetic)", industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 10, providers: ["demo"], status: "done", isDemo: true, stats: { providerResults: { demo: { found: 4 } }, created: 4, merged: 0, skippedNoWebsite: 0, total: 4, attribution: ["Synthetic demo data (not a real business)"] } })
    .run();

  const list = DEMO_BUSINESSES.auto_repair;
  const ids: string[] = [];
  for (const [i, c] of list.entries()) {
    const { businessId } = await upsertCandidate(db, c, { industry: "auto_repair", searchId, isDemo: true, fixedId: stableId(`business:${c.providerId}`) });
    ids.push(businessId);
    await db.insert(searchResults).values({ searchId, businessId, rank: i + 1, wasNew: true }).onConflictDoNothing().run();
    await ensureProspect(businessId);
  }

  // --- Business 1: rich findings + two opportunities + a draft -------------
  const b1 = ids[0];
  const site1 = "https://barton-creek-auto-care.example";
  const run1 = stableId("run:demo-auto-1");
  await db.insert(researchRuns).values({ id: run1, businessId: b1, status: "done", finishedAt: nowIso(), pagesFetched: 4, pagesFailed: 0, aiObservationsAccepted: 3, aiObservationsRejected: 1, notes: ["DEMO: synthetic research run", "Rejected 1 AI observation whose evidence could not be verified verbatim"] }).run();
  let obsN = 0;
  const obs = async (kind: "verified" | "unknown", category: string, statement: string, quote: string | null, url: string | null, method: string) => {
    const id = stableId(`obs:demo-auto-1:${++obsN}`);
    await db.insert(observations).values({ id, businessId: b1, researchRunId: run1, kind, category, statement, evidenceQuote: quote, sourceUrl: url, method, confidence: 0.9 }).run();
    return id;
  };
  const o1 = await obs("verified", "booking", "Website asks customers to call to schedule service", "Call us today to schedule your appointment — we'll get you in fast.", `${site1}/`, "demo");
  const o2 = await obs("verified", "pricing", "Website advertises free estimates or quotes", "Free estimates on all brake and suspension work.", `${site1}/services`, "demo");
  const o3 = await obs("verified", "services", "Website mentions fleet or commercial accounts", "Fleet accounts welcome — ask about our commercial fleet maintenance program.", `${site1}/fleet`, "demo");
  const o4 = await obs("verified", "tools", "Website integrates Wix (website builder/CMS)", "Resource loaded from static.parastorage.com", `${site1}/`, "demo");
  const o5 = await obs("verified", "contact", "Public email address listed: service@barton-creek-auto-care.example", "service@barton-creek-auto-care.example", `${site1}/contact`, "demo");
  await obs("verified", "services", "Offers a 24-month / 24,000-mile warranty on repairs", "All repairs are backed by our 24 month / 24,000 mile nationwide warranty.", `${site1}/services`, "demo");
  await obs("verified", "reviews", "Website displays customer testimonials", "What our customers say: \"Honest, fast, and fairly priced.\"", `${site1}/`, "demo");
  await obs("unknown", "other", "Scheduling software: the site does not name any booking or shop-management tool", null, null, "demo");
  await obs("unknown", "other", "Estimate follow-up: no public information on how declined or pending estimates are followed up", null, null, "demo");
  await db.update(businesses).set({ email: "service@barton-creek-auto-care.example", researchStatus: "done", analysisStatus: "done", lastResearchedAt: nowIso() }).where(eq(businesses.id, b1)).run();

  const a1 = stableId("analysis:demo-auto-1");
  await db.insert(analyses)
    .values({ id: a1, businessId: b1, researchRunId: run1, status: "done", model: "demo (no model call)", companySummary: "DEMO: An independent auto repair shop offering brake, suspension and general repair with fleet accounts. Scheduling is described as phone-based; estimates are free; a warranty and testimonials are promoted.", documentedWorkflows: [{ name: "Phone-based appointment scheduling", observationIds: [o1] }, { name: "Free estimate intake", observationIds: [o2] }, { name: "Fleet / commercial accounts", observationIds: [o3] }], industryWorkflows: ["Scheduling", "Estimate approval", "Fleet account management", "Maintenance reminders"], existingTools: ["Wix website builder"], noCompellingOpportunity: false, validationWarnings: [] })
    .run();

  const mk = async (rank: number, category: OpportunityCategory, fields: Record<string, unknown>, ratings: { value: number; feasibility: number; evidenceStrength: number; buyingReadiness: number }, supporting: string[], effort: "small" | "medium" | "large", reuse: "low" | "medium" | "high", assumptions: string[]) => {
    const score = scoreOpportunity({ category, aiRatings: ratings, implementationEffort: effort, reusability: reuse, supportingObservationCount: supporting.length, totalVerifiedObservations: 7, pagesResearched: 4, assumptionCount: assumptions.length, contact: { email: true, phone: true, contactForm: true } });
    const id = stableId(`opp:demo-auto-1:${rank}`);
    await db.insert(opportunities)
      .values({ id, analysisId: a1, businessId: b1, category, rank, supportingObservationIds: supporting, implementationEffort: effort, reusability: reuse, assumptions, aiRatings: ratings, attractivenessScore: score.attractiveness, confidenceScore: score.confidence, scoreBreakdown: score.breakdown, ...(fields as object) } as typeof opportunities.$inferInsert)
      .run();
    return id;
  };
  const opp1 = await mk(1, "estimate_quote_followup", { title: "Automated estimate follow-up for pending approvals", problemHypothesis: "Free estimates that are not approved on the spot may go unfollowed, losing winnable work (hypothesis — not verified).", proposedSolution: "A lightweight follow-up workflow: estimates logged once, automatic text/email nudges at day 2 and day 7 with a one-tap approve link, and a simple dashboard of open estimates.", whyNotExistingTool: "Shop-management suites (Tekmetric, Shopmonkey) include estimate texting, but the site shows no such tool; if they adopt one, this becomes an integration/configuration project instead.", expectedValue: "Recovering even a few declined-or-forgotten estimates per month on brake/suspension jobs would be material for a single shop.", validationQuestions: ["How are estimates delivered and approved today?", "What happens when a customer says 'let me think about it'?", "Do you use any shop management software?"], risks: ["They may already use a suite with this feature", "Owner may prefer phone follow-up"], salesAngle: "You offer free estimates — curious how many turn into booked jobs, and what happens to the ones that don't." }, { value: 4, feasibility: 4, evidenceStrength: 3, buyingReadiness: 3 }, [o2, o1], "small", "high", ["No existing estimate follow-up automation", "Estimates are frequently not approved on the spot"]);
  await mk(2, "fleet_b2b", { title: "Fleet account portal with service history and scheduling", problemHypothesis: "Commercial fleet customers may track service history and schedule via phone/email, which is slow for both sides (hypothesis).", proposedSolution: "A simple fleet portal: vehicles list, service history, upcoming maintenance, request-a-slot, consolidated invoices.", whyNotExistingTool: "Fleet management platforms exist for fleet owners, but shop-side fleet portals for independents are rare; evaluate after confirming fleet volume.", expectedValue: "Stickier fleet relationships and fewer status calls.", validationQuestions: ["How many fleet accounts do you serve?", "How do fleet managers request service today?"], risks: ["Fleet volume may be too small to justify a portal"], salesAngle: "Saw you welcome fleet accounts — how do your fleet managers keep track of what's due?" }, { value: 4, feasibility: 3, evidenceStrength: 2, buyingReadiness: 3 }, [o3], "medium", "medium", ["Meaningful number of fleet accounts", "Fleet managers want self-service"]);
  void o4;
  void o5;

  await db.insert(outreachDrafts)
    .values({ id: stableId("draft:demo-auto-1:1"), businessId: b1, opportunityId: opp1, style: "concise", channel: "email", toEmail: "service@barton-creek-auto-care.example", subject: "A question about your free estimates", body: "Hi Barton Creek Auto Care team,\n\nI was looking at your website and noticed you offer free estimates and ask customers to call to schedule. I work with independent shops on small software projects, and one pattern I keep seeing is estimates that don't get approved on the spot quietly going cold.\n\nI'm curious how that works for you today — is following up something you'd want handled automatically, or is it not a real problem? Happy to compare notes in a 15-minute call, no pitch.\n\nThe Opportunity Radar team", claims: [{ text: "offer free estimates", observationIds: [o2] }, { text: "ask customers to call to schedule", observationIds: [o1] }], warnings: ["DEMO draft: generated from synthetic findings"], status: "draft", model: "demo (no model call)" })
    .run();
  await db.update(prospects).set({ stage: "outreach_ready", priority: "high", nextAction: "Review draft and decide whether to send", nextActionAt: nowIso() }).where(eq(prospects.businessId, b1)).run();
  await logActivity(b1, "system", "DEMO: research, analysis and outreach draft seeded from synthetic data.");

  // --- Business 2: researched, insufficient evidence ------------------------
  const b2 = ids[1];
  const run2 = stableId("run:demo-auto-2");
  await db.insert(researchRuns).values({ id: run2, businessId: b2, status: "done", finishedAt: nowIso(), pagesFetched: 2, pagesFailed: 1, aiObservationsAccepted: 1, aiObservationsRejected: 0, notes: ["DEMO: synthetic research run"] }).run();
  await db.insert(observations).values({ id: stableId("obs:demo-auto-2:1"), businessId: b2, researchRunId: run2, kind: "verified", category: "hours", statement: "Website lists business hours", evidenceQuote: "Mon - Fri: 7:30am - 5:30pm", sourceUrl: "https://northside-transmission.example/", method: "demo" }).run();
  await db.insert(observations).values({ id: stableId("obs:demo-auto-2:2"), businessId: b2, researchRunId: run2, kind: "verified", category: "tools", statement: "Website integrates Shopmonkey (shop management software)", evidenceQuote: "Resource loaded from book.shopmonkey.io", sourceUrl: "https://northside-transmission.example/", method: "demo" }).run();
  await db.insert(analyses).values({ id: stableId("analysis:demo-auto-2"), businessId: b2, researchRunId: run2, status: "done", model: "demo (no model call)", companySummary: "DEMO: Transmission and brake specialist. The site embeds Shopmonkey online booking.", documentedWorkflows: [], industryWorkflows: ["Scheduling"], existingTools: ["Shopmonkey"], noCompellingOpportunity: true, noOpportunityReason: "The shop already uses a modern shop-management suite with online booking, and only hours are otherwise verified. Insufficient evidence of a commercially compelling software opportunity.", validationWarnings: [] }).run();
  await db.update(businesses).set({ researchStatus: "done", analysisStatus: "insufficient_evidence", lastResearchedAt: nowIso() }).where(eq(businesses.id, b2)).run();
  await db.update(prospects).set({ stage: "researched" }).where(eq(prospects.businessId, b2)).run();
  await logActivity(b2, "system", "DEMO: analysis concluded insufficient evidence of a compelling opportunity.");

  // --- Business 3: research failed (website unreachable) ---------------------
  const b3 = ids[2];
  await db.insert(researchRuns).values({ id: stableId("run:demo-auto-3"), businessId: b3, status: "failed", finishedAt: nowIso(), error: "Website could not be fetched: DNS lookup failed for lonestar-euro.example", notes: ["DEMO: synthetic failure"] }).run();
  await db.update(businesses).set({ researchStatus: "failed" }).where(eq(businesses.id, b3)).run();
  await logActivity(b3, "system", "DEMO: research failed because the website could not be fetched.");

  // Business 4 has no website; left untouched (no_website).
  return { searchId, businessIds: ids };
}

if (process.argv[1] && /seed-demo/.test(process.argv[1])) {
  const r = await seedDemo();
  console.log(`Seeded demo search ${r.searchId} with ${r.businessIds.length} synthetic businesses.`);
}
