/**
 * Test fixture: a small set of synthetic businesses in every state of the
 * workflow (profiled with opportunities and a draft, profiled without
 * opportunity, failed, no website), reachable from one search. Used by the
 * browser journey and by unit tests; never by the product. Deterministic ids
 * keep links stable. Domains are reserved `.example` names.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, campaigns, facts, investigations, opportunities, outreachDrafts, prospects, searchCandidates, searchResults, searches } from "@/db/schema";
import type { BusinessCandidate } from "@/lib/discovery/types";
import { upsertCandidate } from "@/lib/discovery/dedupe";
import { completenessOf } from "@/lib/discovery/engine";
import { normalizeName, normalizePhone, normalizeWebsite, websiteDomain } from "@/lib/discovery/normalize";
import { leadScore } from "@/lib/scoring/lead";
import { nowIso, stableId } from "@/lib/ids";
import { ensureProspect, logActivity } from "@/lib/pipeline/prospects";
import { scoreOpportunity, priorityScore } from "@/lib/scoring/score";
import type { OpportunityCategory } from "@/lib/industries";
import type { FactKey } from "@/lib/profile/fields";

const ATTRIBUTION = "Test fixture (synthetic)";

/** Four auto repair shops with different completeness: two full records, one without a street, one without a website. */
export const FIXTURE_BUSINESSES: BusinessCandidate[] = [
  { provider: "csv", providerId: "fixture-auto-1", name: "Barton Creek Auto Care", category: "car_repair", website: "https://barton-creek-auto-care.example", phone: "512-555-0101", street: "4100 Sample Lane", city: "Austin", region: "TX", postalCode: "78704", country: "US", attribution: ATTRIBUTION },
  { provider: "csv", providerId: "fixture-auto-2", name: "Northside Transmission & Brake", category: "car_repair", website: "https://northside-transmission.example", phone: "512-555-0102", street: "9020 Sample Blvd", city: "Austin", region: "TX", postalCode: "78758", country: "US", attribution: ATTRIBUTION },
  { provider: "csv", providerId: "fixture-auto-3", name: "Lone Star Euro Specialists", category: "car_repair", website: "https://lonestar-euro.example", phone: "512-555-0103", city: "Austin", region: "TX", country: "US", attribution: ATTRIBUTION },
  { provider: "csv", providerId: "fixture-auto-4", name: "Quick Lube Corner", category: "car_repair", website: null, phone: "512-555-0104", city: "Austin", region: "TX", country: "US", attribution: ATTRIBUTION },
];

