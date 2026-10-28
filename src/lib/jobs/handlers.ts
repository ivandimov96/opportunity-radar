/**
 * Three jobs: discover a search, investigate a business, draft outreach.
 * Investigation is one job: fetch → detect facts → (AI) profile + opportunities
 * → score → verdict. A failure for one business never affects another.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, businessSources, facts, investigations, opportunities, outreachDrafts, pages, searches } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { runDiscovery, type RunOutcome } from "@/lib/discovery/engine";
import { generateOutreach, investigateWithModel, AiRefusalError, AiSpendLimitError, AiUnavailableError, type OutreachStyle } from "@/lib/ai";
import { validateOutreach } from "@/lib/ai/outreach";
import { draftFromTemplate } from "@/lib/outreach/template";
import { newId, nowIso } from "@/lib/ids";
import { createHash } from "node:crypto";
import { crawlWebsite, type CrawlResult } from "@/lib/research/crawl";
import { detectFacts, isVendorEmail, type DetectedFact } from "@/lib/research/detect";
import { isFirecrawlConfigured, scrapePage } from "@/lib/research/firecrawl";
import { creditsUsedThisMonth, loadStoredPages } from "@/lib/research/stored";
import { footprintFacts } from "@/lib/research/footprint";
import { findWebsite } from "@/lib/discovery/find-website";
import { normalizeWebsite, websiteDomain } from "@/lib/discovery/normalize";
import { scoreOpportunity, priorityScore } from "@/lib/scoring/score";
import { leadScore } from "@/lib/scoring/lead";
import { ruleOpportunities } from "@/lib/scoring/rules";
import { getPlaybook, type OpportunityCategory } from "@/lib/industries";
import { filtersOf } from "@/lib/search-input";
import { advanceStageIfBehind, ensureProspect, logActivity } from "@/lib/pipeline/prospects";
import { enqueueJob, type JobRow } from "./queue";

export type ProgressFn = (p: { message?: string; done?: number; total?: number }) => void;
export class NonRetryableError extends Error {}

// ------------------------------------------------------------------ discover
/**
 * Discovery is the search engine's job (src/lib/discovery/engine.ts): resolve the
 * area once, run each selected source in isolation, merge and deduplicate across
 * sources, filter with skip counts, rank, store candidates, save businesses when
 * the search asks for it. This handler owns the search row's status, the retry
 * decision, and queuing the saved businesses that qualify for investigation.
 */
