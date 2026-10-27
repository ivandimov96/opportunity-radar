/**
 * Job handlers. Each is idempotent-ish: re-running a research or analysis job
 * for a business creates a new run and supersedes the previous results.
 * A failure for one business never affects another.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { analyses, businesses, observations, opportunities, outreachDrafts, pages, researchRuns, searchResults, searches, type SearchStats } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { PROVIDERS, upsertCandidate, type DiscoveryProviderKey } from "@/lib/discovery";
import { ProviderError } from "@/lib/discovery/types";
import { analyzeBusiness, extractObservations, generateOutreach, AiRefusalError, AiSpendLimitError, AiUnavailableError, type ObservationForAnalysis, type OutreachStyle } from "@/lib/ai";
import { newId, nowIso } from "@/lib/ids";
import { crawlWebsite } from "@/lib/research/crawler";
import { detectSignals } from "@/lib/research/signals";
import { scoreOpportunity } from "@/lib/scoring/score";
import type { OpportunityCategory } from "@/lib/industries";
import { advanceStageIfBehind, ensureProspect, logActivity } from "@/lib/pipeline/prospects";
import { enqueueJob, type JobRow } from "./queue";

export type ProgressFn = (p: { message?: string; done?: number; total?: number }) => void;

export class NonRetryableError extends Error {}

// ------------------------------------------------------------------ discover
export async function handleDiscoverSearch(job: JobRow, progress: ProgressFn) {
  const db = getDb();
  const searchId = String(job.payload.searchId);
  const search = db.select().from(searches).where(eq(searches.id, searchId)).get();
  if (!search) throw new NonRetryableError(`Search ${searchId} not found`);
  db.update(searches).set({ status: "running", updatedAt: nowIso(), error: null }).where(eq(searches.id, searchId)).run();

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
        const outcome = upsertCandidate(db, c, { industry: search.industry, searchId, isDemo: key === "demo" });
        if (seenIds.has(outcome.businessId)) continue;
        seenIds.add(outcome.businessId);
        rank++;
        if (outcome.wasNew) stats.created++;
        else stats.merged++;
        db.insert(searchResults).values({ searchId, businessId: outcome.businessId, rank, wasNew: outcome.wasNew }).onConflictDoNothing().run();
        ensureProspect(outcome.businessId);
        if (search.autoResearch) {
          const biz = db.select({ website: businesses.website }).from(businesses).where(eq(businesses.id, outcome.businessId)).get();
          if (biz?.website) enqueueResearch(outcome.businessId, { analyze: true });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.providerResults[key] = { found: 0, error: msg };
      errors.push(`${provider.label}: ${msg}`);
      if (err instanceof ProviderError && err.retryable && providerKeys.length === 1 && job.attempts < job.maxAttempts) {
        db.update(searches).set({ stats, status: "queued", error: msg, updatedAt: nowIso() }).where(eq(searches.id, searchId)).run();
        throw err; // retry whole job
      }
    }
  }
  stats.total = rank;
  const anySuccess = Object.values(stats.providerResults).some((r) => !r.error);
  db.update(searches)
    .set({ status: anySuccess || rank > 0 ? "done" : "failed", stats, error: errors.length ? errors.join("; ") : null, updatedAt: nowIso() })
    .where(eq(searches.id, searchId))
    .run();
  if (!anySuccess && rank === 0) throw new NonRetryableError(errors.join("; ") || "No provider produced results");
}

export function enqueueResearch(businessId: string, opts: { analyze?: boolean } = {}) {
  const db = getDb();
  db.update(businesses).set({ researchStatus: "queued", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
  return enqueueJob("research_business", { businessId, analyze: opts.analyze ?? true }, { idempotencyKey: `research:${businessId}` });
}

export function enqueueAnalysis(businessId: string) {
  const db = getDb();
  db.update(businesses).set({ analysisStatus: "queued", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
  return enqueueJob("analyze_business", { businessId }, { idempotencyKey: `analyze:${businessId}` });
}

export function enqueueOutreach(businessId: string, opportunityId: string | null, style: OutreachStyle, senderName?: string | null) {
  return enqueueJob("generate_outreach", { businessId, opportunityId, style, senderName: senderName ?? null }, { idempotencyKey: `outreach:${businessId}:${opportunityId ?? "none"}:${style}` });
}

// ------------------------------------------------------------------ research
export async function handleResearchBusiness(job: JobRow, progress: ProgressFn) {
  const db = getDb();
  const businessId = String(job.payload.businessId);
  const biz = db.select().from(businesses).where(eq(businesses.id, businessId)).get();
  if (!biz) throw new NonRetryableError(`Business ${businessId} not found`);
  ensureProspect(businessId);
  if (!biz.website) {
    db.update(businesses).set({ researchStatus: "no_website", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
    throw new NonRetryableError("Business has no website to research");
  }
  if (biz.isDemo) {
    db.update(businesses).set({ researchStatus: "done", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
    throw new NonRetryableError("Demo businesses use seeded findings; live research is skipped");
  }
  db.update(businesses).set({ researchStatus: "running", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
  const runId = newId();
  db.insert(researchRuns).values({ id: runId, businessId, status: "running" }).run();
  const notes: string[] = [];

  try {
    const crawl = await crawlWebsite(biz.website, { onProgress: (m) => progress({ message: m }) });
    notes.push(...crawl.notes);
    const fetched = crawl.pages.filter((p) => p.content);
    const failed = crawl.pages.filter((p) => !p.content);

    // Supersede previous research results for this business.
    db.delete(observations).where(and(eq(observations.businessId, businessId), inArray(observations.method, ["deterministic", "ai"]))).run();

    const pageIdByUrl = new Map<string, string>();
    for (const p of crawl.pages) {
      const pageId = newId();
      pageIdByUrl.set(p.url, pageId);
      db.insert(pages)
        .values({ id: pageId, researchRunId: runId, businessId, url: p.url, finalUrl: p.finalUrl, kind: p.kind, statusCode: p.status, title: p.content?.title ?? null, text: p.content?.text ?? null, textHash: p.textHash, bytes: p.bytes, error: p.error })
        .run();
    }

    let deterministic = 0;
    const seenStatements = new Set<string>();
    for (const p of fetched) {
      for (const s of detectSignals(p.content!, p.url, p.kind)) {
        const key = s.statement.toLowerCase();
        if (seenStatements.has(key)) continue;
        seenStatements.add(key);
        db.insert(observations)
          .values({ id: newId(), businessId, researchRunId: runId, kind: "verified", category: s.category, statement: s.statement, evidenceQuote: s.evidenceQuote, sourceUrl: s.sourceUrl, pageId: pageIdByUrl.get(p.url) ?? null, method: "deterministic", confidence: s.confidence })
          .run();
        deterministic++;
      }
    }
    // Promote a verified public email/phone onto the business record if missing.
    const emails = fetched.flatMap((p) => p.content!.emails);
    const phones = fetched.flatMap((p) => p.content!.phones);
    if (!biz.email && emails.length) db.update(businesses).set({ email: emails[0] }).where(eq(businesses.id, businessId)).run();
    if (!biz.phone && phones.length) db.update(businesses).set({ phone: phones[0] }).where(eq(businesses.id, businessId)).run();

    let accepted = 0;
    let rejected = 0;
    const cfg = getConfig();
    if (cfg.ai.enabled && fetched.length) {
      progress({ message: "AI extraction of verified observations" });
      try {
        const out = await extractObservations(businessId, biz.name, fetched.map((p) => ({ url: p.url, kind: p.kind, title: p.content!.title, text: p.content!.text })));
        for (const o of out.accepted) {
          const key = o.statement.toLowerCase();
          if (seenStatements.has(key)) continue;
          seenStatements.add(key);
          db.insert(observations)
            .values({ id: newId(), businessId, researchRunId: runId, kind: "verified", category: o.category, statement: o.statement, evidenceQuote: o.evidenceQuote, sourceUrl: o.sourceUrl, pageId: pageIdByUrl.get(o.sourceUrl) ?? null, method: "ai", confidence: 0.9 })
            .run();
          accepted++;
        }
        for (const u of out.unknowns) {
          db.insert(observations).values({ id: newId(), businessId, researchRunId: runId, kind: "unknown", category: "other", statement: `${u.topic}: ${u.note}`, method: "ai", confidence: 1 }).run();
        }
        rejected = out.rejected.length;
        if (rejected) notes.push(`Rejected ${rejected} AI observation(s) whose evidence could not be verified verbatim`);
      } catch (err) {
        if (err instanceof AiSpendLimitError || err instanceof AiRefusalError) notes.push(`AI extraction skipped: ${err.message}`);
        else throw err;
      }
    } else if (!cfg.ai.enabled) {
      notes.push("AI extraction skipped: ANTHROPIC_API_KEY not configured (deterministic findings only)");
    }

    db.update(researchRuns)
      .set({ status: "done", finishedAt: nowIso(), pagesFetched: fetched.length, pagesFailed: failed.length, aiObservationsAccepted: accepted, aiObservationsRejected: rejected, notes })
      .where(eq(researchRuns.id, runId))
      .run();
    db.update(businesses).set({ researchStatus: fetched.length ? "done" : "failed", lastResearchedAt: nowIso(), updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
    logActivity(businessId, "system", `Research completed: ${fetched.length} page(s) fetched, ${deterministic} detected + ${accepted} AI-verified observations${rejected ? `, ${rejected} rejected` : ""}.`, { runId });
    if (!fetched.length) throw new NonRetryableError(`Website could not be fetched: ${failed[0]?.error ?? "unknown error"}`);
    advanceStageIfBehind(businessId, "researched", "research completed");
    if (job.payload.analyze) enqueueAnalysis(businessId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.update(researchRuns).set({ status: "failed", finishedAt: nowIso(), error: msg, notes }).where(eq(researchRuns.id, runId)).run();
    db.update(businesses).set({ researchStatus: "failed", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
    throw err;
  }
}

// ------------------------------------------------------------------ analysis
export async function handleAnalyzeBusiness(job: JobRow, progress: ProgressFn) {
  const db = getDb();
  const businessId = String(job.payload.businessId);
  const biz = db.select().from(businesses).where(eq(businesses.id, businessId)).get();
  if (!biz) throw new NonRetryableError(`Business ${businessId} not found`);
  ensureProspect(businessId);
  const cfg = getConfig();
  if (!cfg.ai.enabled) {
    db.update(businesses).set({ analysisStatus: "not_started" }).where(eq(businesses.id, businessId)).run();
    throw new NonRetryableError(new AiUnavailableError("ANTHROPIC_API_KEY not configured").message);
  }
  db.update(businesses).set({ analysisStatus: "running", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
  try {
    const obs = db.select().from(observations).where(eq(observations.businessId, businessId)).all();
    const verified = obs.filter((o) => o.kind === "verified");
    const lastRun = db.select().from(researchRuns).where(eq(researchRuns.businessId, businessId)).orderBy(desc(researchRuns.startedAt)).limit(1).get();
    if (!verified.length) {
      const id = newId();
      db.insert(analyses).values({ id, businessId, researchRunId: lastRun?.id ?? null, status: "done", model: null, companySummary: null, noCompellingOpportunity: true, noOpportunityReason: "No verified observations are available for this business, so no opportunity can be assessed.", validationWarnings: [] }).run();
      db.update(businesses).set({ analysisStatus: "insufficient_evidence", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
      return;
    }
    progress({ message: "AI analysis of opportunities" });
    const input: ObservationForAnalysis[] = obs.map((o) => ({ id: o.id, kind: o.kind as "verified" | "unknown", category: o.category, statement: o.statement, evidenceQuote: o.evidenceQuote, sourceUrl: o.sourceUrl }));
    const out = await analyzeBusiness({ id: biz.id, name: biz.name, industry: biz.industry, website: biz.website, city: biz.city, region: biz.region, category: biz.category }, input);
    const a = out.analysis;
    const pagesResearched = lastRun?.pagesFetched ?? 0;
    const hasForm = verified.some((o) => o.statement.toLowerCase().includes("contact/request form"));
    const hasEmail = Boolean(biz.email) || verified.some((o) => o.statement.startsWith("Public email address"));
    const hasPhone = Boolean(biz.phone) || verified.some((o) => o.statement.startsWith("Public phone number"));

    db.transaction((tx) => {
      // Supersede previous analysis + opportunities (drafts keep a nullable reference).
      tx.delete(analyses).where(eq(analyses.businessId, businessId)).run();
      const analysisId = newId();
      tx.insert(analyses)
        .values({ id: analysisId, businessId, researchRunId: lastRun?.id ?? null, status: "done", model: out.model, companySummary: a.company_summary, documentedWorkflows: a.documented_workflows.map((w) => ({ name: w.name, observationIds: w.observation_ids })), industryWorkflows: a.industry_workflows_considered, existingTools: a.existing_tools_detected, noCompellingOpportunity: a.no_compelling_opportunity, noOpportunityReason: a.no_opportunity_reason || null, validationWarnings: out.warnings })
        .run();
      a.opportunities.forEach((o, i) => {
        const score = scoreOpportunity({
          category: o.category as OpportunityCategory,
          aiRatings: { value: o.ratings.value, feasibility: o.ratings.feasibility, evidenceStrength: o.ratings.evidence_strength, buyingReadiness: o.ratings.buying_readiness },
          implementationEffort: o.implementation_effort,
          reusability: o.reusability,
          supportingObservationCount: o.supporting_observation_ids.length,
          totalVerifiedObservations: verified.length,
          pagesResearched,
          assumptionCount: o.assumptions.length,
          contact: { email: hasEmail, phone: hasPhone, contactForm: hasForm },
        });
        tx.insert(opportunities)
          .values({ id: newId(), analysisId, businessId, category: o.category, title: o.title, problemHypothesis: o.problem_hypothesis, proposedSolution: o.proposed_solution, whyNotExistingTool: o.why_not_existing_tool, expectedValue: o.expected_value, supportingObservationIds: o.supporting_observation_ids, assumptions: o.assumptions, validationQuestions: o.validation_questions, implementationEffort: o.implementation_effort, reusability: o.reusability, risks: o.risks, salesAngle: o.sales_angle, aiRatings: { value: o.ratings.value, feasibility: o.ratings.feasibility, evidenceStrength: o.ratings.evidence_strength, buyingReadiness: o.ratings.buying_readiness }, attractivenessScore: score.attractiveness, confidenceScore: score.confidence, scoreBreakdown: score.breakdown, rank: i + 1 })
          .run();
      });
      tx.update(businesses).set({ analysisStatus: a.no_compelling_opportunity ? "insufficient_evidence" : "done", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
    });
    logActivity(businessId, "system", a.no_compelling_opportunity ? `Analysis completed: insufficient evidence of a compelling software opportunity. ${a.no_opportunity_reason}` : `Analysis completed: ${a.opportunities.length} opportunity hypothesis(es) identified.`, { warnings: out.warnings });
    if (!a.no_compelling_opportunity) advanceStageIfBehind(businessId, "qualified", "analysis found an opportunity");
  } catch (err) {
    db.update(businesses).set({ analysisStatus: "failed", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
    if (err instanceof AiSpendLimitError || err instanceof AiRefusalError || err instanceof AiUnavailableError) throw new NonRetryableError(err.message);
    throw err;
  }
}

// ------------------------------------------------------------------ outreach
export async function handleGenerateOutreach(job: JobRow, progress: ProgressFn) {
  const db = getDb();
  const businessId = String(job.payload.businessId);
  const opportunityId = job.payload.opportunityId ? String(job.payload.opportunityId) : null;
  const style = (job.payload.style as OutreachStyle) ?? "concise";
  const senderName = (job.payload.senderName as string | null) ?? null;
  const biz = db.select().from(businesses).where(eq(businesses.id, businessId)).get();
  if (!biz) throw new NonRetryableError(`Business ${businessId} not found`);
  const opp = opportunityId
    ? db.select().from(opportunities).where(eq(opportunities.id, opportunityId)).get()
    : db.select().from(opportunities).where(eq(opportunities.businessId, businessId)).orderBy(opportunities.rank).limit(1).get();
  if (!opp) throw new NonRetryableError("No opportunity available to write about; run analysis first");
  const obs = db.select().from(observations).where(eq(observations.businessId, businessId)).all();
  progress({ message: `Drafting ${style} outreach` });
  try {
    const out = await generateOutreach(
      { id: biz.id, name: biz.name, city: biz.city, region: biz.region },
      { title: opp.title, category: opp.category, problemHypothesis: opp.problemHypothesis, proposedSolution: opp.proposedSolution, expectedValue: opp.expectedValue, salesAngle: opp.salesAngle, supportingObservationIds: opp.supportingObservationIds, validationQuestions: opp.validationQuestions },
      obs.map((o) => ({ id: o.id, kind: o.kind as "verified" | "unknown", category: o.category, statement: o.statement, evidenceQuote: o.evidenceQuote, sourceUrl: o.sourceUrl })),
      style,
      senderName,
    );
    const warnings = [...out.warnings];
    if (!biz.email) warnings.push("No verified email address for this business; recipient must be found manually.");
    db.insert(outreachDrafts)
      .values({ id: newId(), businessId, opportunityId: opp.id, style, channel: "email", toEmail: biz.email ?? null, subject: out.draft.subject, body: out.draft.body, claims: out.draft.claims.map((c) => ({ text: c.text, observationIds: c.observation_ids })), warnings, status: "draft", model: out.model })
      .run();
    logActivity(businessId, "system", `Outreach draft generated (${style}) for "${opp.title}".`, { warnings });
    advanceStageIfBehind(businessId, "outreach_ready", "draft generated");
  } catch (err) {
    if (err instanceof AiSpendLimitError || err instanceof AiRefusalError || err instanceof AiUnavailableError) throw new NonRetryableError(err.message);
    throw err;
  }
}