export async function seedFixture() {
  const db = await getDb();
  const searchId = stableId("search:fixture:auto_repair:austin");
  for (const b of await db.select({ id: businesses.id }).from(searchResults).innerJoin(businesses, eq(searchResults.businessId, businesses.id)).where(eq(searchResults.searchId, searchId)).all()) await db.delete(businesses).where(eq(businesses.id, b.id)).run();
  await db.delete(searches).where(eq(searches.id, searchId)).run();

  await db
    .insert(searches)
    .values({ id: searchId, name: "Auto repair, Austin TX (fixture)", industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 10, providers: ["csv"], status: "done", stats: { providerResults: { csv: { found: 4 } }, created: 4, merged: 0, skippedNoWebsite: 0, total: 4, attribution: [ATTRIBUTION] } })
    .run();

  const ids: string[] = [];
  for (const [i, c] of FIXTURE_BUSINESSES.entries()) {
    const { businessId } = await upsertCandidate(db, c, { industry: "auto_repair", searchId, fixedId: stableId(`business:${c.providerId}`) });
    ids.push(businessId);
    await db.insert(searchResults).values({ searchId, businessId, rank: i + 1, wasNew: true }).onConflictDoNothing().run();
    await ensureProspect(businessId);
    const website = normalizeWebsite(c.website);
    const lead = leadScore({ name: c.name, industry: "auto_repair", website, phone: c.phone, email: c.email, street: c.street, city: c.city, category: c.category });
    const cand = { street: c.street ?? null, city: c.city ?? null, phone: normalizePhone(c.phone), website, email: c.email ?? null, lat: c.lat ?? null };
    await db
      .insert(searchCandidates)
      .values({ id: stableId(`candidate:${c.providerId}`), searchId, rank: i + 1, name: c.name, nameNormalized: normalizeName(c.name), category: c.category ?? null, matchedBy: ["fixture"], website, websiteDomain: websiteDomain(website), phone: cand.phone, email: cand.email, street: cand.street, city: cand.city, region: c.region ?? null, postalCode: c.postalCode ?? null, country: c.country ?? "US", lat: cand.lat, lon: c.lng ?? null, operatingStatus: "unknown", brand: null, kind: lead.kind, leadScore: lead.score, leadReasons: lead.reasons, completeness: completenessOf(cand), sources: [{ provider: "csv", providerId: c.providerId, sourceUrl: null, attribution: c.attribution, fetchedAt: nowIso(), matchedBy: "fixture" }], mergeRule: null, mergeConfidence: null, possibleDuplicateOf: null, businessId, savedVia: "new", skippedReason: null })
      .onConflictDoNothing()
      .run();
  }

  // --- Business 1: full profile, two opportunities, a draft ------------------
  const b1 = ids[0];
  const site1 = "https://barton-creek-auto-care.example";
  const inv1 = stableId("inv:fixture-auto-1");
  await db.insert(investigations).values({ id: inv1, businessId: b1, status: "done", finishedAt: nowIso(), durationMs: 6400, pagesFetched: 4, pagesFailed: 0, factsVerified: 12, factsRejected: 1, model: "fixture (no model call)", costUsd: 0, workflows: [{ name: "Phone-based appointment scheduling", factKeys: ["booking_method"] }, { name: "Free estimate intake", factKeys: ["estimate_policy"] }, { name: "Fleet accounts", factKeys: ["fleet_program"] }], verdict: "qualified", verdictReason: "Phone-only booking and free estimates with no visible follow-up tooling.", warnings: [], notes: ["Fixture: synthetic investigation", "Rejected 1 model fact whose evidence could not be verified verbatim"] }).run();
  const fact = async (businessId: string, invId: string, key: FactKey, status: "verified" | "not_found", value: string | null, quote: string | null, url: string | null, method = "detected") => {
    await db.insert(facts).values({ id: stableId(`fact:${businessId}:${key}`), businessId, investigationId: invId, key, status, value, evidenceQuote: quote, sourceUrl: url, method }).run();
  };
  await fact(b1, inv1, "summary", "verified", "Independent auto repair shop offering brake, suspension and general repair for cars and light trucks, with fleet accounts for local businesses.", "Family-owned since 1998, we handle brakes, suspension and general repair for cars and light trucks.", `${site1}/`);
  await fact(b1, inv1, "services", "verified", "Brakes, suspension, oil changes, diagnostics, A/C, fleet maintenance", "Brakes · Suspension · Oil changes · Diagnostics · A/C · Fleet maintenance", `${site1}/services`);
  await fact(b1, inv1, "customer_types", "verified", "Residential drivers and local business fleets", "Fleet accounts welcome — ask about our commercial fleet maintenance program.", `${site1}/fleet`);
  await fact(b1, inv1, "years_in_business", "verified", "Since 1998", "Family-owned since 1998", `${site1}/`);
  await fact(b1, inv1, "warranty", "verified", "24 months / 24,000 miles", "All repairs are backed by our 24 month / 24,000 mile nationwide warranty.", `${site1}/services`);
  await fact(b1, inv1, "reviews_on_site", "verified", "yes", "What our customers say: \"Honest, fast, and fairly priced.\"", `${site1}/`);
  await fact(b1, inv1, "booking_method", "verified", "phone_only", "Call us today to schedule your appointment — we'll get you in fast.", `${site1}/`);
  await fact(b1, inv1, "estimate_policy", "verified", "free_estimates", "Free estimates on all brake and suspension work.", `${site1}/services`);
  await fact(b1, inv1, "fleet_program", "verified", "Commercial fleet maintenance program", "Fleet accounts welcome — ask about our commercial fleet maintenance program.", `${site1}/fleet`);
  await fact(b1, inv1, "hours", "verified", "Mon–Fri 7:30am–6pm, Sat 8am–1pm", "Mon–Fri 7:30am–6pm · Sat 8am–1pm", `${site1}/contact`);
  await fact(b1, inv1, "website_platform", "verified", "Wix", "Resource loaded from static.parastorage.com", `${site1}/`);
  await fact(b1, inv1, "email", "verified", "service@barton-creek-auto-care.example", "service@barton-creek-auto-care.example", `${site1}/contact`);
  await fact(b1, inv1, "phone", "verified", "5125550101", "5125550101", `${site1}/contact`);
  await fact(b1, inv1, "contact_form", "verified", "yes", "Form fields: name, phone, message (+ message box)", `${site1}/contact`);
  for (const k of ["booking_tool", "shop_management_tool", "chat_tool", "review_tool", "financing_provider", "customer_updates", "maintenance_plans"] as FactKey[]) await fact(b1, inv1, k, "not_found", null, "Not detected across 4 fetched page(s)", null);

  const mk = async (rank: number, category: OpportunityCategory, fields: Record<string, unknown>, ratings: { value: number; feasibility: number; evidenceStrength: number }, supporting: string[], verifiedCount: number, gapCount: number, effort: "small" | "medium" | "large", reuse: "low" | "medium" | "high", assumptions: string[]) => {
    const score = scoreOpportunity({ category, aiRatings: ratings, implementationEffort: effort, reusability: reuse, supportingVerifiedCount: verifiedCount, supportingGapCount: gapCount, totalVerifiedFacts: 14, pagesResearched: 4, assumptionCount: assumptions.length });
    const id = stableId(`opp:fixture-auto-1:${rank}`);
    await db.insert(opportunities).values({ id, investigationId: inv1, businessId: b1, category, rank, supportingFactKeys: supporting, implementationEffort: effort, reusability: reuse, assumptions, aiRatings: ratings, attractivenessScore: score.attractiveness, confidenceScore: score.confidence, scoreBreakdown: score.breakdown, source: "ai", role: rank === 1 ? "primary" : "secondary", ...(fields as object) } as typeof opportunities.$inferInsert).run();
    return { id, score };
  };
  const opp1 = await mk(1, "estimate_quote_followup", { title: "Automated estimate follow-up for pending approvals", problemHypothesis: "Free estimates that are not approved on the spot may go unfollowed, losing winnable work (hypothesis — not verified).", proposedSolution: "A lightweight follow-up workflow: estimates logged once, automatic text/email nudges at day 2 and day 7 with a one-tap approve link, and a simple dashboard of open estimates.", whyNotExistingTool: "Shop-management suites (Tekmetric, Shopmonkey) include estimate texting, but no such tool is detected on the site; if they adopt one, this becomes an integration/configuration project instead.", expectedValue: "Recovering even a few declined-or-forgotten estimates per month on brake/suspension jobs would be material for a single shop.", validationQuestions: ["How are estimates delivered and approved today?", "What happens when a customer says 'let me think about it'?", "Do you use any shop management software?"], risks: ["They may already use a suite with this feature", "Owner may prefer phone follow-up"], salesAngle: "You offer free estimates — curious how many turn into booked jobs, and what happens to the ones that don't.", whyRelevant: "The shop advertises free estimates on brake and suspension work and asks customers to call to schedule, so every estimate and booking passes through the phone.", components: [{ name: "Online estimate and booking requests", description: "A short request form that lands in the shop's schedule, for customers browsing after hours.", evidence: ["booking_method", "booking_tool"] }, { name: "Estimate follow-up", description: "Automatic nudges with a one-tap approve link for estimates that were not approved on the spot.", evidence: ["estimate_policy", "customer_updates"] }] }, { value: 4, feasibility: 4, evidenceStrength: 3 }, ["estimate_policy", "booking_method", "shop_management_tool", "customer_updates"], 2, 2, "small", "high", ["No existing estimate follow-up automation", "Estimates are frequently not approved on the spot"]);
  await mk(2, "fleet_b2b", { title: "Fleet account portal with service history and scheduling", problemHypothesis: "Commercial fleet customers may track service history and schedule via phone/email, which is slow for both sides (hypothesis).", proposedSolution: "A simple fleet portal: vehicles list, service history, upcoming maintenance, request-a-slot, consolidated invoices.", whyNotExistingTool: "Fleet management platforms exist for fleet owners, but shop-side fleet portals for independents are rare; evaluate after confirming fleet volume.", expectedValue: "Stickier fleet relationships and fewer status calls.", validationQuestions: ["How many fleet accounts do you serve?", "How do fleet managers request service today?"], risks: ["Fleet volume may be too small to justify a portal"], salesAngle: "Saw you welcome fleet accounts — how do your fleet managers keep track of what's due?" }, { value: 4, feasibility: 3, evidenceStrength: 2 }, ["fleet_program", "booking_method"], 2, 0, "medium", "medium", ["Meaningful number of fleet accounts", "Fleet managers want self-service"]);
  await db
    .update(businesses)
    .set({ status: "profiled", statusMessage: "Qualified: Automated estimate follow-up for pending approvals", verdict: "qualified", verdictReasons: ["“Automated estimate follow-up for pending approvals” is backed by 2 verified observation(s)."], emailSource: "site", emailSourceUrl: `${site1}/contact`, emailStatus: "valid", summary: "Independent auto repair shop offering brake, suspension and general repair for cars and light trucks, with fleet accounts for local businesses.", email: "service@barton-creek-auto-care.example", bestAttractiveness: opp1.score.attractiveness, bestConfidence: opp1.score.confidence, priority: priorityScore(opp1.score.attractiveness, opp1.score.confidence), investigatedAt: nowIso() })
    .where(eq(businesses.id, b1))
    .run();
  const campaignId = stableId("campaign:fixture");
  await db.insert(campaigns).values({ id: campaignId, name: "Outreach (fixture)", status: "open" }).onConflictDoNothing().run();
  const body = "Hi Barton Creek Auto Care team,\n\nI was looking at your website and noticed you offer free estimates and ask customers to call to schedule. I'm Ivan, a software developer, and I wondered whether a gentle automatic reminder for those estimates would help.\n\nShall I send over a short mock-up of how it could look for Barton Creek Auto Care?";
  await db
    .insert(outreachDrafts)
    .values({ id: stableId("draft:fixture-auto-1:1"), businessId: b1, opportunityId: opp1.id, campaignId, step: 0, style: "personal", channel: "email", toEmail: "service@barton-creek-auto-care.example", subject: "A question about your free estimates", body, claims: [{ text: "offer free estimates", factKeys: ["estimate_policy"] }, { text: "ask customers to call to schedule", factKeys: ["booking_method"] }], warnings: [], validation: { passed: true, issues: [], statements: [{ text: "you offer free estimates", verdict: "supported", evidence: ["estimate_policy"] }, { text: "you ask customers to call to schedule", verdict: "supported", evidence: ["booking_method"] }], checkedBy: "fixture", checkedAt: nowIso() }, status: "ready", model: "fixture (no model call)", promptVersion: "fixture" })
    .onConflictDoNothing()
    .run();
  await db.update(prospects).set({ stage: "ready_to_contact", priority: "high", nextAction: "Review the email and approve it", nextActionAt: nowIso() }).where(eq(prospects.businessId, b1)).run();
  await logActivity(b1, "system", "Fixture: investigation, opportunities and outreach draft seeded from synthetic data.");

  // --- Business 2: investigated, no opportunity --------------------------------
  const b2 = ids[1];
  const inv2 = stableId("inv:fixture-auto-2");
  const site2 = "https://northside-transmission.example";
  await db.insert(investigations).values({ id: inv2, businessId: b2, status: "done", finishedAt: nowIso(), durationMs: 5100, pagesFetched: 3, pagesFailed: 0, factsVerified: 6, factsRejected: 0, model: "fixture (no model call)", costUsd: 0, workflows: [{ name: "Online booking via Shopmonkey", factKeys: ["booking_tool"] }], verdict: "not_a_fit", verdictReason: "The shop already runs a modern shop-management suite with online booking and text updates; the remaining gaps are minor. No compelling custom software opportunity.", warnings: [], notes: ["Fixture: synthetic investigation"] }).run();
  await fact(b2, inv2, "summary", "verified", "Transmission and brake specialist for domestic and import vehicles.", "Austin's transmission and brake specialists for domestic and import vehicles since 2005.", `${site2}/`);
  await fact(b2, inv2, "services", "verified", "Transmission rebuilds, brakes, clutches, differentials", "Transmission rebuilds · Brakes · Clutches · Differentials", `${site2}/services`);
  await fact(b2, inv2, "booking_method", "verified", "online_booking", "Book online in under a minute.", `${site2}/`);
  await fact(b2, inv2, "booking_tool", "verified", "Shopmonkey", "Resource loaded from book.shopmonkey.io", `${site2}/`);
  await fact(b2, inv2, "shop_management_tool", "verified", "Shopmonkey", "Resource loaded from book.shopmonkey.io", `${site2}/`);
  await fact(b2, inv2, "customer_updates", "verified", "Text message updates with photos", "We text you updates and photos while your vehicle is in the shop.", `${site2}/`);
  await fact(b2, inv2, "hours", "verified", "Mon–Fri 7:30am–5:30pm", "Mon - Fri: 7:30am - 5:30pm", `${site2}/`);
  await fact(b2, inv2, "phone", "verified", "5125550102", "5125550102", `${site2}/`);
  await fact(b2, inv2, "email", "not_found", null, "Not detected across 3 fetched page(s)", null);
  await db.update(businesses).set({ status: "profiled", statusMessage: "Not a fit: no convincing opportunity", verdict: "not_a_fit", verdictReasons: ["The shop already runs a modern shop-management suite with online booking and text updates; no compelling custom software opportunity."], summary: "Transmission and brake specialist for domestic and import vehicles.", investigatedAt: nowIso() }).where(eq(businesses.id, b2)).run();
  await logActivity(b2, "system", "Fixture: investigation concluded no compelling opportunity.");

  // --- Business 3: investigation failed (website unreachable) -------------------
  const b3 = ids[2];
  await db.insert(investigations).values({ id: stableId("inv:fixture-auto-3"), businessId: b3, status: "failed", finishedAt: nowIso(), durationMs: 1200, error: "Website could not be fetched: DNS lookup failed for lonestar-euro.example", notes: ["Fixture: synthetic failure"] }).run();
  await db.update(businesses).set({ status: "failed", statusMessage: "Website could not be fetched: DNS lookup failed for lonestar-euro.example" }).where(eq(businesses.id, b3)).run();
  await logActivity(b3, "system", "Fixture: investigation failed because the website could not be fetched.");

  // Business 4 has no website; left as no_website.
  return { searchId, businessIds: ids };
}