export async function handleDiscoverSearch(job: JobRow, progress: ProgressFn, signal: AbortSignal = new AbortController().signal) {
  const db = await getDb();
  const searchId = String(job.payload.searchId);
  const search = await db.select().from(searches).where(eq(searches.id, searchId)).get();
  if (!search) throw new NonRetryableError(`Search ${searchId} not found`);
  await db.update(searches).set({ status: "running", updatedAt: nowIso(), error: null }).where(eq(searches.id, searchId)).run();
  const filters = filtersOf(search);
  const t0 = Date.now();
  let run: RunOutcome;
  try {
    run = await runDiscovery(db, search, { signal, onProgress: (m) => progress({ message: m }) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(searches).set({ status: "failed", error: msg, updatedAt: nowIso() }).where(eq(searches.id, searchId)).run();
    throw err;
  }
  const { stats, errors } = run;
  const note = (m: string) => stats.notes!.push(m);
  signal.throwIfAborted();

  // Saved businesses that qualify for investigation, best leads first (the queue is FIFO).
  let queued = 0;
  if (run.investigable.length && !isFirecrawlConfigured()) note(`${run.investigable.length} lead(s) qualify for investigation, but FIRECRAWL_API_KEY is not set; set it and use "Investigate all"`);
  else {
    for (const t of run.investigable.slice(0, filters.autoInvestigateLimit ?? run.investigable.length)) {
      await enqueueInvestigation(t.id);
      queued++;
    }
  }
  stats.queuedForInvestigation = queued;
  stats.durationMs = Date.now() - t0;
  note(`${stats.total} result(s) listed${filters.autoSave === false ? " for review" : ` and saved (${stats.created} new, ${stats.merged} merged)`}; ${queued} queued for investigation; ${(stats.durationMs / 1000).toFixed(1)} s total`);

  const anySuccess = Object.values(stats.providerResults).some((r) => !r.error);
  if (!anySuccess && run.retryable && job.attempts < job.maxAttempts) {
    await db.update(searches).set({ stats, status: "queued", error: run.retryable.message, updatedAt: nowIso() }).where(eq(searches.id, searchId)).run();
    throw run.retryable;
  }
  await db
    .update(searches)
    .set({ status: anySuccess || stats.total > 0 ? "done" : "failed", stats, error: errors.length ? errors.join("; ") : null, updatedAt: nowIso() })
    .where(eq(searches.id, searchId))
    .run();
  if (!anySuccess && stats.total === 0) throw new NonRetryableError(errors.join("; ") || "No source produced results");
}

/** auto = reuse stored pages when younger than RESEARCH_STALE_DAYS, else crawl; recrawl = always fetch again; reanalyze = stored pages only, no credits. */
export type InvestigateMode = "auto" | "recrawl" | "reanalyze";

export async function enqueueInvestigation(businessId: string, mode: InvestigateMode = "auto") {
  const db = await getDb();
  await db.update(businesses).set({ status: "queued", statusMessage: mode === "reanalyze" ? "Waiting to re-analyze stored pages" : "Waiting to be investigated", updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
  return enqueueJob("investigate_business", { businessId, mode }, { idempotencyKey: `investigate:${businessId}` });
}

const NEEDS_FIRECRAWL = "Website research needs FIRECRAWL_API_KEY (Settings → Integrations); stored pages can still be re-analyzed";

/** New crawls need a key and room in the monthly credit budget; both failures are explicit and final for this job. */
async function requireFirecrawl(setStatus: (status: string, message: string) => Promise<unknown>) {
  if (!isFirecrawlConfigured()) {
    await setStatus("failed", NEEDS_FIRECRAWL);
    throw new NonRetryableError(NEEDS_FIRECRAWL);
  }
  const budget = getConfig().FIRECRAWL_MONTHLY_CREDIT_BUDGET;
  const used = await creditsUsedThisMonth();
  if (used.credits >= budget) {
    const msg = `Firecrawl monthly credit budget reached (${used.credits} of ${budget} since ${used.since.slice(0, 10)}); raise FIRECRAWL_MONTHLY_CREDIT_BUDGET or wait for the renewal`;
    await setStatus("failed", msg);
    throw new NonRetryableError(msg);
  }
}

/** After a timeout the abandoned handler may be hung for good: what it was working on must not stay "in progress". */
export async function markJobTimedOut(job: JobRow, message: string) {
  const db = await getDb();
  if (job.type === "investigate_business") {
    const businessId = String(job.payload.businessId);
    await db.update(investigations).set({ status: "failed", finishedAt: nowIso(), error: message }).where(and(eq(investigations.businessId, businessId), eq(investigations.status, "running"))).run();
    await db.update(businesses).set({ status: "failed", statusMessage: message.slice(0, 200), updatedAt: nowIso() }).where(and(eq(businesses.id, businessId), inArray(businesses.status, ["investigating", "queued"]))).run();
  } else if (job.type === "discover_search") {
    await db.update(searches).set({ status: "failed", error: message, updatedAt: nowIso() }).where(and(eq(searches.id, String(job.payload.searchId)), inArray(searches.status, ["running", "queued"]))).run();
  }
}

export async function enqueueOutreach(businessId: string, opportunityId: string | null, style: OutreachStyle, senderName?: string | null) {
  return enqueueJob("generate_outreach", { businessId, opportunityId, style, senderName: senderName ?? null }, { idempotencyKey: `outreach:${businessId}:${opportunityId ?? "best"}:${style}` });
}

// --------------------------------------------------------------- investigate
/**
 * One job per business:
 *   locate website (if none) → crawl ‖ off-site footprint → detect facts →
 *   (AI profile + hypotheses, when configured) → rule-based hypotheses →
 *   score & rank → verdict. Every step is bounded; failures are explicit.
 */
export async function handleInvestigateBusiness(job: JobRow, progress: ProgressFn, signal: AbortSignal = new AbortController().signal) {
  const db = await getDb();
  const businessId = String(job.payload.businessId);
  let biz = (await db.select().from(businesses).where(eq(businesses.id, businessId)).get())!;
  if (!biz) throw new NonRetryableError(`Business ${businessId} not found`);
  await ensureProspect(businessId);
  const setStatus = (status: string, statusMessage: string | null, extra: Partial<typeof businesses.$inferInsert> = {}) => db.update(businesses).set({ status, statusMessage, updatedAt: nowIso(), ...extra }).where(eq(businesses.id, businessId)).run();
  if (biz.isDemo) {
    await setStatus("profiled", "Demo record (seeded)");
    throw new NonRetryableError("Demo businesses are seeded; live investigation is skipped");
  }
  const cfg = getConfig();
  const notes: string[] = [];

  // 0. Locate a website when none is on record (search + verified domain guesses; each candidate check is one credit).
  let creditsUsed = 0;
  const finderDeps = { scrape: scrapePage, signal };
  if (!biz.website) {
    if (!cfg.RESEARCH_FIND_WEBSITE) {
      await setStatus("no_website", "No website on record (website finder disabled)");
      throw new NonRetryableError("Business has no website to investigate");
    }
    await requireFirecrawl(setStatus);
    await setStatus("investigating", "Locating the website");
    progress({ message: "Locating the website" });
    const search = await findWebsite({ name: biz.name, city: biz.city, region: biz.region, phone: biz.phone, street: biz.street, email: biz.email }, finderDeps);
    creditsUsed += search.credits;
    notes.push(...search.notes);
    const found = search.found;
    if (!found) {
      await setStatus("no_website", "Website could not be located (search and domain guesses were checked)");
      await logActivity(businessId, "system", `Website finder: no verified website found (${search.credits} Firecrawl credit(s)).`, {});
      throw new NonRetryableError("No website could be located for this business");
    }
    const website = normalizeWebsite(found.website)!;
    const lead = leadScore({ ...biz, website });
    await db.update(businesses).set({ website, websiteDomain: websiteDomain(website), websiteSource: found.source, leadScore: lead.score, kind: lead.kind, updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
    await logActivity(businessId, "system", `Website located by ${found.source === "found_search" ? "web search" : found.source === "found_email" ? "its email domain" : "domain guess"} and verified: ${website} (${found.evidence}).`, { confidence: found.confidence });
    biz = (await db.select().from(businesses).where(eq(businesses.id, businessId)).get())!;
  }

  // Stored pages from a recent investigation are reused instead of spending credits: automatically within
  // RESEARCH_STALE_DAYS, always on "re-analyze", never on "research again".
  const mode = (job.payload.mode as InvestigateMode | undefined) ?? "auto";
  const stored = mode === "recrawl" ? null : await loadStoredPages(businessId, biz.website!, mode === "reanalyze" ? Number.POSITIVE_INFINITY : cfg.RESEARCH_STALE_DAYS);
  if (!stored) await requireFirecrawl(setStatus);

  await setStatus("investigating", stored ? "Re-analyzing stored pages" : "Fetching website via Firecrawl");
  const invId = newId();
  const started = Date.now();
  await db.insert(investigations).values({ id: invId, businessId, status: "running" }).run();

  try {
    // 1. Crawl (or reuse stored pages) and off-site footprint in parallel.
    const runFootprint = (site: string) => (cfg.RESEARCH_FOOTPRINT ? footprintFacts(site, { signal }).catch((err) => ({ facts: [] as DetectedFact[], notes: [`Footprint lookups failed: ${(err as Error).message}`] })) : Promise.resolve({ facts: [] as DetectedFact[], notes: [] as string[] }));
    const runCrawl = (site: string): Promise<CrawlResult> =>
      stored
        ? Promise.resolve({ pages: stored.pages, notes: [`Reused ${stored.pages.length} stored page(s) from ${stored.startedAt.slice(0, 10)} (${stored.ageDays} day(s) old, 0 credits)${mode === "reanalyze" ? " on request" : "; use “Research again” for a fresh crawl"}`], durationMs: 0, home: stored.pages.find((p) => p.kind === "home" && p.content) ?? null, credits: 0, stoppedEarly: null })
        : crawlWebsite(site, { onProgress: (m) => progress({ message: m }), signal });
    let [crawl, footprint] = await Promise.all([runCrawl(biz.website!), runFootprint(biz.website!)]);
    notes.push(...crawl.notes, ...footprint.notes);
    signal.throwIfAborted();
    creditsUsed += crawl.credits;
    const savePages = async (c: CrawlResult) => {
      for (const p of c.pages)
        await db
          .insert(pages)
          .values({ id: newId(), investigationId: invId, businessId, url: p.url, finalUrl: p.finalUrl, kind: p.kind, statusCode: p.status, title: p.content?.title ?? null, text: p.content?.text ?? null, markdown: p.markdown, html: p.rawHtml, contentHash: p.content ? createHash("sha1").update(p.content.text).digest("hex") : null, credits: p.credits, bytes: p.bytes, error: p.error, renderer: stored ? "stored" : "firecrawl" })
          .run();
    };
    await savePages(crawl);
    if (!stored && !crawl.pages.some((p) => p.content) && cfg.RESEARCH_FIND_WEBSITE && !/robots\.txt|Blocked|bot protection/.test(crawl.pages[0]?.error ?? "")) {
      // The recorded website is dead (404, DNS, timeout): the business may have moved domains. Try to locate the current site.
      await setStatus("investigating", "Website unreachable; looking for a current one");
      progress({ message: "Website unreachable; looking for a current one" });
      const search = await findWebsite({ name: biz.name, city: biz.city, region: biz.region, phone: biz.phone, street: biz.street, email: biz.email }, finderDeps);
      creditsUsed += search.credits;
      notes.push(...search.notes);
      const found = search.found;
      if (!found) notes.push("Website finder found no verified alternative");
      if (found && websiteDomain(found.website) !== biz.websiteDomain) {
        const website = normalizeWebsite(found.website)!;
        notes.push(`Recorded website ${biz.website} is unreachable; verified current site ${website} (${found.evidence})`);
        await db.update(businesses).set({ website, websiteDomain: websiteDomain(website), websiteSource: found.source, updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
        await logActivity(businessId, "system", `Recorded website was unreachable; located and verified ${website} by ${found.source === "found_search" ? "web search" : found.source === "found_email" ? "its email domain" : "domain guess"} (${found.evidence}).`, { previous: biz.website, confidence: found.confidence });
        biz = (await db.select().from(businesses).where(eq(businesses.id, businessId)).get())!;
        [crawl, footprint] = await Promise.all([runCrawl(website), runFootprint(website)]);
        notes.push(...crawl.notes, ...footprint.notes);
        signal.throwIfAborted();
        creditsUsed += crawl.credits;
        await savePages(crawl);
      }
    }
    const fetched = crawl.pages.filter((p) => p.content);
    const failed = crawl.pages.filter((p) => !p.content);
    if (!fetched.length) throw new NonRetryableError(`Website could not be fetched: ${failed[0]?.error ?? "unknown error"}`);
    if (crawl.home && normalizeWebsite(crawl.home.finalUrl) && websiteDomain(crawl.home.finalUrl) !== biz.websiteDomain) notes.push(`Website now resolves to ${crawl.home.finalUrl}`);

    // 2. Deterministic facts from the site, plus off-site records.
    await setStatus("investigating", cfg.ai.enabled ? "Building profile and analyzing opportunities" : "Detecting profile facts");
    const detected: DetectedFact[] = [...detectFacts(fetched.map((p) => ({ content: p.content!, url: p.url, kind: p.kind })), crawl.home ? { finalUrl: crawl.home.finalUrl, bytes: crawl.home.bytes, ms: crawl.home.ms } : undefined), ...footprint.facts];

    // 3. Model (optional), validated in code.
    let outcome: Awaited<ReturnType<typeof investigateWithModel>> | null = null;
    const warnings: string[] = [];
    let model: string | null = null;
    let costUsd = 0;
    let aiSkipped: string | null = cfg.ai.enabled ? null : "AI is not configured";
    signal.throwIfAborted();
    if (cfg.ai.enabled) {
      try {
        outcome = await investigateWithModel({ id: biz.id, name: biz.name, industry: biz.industry, city: biz.city, region: biz.region, category: biz.category }, fetched.map((p) => ({ url: p.url, kind: p.kind, title: p.content!.title, text: p.content!.text })), detected);
        warnings.push(...outcome.warnings);
        model = outcome.model;
        costUsd = outcome.costUsd;
        if (outcome.rejected.length) notes.push(`Rejected ${outcome.rejected.length} model fact(s) whose evidence could not be verified verbatim`);
      } catch (err) {
        if (err instanceof AiSpendLimitError || err instanceof AiRefusalError || err instanceof AiUnavailableError) {
          aiSkipped = err.message;
          notes.push(`AI investigation skipped: ${err.message}`);
        } else throw err;
      }
    }
    const finalFacts = outcome ? outcome.facts : detected.map((d) => ({ key: d.key, status: d.status === "unknown" ? ("not_found" as const) : d.status, value: d.value, evidenceQuote: d.evidenceQuote, sourceUrl: d.sourceUrl }));
    const summaryFact = finalFacts.find((f) => f.key === "summary" && f.status === "verified");

    // 4. Rule-based hypotheses complement the model (categories it did not cover) or stand alone.
    const playbook = getPlaybook(biz.industry);
    const aiOpps = (outcome?.opportunities ?? []).map((o) => ({ ...o, source: "ai" as const }));
    const covered = new Set(aiOpps.map((o) => o.category));
    const ruleOpps = ruleOpportunities(finalFacts, playbook)
      .filter((o) => !covered.has(o.category))
      .map((o) => ({ ...o, source: "rules" as const }));
    const candidates = [...aiOpps, ...ruleOpps];

    // 5. Score, rank, keep the best few.
    const verifiedKeys = new Set(finalFacts.filter((f) => f.status === "verified").map((f) => f.key));
    const gapKeys = new Set(finalFacts.filter((f) => f.status === "not_found").map((f) => f.key));
    const hasEmail = verifiedKeys.has("email") || Boolean(biz.email);
    const hasPhone = verifiedKeys.has("phone") || Boolean(biz.phone);
    const hasForm = verifiedKeys.has("contact_form");
    const scoredAll = candidates
      .map((o) => {
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
        return { o, score, priority: priorityScore(score.attractiveness, score.confidence) };
      })
      .sort((a, b) => b.priority - a.priority);
    // Model hypotheses are always kept (they read the full pages); rule-based ones fill the remaining slots.
    const keptAi = scoredAll.filter((s) => s.o.source === "ai");
    const keptRules = scoredAll.filter((s) => s.o.source === "rules").slice(0, Math.max(0, MAX_OPPORTUNITIES - keptAi.length));
    const scored = [...keptAi, ...keptRules].sort((a, b) => b.priority - a.priority);

    // Too little was seen to recommend anything: say so instead of ranking hypotheses built on gaps.
    // Measured keys (health, dates, hosting) exist for nearly every reachable site, so only content facts count here.
    const contentVerified = [...verifiedKeys].filter((k) => !MEASURED_KEYS.has(k)).length;
    const thin = contentVerified < MIN_VERIFIED_FOR_VERDICT || (fetched.length <= 1 && contentVerified < MIN_VERIFIED_SINGLE_PAGE);
    let verdict: "opportunity" | "no_opportunity" | "needs_ai" | "insufficient_evidence";
    let verdictReason: string;
    if (thin && !aiOpps.length) {
      verdict = "insufficient_evidence";
      verdictReason = `Only ${fetched.length} page(s) could be read and ${contentVerified} fact(s) about the business verified; the site does not show enough to assess. ${scored.length ? `${scored.length} rule-based pattern(s) kept as weak hypotheses.` : ""}`.trim();
    } else if (scored.length) {
      verdict = "opportunity";
      const n = { ai: aiOpps.length, rules: scored.filter((s) => s.o.source === "rules").length };
      verdictReason = outcome ? (outcome.verdict === "opportunity" ? outcome.verdictReason : `Model found no compelling opportunity (${outcome.verdictReason}); ${n.rules} rule-based pattern(s) kept as hypotheses to validate.`) : `${n.rules} rule-based pattern(s) matched the verified facts and gaps; AI analysis not run (${aiSkipped}).`;
    } else if (outcome) {
      verdict = "no_opportunity";
      verdictReason = outcome.verdictReason;
    } else {
      verdict = "needs_ai";
      verdictReason = `No rule-based pattern matched; AI analysis not run (${aiSkipped}).`;
    }

    // 6. Persist atomically: replace facts and opportunities for this business (one batch; see src/db/client.ts).
    const best = scored[0];
    const emailFact = finalFacts.find((f) => f.key === "email" && f.status === "verified")?.value ?? null;
    const phoneFact = finalFacts.find((f) => f.key === "phone" && f.status === "verified")?.value ?? null;
    const writes = [
      db.delete(facts).where(eq(facts.businessId, businessId)),
      ...finalFacts.map((f) => {
        const method = detected.some((d) => d.key === f.key && d.status === f.status && d.value === f.value) ? "detected" : "ai";
        return db.insert(facts).values({ id: newId(), businessId, investigationId: invId, key: f.key, status: f.status, value: f.value, evidenceQuote: f.evidenceQuote, sourceUrl: f.sourceUrl, method });
      }),
      db.delete(opportunities).where(eq(opportunities.businessId, businessId)),
      ...scored.map(({ o, score }, i) =>
        db
          .insert(opportunities)
          .values({ id: newId(), investigationId: invId, businessId, category: o.category, title: o.title, problemHypothesis: o.problem_hypothesis, proposedSolution: o.proposed_solution, whyNotExistingTool: o.why_not_existing_tool, expectedValue: o.expected_value, supportingFactKeys: o.supporting_fact_keys, assumptions: o.assumptions, validationQuestions: o.validation_questions, implementationEffort: o.implementation_effort, reusability: o.reusability, risks: o.risks, salesAngle: o.sales_angle, aiRatings: { value: o.ratings.value, feasibility: o.ratings.feasibility, evidenceStrength: o.ratings.evidence_strength, buyingReadiness: o.ratings.buying_readiness }, attractivenessScore: score.attractiveness, confidenceScore: score.confidence, scoreBreakdown: score.breakdown, rank: i + 1, source: o.source }),
      ),
      db
        .update(businesses)
        .set({
          status: "profiled",
          statusMessage: verdict === "opportunity" ? `${scored.length} opportunity hypothes${scored.length === 1 ? "is" : "es"}${scored.every((s) => s.o.source === "rules") ? " (rule-based)" : ""}` : verdict === "no_opportunity" ? "No compelling opportunity" : verdict === "insufficient_evidence" ? `Insufficient evidence: ${fetched.length} page(s), ${verifiedKeys.size} verified fact(s)` : "Profile detected; no pattern matched; AI analysis pending",
          verdict,
          summary: summaryFact?.value ?? null,
          // The email verified by this run wins unless the stored one is on the business's own domain (the one case
          // where an older value is at least as trustworthy); vendor/widget addresses are never kept.
          email: pickEmail(biz.email, emailFact, biz.websiteDomain),
          phone: biz.phone ?? phoneFact,
          bestAttractiveness: best?.score.attractiveness ?? null,
          bestConfidence: best?.score.confidence ?? null,
          priority: best ? best.priority : null,
          investigatedAt: nowIso(),
          updatedAt: nowIso(),
        })
        .where(eq(businesses.id, businessId)),
      db
        .update(investigations)
        .set({ status: "done", finishedAt: nowIso(), durationMs: Date.now() - started, pagesFetched: fetched.length, pagesFailed: failed.length, factsVerified: verifiedKeys.size, factsRejected: outcome?.rejected.length ?? 0, model, costUsd, creditsUsed, workflows: outcome?.workflows ?? [], verdict, verdictReason, warnings, notes })
        .where(eq(investigations.id, invId)),
    ] as const;
    signal.throwIfAborted();
    await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
    await logActivity(businessId, "system", `Investigated in ${((Date.now() - started) / 1000).toFixed(1)}s: ${fetched.length} page(s), ${verifiedKeys.size} verified facts, ${footprint.facts.length} off-site record(s), ${creditsUsed} Firecrawl credit(s). ${verdict === "opportunity" ? `${scored.length} opportunity hypothesis(es) (${scored.filter((s) => s.o.source === "ai").length} AI, ${scored.filter((s) => s.o.source === "rules").length} rule-based).` : verdict === "no_opportunity" ? `No compelling opportunity: ${verdictReason}` : "No pattern matched; AI analysis not run."}`, { investigationId: invId });
    if (verdict === "opportunity") await advanceStageIfBehind(businessId, "qualified", "investigation found an opportunity");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(investigations).set({ status: "failed", finishedAt: nowIso(), durationMs: Date.now() - started, error: msg, notes, creditsUsed }).where(eq(investigations.id, invId)).run();
    await setStatus("failed", msg.slice(0, 200));
    throw err;
  }
}

/** Below this many verified content facts the verdict is "insufficient evidence"; a single-page site needs a few more to count as seen. */
export const MIN_VERIFIED_FOR_VERDICT = 5;
export const MIN_VERIFIED_SINGLE_PAGE = 7;
/** Measured for nearly every reachable site; they say nothing about how the business operates, so they do not count toward the verdict threshold. */
/** Which email to store after an investigation: see the call site. Exported for tests. */
export function pickEmail(stored: string | null, verified: string | null, websiteDomain: string | null): string | null {
  const own = (e: string | null) => Boolean(e && websiteDomain && (e.endsWith(`@${websiteDomain}`) || e.endsWith(`.${websiteDomain}`)));
  if (verified && !isVendorEmail(verified)) {
    if (own(verified) || !stored || isVendorEmail(stored) || !own(stored)) return verified;
    return stored;
  }
  return stored && isVendorEmail(stored) ? null : stored;
}

export const MEASURED_KEYS = new Set<string>(["website_health", "website_updated", "domain_registered", "site_first_seen", "email_provider"]);

/** Opportunities kept per business after ranking: all model hypotheses (≤3) plus rule-based patterns up to this total. */
export const MAX_OPPORTUNITIES = 5;

// ------------------------------------------------------------------ outreach
export async function handleGenerateOutreach(job: JobRow, progress: ProgressFn, signal: AbortSignal = new AbortController().signal) {
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
  const oppInput = { title: opp.title, category: opp.category, problemHypothesis: opp.problemHypothesis, proposedSolution: opp.proposedSolution, expectedValue: opp.expectedValue, salesAngle: opp.salesAngle, supportingFactKeys: opp.supportingFactKeys, validationQuestions: opp.validationQuestions };
  const factInput = factRows.map((f) => ({ key: f.key, status: f.status, value: f.value }));
  try {
    let out: Awaited<ReturnType<typeof generateOutreach>>;
    let templateReason: string | null = getConfig().ai.enabled ? null : "AI is not configured";
    if (!templateReason) {
      try {
        out = await generateOutreach({ id: biz.id, name: biz.name, city: biz.city, region: biz.region }, oppInput, factInput, style, senderName);
      } catch (err) {
        if (err instanceof AiSpendLimitError || err instanceof AiUnavailableError) templateReason = err.message;
        else throw err;
        out = undefined as never;
      }
    }
    if (templateReason) {
      const draft = draftFromTemplate({ name: biz.name, city: biz.city }, oppInput, factInput, style, senderName);
      const validated = validateOutreach(draft, factInput);
      out = { draft: validated.draft, warnings: [`Template draft (${templateReason}): built only from verified facts and gaps; review the wording before sending.`, ...validated.warnings], model: "template", costUsd: 0 };
    }
    const warnings = [...out!.warnings];
    if (!biz.email) warnings.push("No verified email address for this business; recipient must be found manually.");
    signal.throwIfAborted();
    await db
      .insert(outreachDrafts)
      .values({ id: newId(), businessId, opportunityId: opp.id, style, channel: "email", toEmail: biz.email ?? null, subject: out!.draft.subject, body: out!.draft.body, claims: out!.draft.claims, warnings, status: "draft", model: out!.model })
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
