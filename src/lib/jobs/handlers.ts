/**
 * Three jobs: discover a search, investigate a business, draft outreach.
 * Investigation is one job: fetch → detect facts → (AI) profile + opportunities
 * → score → verdict. A failure for one business never affects another.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, facts, investigations, opportunities, outreachDrafts, pages, searchResults, searches, type SearchStats } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { PROVIDERS, upsertCandidate, type DiscoveryProviderKey } from "@/lib/discovery";
import { ProviderError } from "@/lib/discovery/types";
import { generateOutreach, investigateWithModel, AiRefusalError, AiSpendLimitError, AiUnavailableError, type OutreachStyle } from "@/lib/ai";
import { newId, nowIso } from "@/lib/ids";
import { crawlWebsite } from "@/lib/research/crawler";
import { detectFacts, type DetectedFact } from "@/lib/research/detect";
import { scoreOpportunity, priorityScore } from "@/lib/scoring/score";
import type { OpportunityCategory } from "@/lib/industries";
import { advanceStageIfBehind, ensureProspect, logActivity } from "@/lib/pipeline/prospects";
import { enqueueJob, type JobRow } from "./queue";

export type ProgressFn = (p: { message?: string; done?: number; total?: number }) => void;
export class NonRetryableError extends Error {}

// ------------------------------------------------------------------ discover
export async function handleDiscoverSearch(job: JobRow, progress: ProgressFn) {
  const db = await getDb();
  const searchId = String(job.payload.searchId);
  const search = await db.select().from(searches).where(eq(searches.id, searchId)).get();
  if (!search) throw new NonRetryableError(`Search ${searchId} not found`);
  await db.update(searches).set({ status: "running", updatedAt: nowIso(), error: null }).where(eq(searches.id, searchId)).run();

  const stats: SearchStats = { providerResults: {}, created: 0, merged: 0, skippedNoWebsite: 0, total: 0, attribution: [] };
  const providerKeys = (search.providers as DiscoveryProviderKey[]).filter((k): k is Exclude<DiscoveryProviderKey, "csv"> => k !== "csv");
  let rank = 0;
  const seenIds = new Set<string>();
  const errors: string[] = [];

  for (const key of providerKeys) {
    const provider = PROVIDERS[key];
    if (!provider) continue;
    const avail = provider.isAvailable();
    if (!avail.available) {
      stats.providerResults[key] = { found: 0, error: avail.reason };
      continue;
    }
    progress({ message: `Discovering via ${provider.label}` });
    try {
      const result = await provider.discover(
        { industry: search.industry, categoryQuery: search.categoryQuery, keywords: search.keywords, country: search.country, region: search.region, city: search.city, maxResults: search.maxResults, requireWebsite: search.requireWebsite },
        { onProgress: (m) => progress({ message: `${provider.label}: ${m}` }) },
      );
      stats.providerResults[key] = { found: result.candidates.length };
      if (!stats.attribution.includes(result.attribution)) stats.attribution.push(result.attribution);
      for (const c of result.candidates) {
        if (rank >= search.maxResults) break;
        if (search.requireWebsite && !c.website) {
          stats.skippedNoWebsite++;
          continue;
        }
        const outcome = await upsertCandidate(db, c, { industry: search.industry, searchId, isDemo: key === "demo" });
        if (seenIds.has(outcome.businessId)) continue;
        seenIds.add(outcome.businessId);
        rank++;
        if (outcome.wasNew) stats.created++;
        else stats.merged++;
        await db.insert(searchResults).values({ searchId, businessId: outcome.businessId, rank, wasNew: outcome.wasNew }).onConflictDoNothing().run();
        await ensureProspect(outcome.businessId);
        if (search.autoInvestigate && key !== "demo") {
          const biz = await db.select({ website: businesses.website, status: businesses.status }).from(businesses).where(eq(businesses.id, outcome.businessId)).get();
          if (biz?.website && biz.status !== "profiled") await enqueueInvestigation(outcome.businessId);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.providerResults[key] = { found: 0, error: msg };
      errors.push(`${provider.label}: ${msg}`);
      if (err instanceof ProviderError && err.retryable && providerKeys.length === 1 && job.attempts < job.maxAttempts) {
        await db.update(searches).set({ stats, status: "queued", error: msg, updatedAt: nowIso() }).where(eq(searches.id, searchId)).run();
        throw err;
      }
    }
  }
  stats.total = rank;
  const anySuccess = Object.values(stats.providerResults).some((r) => !r.error);
  await db
    .update(searches)
    .set({ status: anySuccess || rank > 0 ? "done" : "failed", stats, error: errors.length ? errors.join("; ") : null, updatedAt: nowIso() })
    .where(eq(searches.id, searchId))
    .run();
  if (!anySuccess && rank === 0) throw new NonRetryableError(errors.join("; ") || "No provider produced results");
}

export async function enqueueInvestigation(businessId: string) {
  const db = await getDb();
  await db.update(businesses).set({ status: "queued", statusMessage: "Waiting to be investigated", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
  return enqueueJob("investigate_business", { businessId }, { idempotencyKey: `investigate:${businessId}` });
}

export async function enqueueOutreach(businessId: string, opportunityId: string | null, style: OutreachStyle, senderName?: string | null) {
  return enqueueJob("generate_outreach", { businessId, opportunityId, style, senderName: senderName ?? null }, { idempotencyKey: `outreach:${businessId}:${opportunityId ?? "best"}:${style}` });
}

// --------------------------------------------------------------- investigate
export async function handleInvestigateBusiness(job: JobRow, progress: ProgressFn) {
  const db = await getDb();
  const businessId = String(job.payload.businessId);
  const biz = await db.select().from(businesses).where(eq(businesses.id, businessId)).get();
  if (!biz) throw new NonRetryableError(`Business ${businessId} not found`);
  await ensureProspect(businessId);
  const setStatus = (status: string, statusMessage: string | null, extra: Partial<typeof businesses.$inferInsert> = {}) => db.update(businesses).set({ status, statusMessage, updatedAt: nowIso(), ...extra }).where(eq(businesses.id, businessId)).run();
  if (biz.isDemo) {
    await setStatus("profiled", "Demo record (seeded)");
    throw new NonRetryableError("Demo businesses are seeded; live investigation is skipped");
  }
  if (!biz.website) {
    await setStatus("no_website", "No website on record");
    throw new NonRetryableError("Business has no website to investigate");
  }
  await setStatus("investigating", "Fetching website");
  const invId = newId();
  const started = Date.now();
  await db.insert(investigations).values({ id: invId, businessId, status: "running" }).run();
  const notes: string[] = [];
  const cfg = getConfig();

  try {
    const crawl = await crawlWebsite(biz.website, { onProgress: (m) => progress({ message: m }) });
    notes.push(...crawl.notes);
    const fetched = crawl.pages.filter((p) => p.content);
    const failed = crawl.pages.filter((p) => !p.content);
    for (const p of crawl.pages) {
      await db.insert(pages).values({ id: newId(), investigationId: invId, businessId, url: p.url, finalUrl: p.finalUrl, kind: p.kind, statusCode: p.status, title: p.content?.title ?? null, text: p.content?.text ?? null, bytes: p.bytes, error: p.error }).run();
    }
    if (!fetched.length) throw new NonRetryableError(`Website could not be fetched: ${failed[0]?.error ?? "unknown error"}`);

    await setStatus("investigating", cfg.ai.enabled ? "Building profile and analyzing opportunities" : "Detecting profile facts");
    const detected: DetectedFact[] = detectFacts(fetched.map((p) => ({ content: p.content!, url: p.url, kind: p.kind })));

    let outcome: Awaited<ReturnType<typeof investigateWithModel>> | null = null;
    let verdict: "opportunity" | "no_opportunity" | "needs_ai" = "needs_ai";
    let verdictReason = "AI is not configured; profile contains detected facts only.";
    const warnings: string[] = [];
    let model: string | null = null;
    let costUsd = 0;
    if (cfg.ai.enabled) {
      try {
        outcome = await investigateWithModel({ id: biz.id, name: biz.name, industry: biz.industry, city: biz.city, region: biz.region, category: biz.category }, fetched.map((p) => ({ url: p.url, kind: p.kind, title: p.content!.title, text: p.content!.text })), detected);
        verdict = outcome.verdict;
        verdictReason = outcome.verdictReason;
        warnings.push(...outcome.warnings);
        model = outcome.model;
        costUsd = outcome.costUsd;
        if (outcome.rejected.length) notes.push(`Rejected ${outcome.rejected.length} model fact(s) whose evidence could not be verified verbatim`);
      } catch (err) {
        if (err instanceof AiSpendLimitError || err instanceof AiRefusalError || err instanceof AiUnavailableError) {
          notes.push(`AI investigation skipped: ${err.message}`);
          verdictReason = `AI investigation skipped: ${err.message}`;
        } else throw err;
      }
    }
    const finalFacts = outcome ? outcome.facts : detected.map((d) => ({ key: d.key, status: d.status === "unknown" ? ("not_found" as const) : d.status, value: d.value, evidenceQuote: d.evidenceQuote, sourceUrl: d.sourceUrl }));
    const summaryFact = finalFacts.find((f) => f.key === "summary" && f.status === "verified");

    // Persist atomically: replace facts and opportunities for this business.
    await db.transaction(async (tx) => {
      await tx.delete(facts).where(eq(facts.businessId, businessId)).run();
      for (const f of finalFacts) {
        const method = detected.some((d) => d.key === f.key && d.status === f.status && d.value === f.value) ? "detected" : "ai";
        await tx.insert(facts).values({ id: newId(), businessId, investigationId: invId, key: f.key, status: f.status, value: f.value, evidenceQuote: f.evidenceQuote, sourceUrl: f.sourceUrl, method }).run();
      }
      await tx.delete(opportunities).where(eq(opportunities.businessId, businessId)).run();
      const verifiedKeys = new Set(finalFacts.filter((f) => f.status === "verified").map((f) => f.key));
      const gapKeys = new Set(finalFacts.filter((f) => f.status === "not_found").map((f) => f.key));
      const hasEmail = verifiedKeys.has("email") || Boolean(biz.email);
      const hasPhone = verifiedKeys.has("phone") || Boolean(biz.phone);
      const hasForm = verifiedKeys.has("contact_form");
      let bestA: number | null = null;
      let bestC: number | null = null;
      const opps = outcome?.opportunities ?? [];
      for (const [i, o] of opps.entries()) {
        const score = scoreOpportunity({
          category: o.category as OpportunityCategory,
          aiRatings: { value: o.ratings.value, feasibility: o.ratings.feasibility, evidenceStrength: o.ratings.evidence_strength, buyingReadiness: o.ratings.buying_readiness },
          implementationEffort: o.implementation_effort,
          reusability: o.reusability,
          supportingVerifiedCount: o.supporting_fact_keys.filter((k) => verifiedKeys.has(k as never)).length,
          supportingGapCount: o.supporting_fact_keys.filter((k) => gapKeys.has(k as never)).length,
          totalVerifiedFacts: verifiedKeys.size,
          pagesResearched: fetched.length,
          assumptionCount: o.assumptions.length,
          contact: { email: hasEmail, phone: hasPhone, contactForm: hasForm },
        });
        if (i === 0) {
          bestA = score.attractiveness;
          bestC = score.confidence;
        }
        await tx
          .insert(opportunities)
          .values({ id: newId(), investigationId: invId, businessId, category: o.category, title: o.title, problemHypothesis: o.problem_hypothesis, proposedSolution: o.proposed_solution, whyNotExistingTool: o.why_not_existing_tool, expectedValue: o.expected_value, supportingFactKeys: o.supporting_fact_keys, assumptions: o.assumptions, validationQuestions: o.validation_questions, implementationEffort: o.implementation_effort, reusability: o.reusability, risks: o.risks, salesAngle: o.sales_angle, aiRatings: { value: o.ratings.value, feasibility: o.ratings.feasibility, evidenceStrength: o.ratings.evidence_strength, buyingReadiness: o.ratings.buying_readiness }, attractivenessScore: score.attractiveness, confidenceScore: score.confidence, scoreBreakdown: score.breakdown, rank: i + 1 })
          .run();
      }
      const emailFact = finalFacts.find((f) => f.key === "email" && f.status === "verified")?.value ?? null;
      const phoneFact = finalFacts.find((f) => f.key === "phone" && f.status === "verified")?.value ?? null;
      await tx
        .update(businesses)
        .set({
          status: "profiled",
          statusMessage: verdict === "opportunity" ? `${opps.length} opportunity hypothesis${opps.length === 1 ? "" : "es"}` : verdict === "no_opportunity" ? "No compelling opportunity" : "Profile detected; AI analysis pending",
          verdict,
          summary: summaryFact?.value ?? null,
          email: biz.email ?? emailFact,
          phone: biz.phone ?? phoneFact,
          bestAttractiveness: bestA,
          bestConfidence: bestC,
          priority: bestA != null && bestC != null ? priorityScore(bestA, bestC) : null,
          investigatedAt: nowIso(),
          updatedAt: nowIso(),
        })
        .where(eq(businesses.id, businessId))
        .run();
      await tx
        .update(investigations)
        .set({ status: "done", finishedAt: nowIso(), durationMs: Date.now() - started, pagesFetched: fetched.length, pagesFailed: failed.length, factsVerified: verifiedKeys.size, factsRejected: outcome?.rejected.length ?? 0, model, costUsd, workflows: outcome?.workflows ?? [], verdict, verdictReason, warnings, notes })
        .where(eq(investigations.id, invId))
        .run();
    });
    await logActivity(businessId, "system", `Investigated in ${((Date.now() - started) / 1000).toFixed(1)}s: ${fetched.length} page(s), ${finalFacts.filter((f) => f.status === "verified").length} verified facts. ${verdict === "opportunity" ? `${outcome?.opportunities.length} opportunity hypothesis(es).` : verdict === "no_opportunity" ? `No compelling opportunity: ${verdictReason}` : "AI analysis not run."}`, { investigationId: invId });
    if (verdict === "opportunity") await advanceStageIfBehind(businessId, "qualified", "investigation found an opportunity");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(investigations).set({ status: "failed", finishedAt: nowIso(), durationMs: Date.now() - started, error: msg, notes }).where(eq(investigations.id, invId)).run();
    await setStatus("failed", msg.slice(0, 200));
    throw err;
  }
}

// ------------------------------------------------------------------ outreach
export async function handleGenerateOutreach(job: JobRow, progress: ProgressFn) {
  const db = await getDb();
  const businessId = String(job.payload.businessId);
  const opportunityId = job.payload.opportunityId ? String(job.payload.opportunityId) : null;
  const style = (job.payload.style as OutreachStyle) ?? "concise";
  const senderName = (job.payload.senderName as string | null) ?? null;
  const biz = await db.select().from(businesses).where(eq(businesses.id, businessId)).get();
  if (!biz) throw new NonRetryableError(`Business ${businessId} not found`);
  const opp = opportunityId
    ? await db.select().from(opportunities).where(eq(opportunities.id, opportunityId)).get()
    : await db.select().from(opportunities).where(eq(opportunities.businessId, businessId)).orderBy(opportunities.rank).limit(1).get();
  if (!opp) throw new NonRetryableError("No opportunity available to write about; investigate the business first");
  const factRows = await db.select().from(facts).where(eq(facts.businessId, businessId)).all();
  progress({ message: `Drafting ${style} outreach` });
  try {
    const out = await generateOutreach(
      { id: biz.id, name: biz.name, city: biz.city, region: biz.region },
      { title: opp.title, category: opp.category, problemHypothesis: opp.problemHypothesis, proposedSolution: opp.proposedSolution, expectedValue: opp.expectedValue, salesAngle: opp.salesAngle, supportingFactKeys: opp.supportingFactKeys, validationQuestions: opp.validationQuestions },
      factRows.map((f) => ({ key: f.key, status: f.status, value: f.value })),
      style,
      senderName,
    );
    const warnings = [...out.warnings];
    if (!biz.email) warnings.push("No verified email address for this business; recipient must be found manually.");
    await db
      .insert(outreachDrafts)
      .values({ id: newId(), businessId, opportunityId: opp.id, style, channel: "email", toEmail: biz.email ?? null, subject: out.draft.subject, body: out.draft.body, claims: out.draft.claims, warnings, status: "draft", model: out.model })
      .run();
    await logActivity(businessId, "system", `Outreach draft generated (${style}) for "${opp.title}".`, { warnings });
  } catch (err) {
    if (err instanceof AiSpendLimitError || err instanceof AiRefusalError || err instanceof AiUnavailableError) throw new NonRetryableError(err.message);
    throw err;
  }
}

/** Latest investigation for a business (helper for pages). */
export async function latestInvestigation(businessId: string) {
  const db = await getDb();
  return (await db.select().from(investigations).where(eq(investigations.businessId, businessId)).orderBy(desc(investigations.startedAt)).limit(1).get()) ?? null;
}
