/**
 * Jobs: discover a search, investigate a business, draft outreach.
 * Investigation is one job: fetch → detect facts → (AI) profile + one
 * consolidated opportunity → score → qualify. A failure for one business never
 * affects another.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, facts, inboundEmails, investigations, observations, opportunities, outreachDrafts, pages, prospects, searches } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { runDiscovery, type RunOutcome } from "@/lib/discovery/engine";
import { investigateWithModel, AiRefusalError, AiSpendLimitError, AiUnavailableError } from "@/lib/ai";
import { greetingFor, writeOutreachEmail } from "@/lib/ai/outreach";
import { companyNameFor } from "@/lib/outreach/company-name";
import { buildEvidencePack } from "@/lib/outreach/evidence";
import { batchPeers } from "@/lib/outreach/drafts";
import { contactBlockers, OUTBOUND_COMMITTED } from "@/lib/outreach/eligibility";
import { hasBlock } from "@/lib/outreach/validate";
import { isWrittenStep, STEP, stepLabel, stepNoun, type WrittenStep } from "@/lib/outreach/steps";
import { openCampaign } from "@/lib/outreach/campaigns";
import { getSettings } from "@/lib/settings";
import { newId, nowIso } from "@/lib/ids";
import { createHash } from "node:crypto";
import { crawlStaged, type CrawlResult, type StagedCrawlResult } from "@/lib/research/crawl";
import { detectFacts, isVendorEmail, type DetectedFact } from "@/lib/research/detect";
import { isFirecrawlConfigured, scrapePage } from "@/lib/research/firecrawl";
import { creditsUsedThisMonth, loadStoredPages } from "@/lib/research/stored";
import { UsageLimitError, assertRoom, count as countUsage, countOrRefuse } from "@/lib/usage";
import { footprintFacts } from "@/lib/research/footprint";
import { findWebsite } from "@/lib/discovery/find-website";
import { normalizeWebsite, websiteDomain } from "@/lib/discovery/normalize";
import { scoreOpportunity, priorityScore } from "@/lib/scoring/score";
import { leadScore } from "@/lib/scoring/lead";
import { consolidatePatterns, ruleOpportunities } from "@/lib/scoring/rules";
import { contradictionsFor, qualify } from "@/lib/scoring/qualify";
import { INVESTIGATE_PROMPT_VERSION, OUTREACH_PROMPT_VERSION } from "@/lib/ai/prompts";
import { checkEmailAddress } from "@/lib/email/address";
import { verdictLabel } from "@/lib/pipeline/stages";
import { getPlaybook, type OpportunityCategory } from "@/lib/industries";
import { filtersOf } from "@/lib/search-input";
import { advanceStageIfBehind, ensureProspect, logActivity, markResearching, syncStageWithVerdict } from "@/lib/pipeline/prospects";
import { enqueueJob, type JobRow } from "./queue";
import { assertBusinessInWorkspace, businessInWorkspace, workspaceId } from "@/lib/workspace";

export type ProgressFn = (p: { message?: string; done?: number; total?: number }) => void;
export class NonRetryableError extends Error {}
/** Worth another attempt after a pause (a mail server asked to try later, a connection could not be made). */
export class RetryableError extends Error {}

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
  const search = await db.select().from(searches).where(and(eq(searches.id, searchId), eq(searches.workspaceId, await workspaceId()))).get();
  if (!search) throw new NonRetryableError(`Search ${searchId} not found`);
  // A search counts against the plan when it starts (a retry of the same job is the same search).
  if (job.attempts <= 1) {
    try {
      await countOrRefuse("searches");
    } catch (err) {
      if (!(err instanceof UsageLimitError)) throw err;
      await db.update(searches).set({ status: "failed", error: err.message, updatedAt: nowIso() }).where(eq(searches.id, searchId)).run();
      throw new NonRetryableError(err.message);
    }
  }
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
      const full = await tryInvestigation(t.id);
      if (full) {
        note(full);
        break;
      }
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

/**
 * As `enqueueInvestigation`, for the places that queue research on someone's behalf: a full plan is an answer,
 * not an error. Returns null when it was queued, otherwise the reason nothing was.
 */
export async function tryInvestigation(businessId: string, mode: InvestigateMode = "auto"): Promise<string | null> {
  try {
    await enqueueInvestigation(businessId, mode);
    return null;
  } catch (err) {
    if (err instanceof UsageLimitError) return err.message;
    throw err;
  }
}

export async function enqueueInvestigation(businessId: string, mode: InvestigateMode = "auto") {
  await assertBusinessInWorkspace(businessId);
  // The plan's monthly research allowance: nothing is queued beyond it (the caller decides what to say).
  await assertRoom("research");
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
  } else if (job.type === "send_email") {
    // The outcome is not known: never re-sent on a guess. The operator checks the Sent folder and retries if needed.
    await db.update(outreachDrafts).set({ status: "failed", lastError: "Sending timed out and the outcome is not known. Check your Sent folder; if the email is not there, use Retry.", updatedAt: nowIso() }).where(and(eq(outreachDrafts.id, String(job.payload.draftId)), eq(outreachDrafts.status, "sending"))).run();
  }
}

// --------------------------------------------------------------- investigate
/**
 * One job per business:
 *   locate website (if none) → email probe (homepage + contact page) → remaining
 *   key pages ‖ off-site footprint → detect facts → ONE model call (profile,
 *   observations, one consolidated opportunity) or rules-only consolidation →
 *   score → qualify. Every step is bounded; failures are explicit.
 */
export async function handleInvestigateBusiness(job: JobRow, progress: ProgressFn, signal: AbortSignal = new AbortController().signal) {
  const db = await getDb();
  const businessId = String(job.payload.businessId);
  // The job runs as the workspace it was queued in: a business of another workspace is "not found".
  let biz = (await db.select().from(businesses).where(and(eq(businesses.id, businessId), eq(businesses.workspaceId, await workspaceId()))).get())!;
  if (!biz) throw new NonRetryableError(`Business ${businessId} not found`);
  await ensureProspect(businessId);
  // Researching a business counts against the plan when it starts (a retry of the same job is the same research).
  if (job.attempts <= 1) {
    try {
      await countOrRefuse("research");
    } catch (err) {
      if (!(err instanceof UsageLimitError)) throw err;
      await db.update(businesses).set({ status: biz.investigatedAt ? "profiled" : "new", statusMessage: err.message, updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
      throw new NonRetryableError(err.message);
    }
  }
  const setStatus = (status: string, statusMessage: string | null, extra: Partial<typeof businesses.$inferInsert> = {}) => db.update(businesses).set({ status, statusMessage, updatedAt: nowIso(), ...extra }).where(eq(businesses.id, businessId)).run();
  const cfg = getConfig();
  const notes: string[] = [];
  const hints = () => ({ brand: biz.brand, reviewCount: biz.reviewCount, rating: biz.rating });

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
    const lead = leadScore({ ...biz, website }, hints());
    await db.update(businesses).set({ website, websiteDomain: websiteDomain(website), websiteSource: found.source, leadScore: lead.score, kind: lead.kind, updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
    await logActivity(businessId, "system", `Website located by ${found.source === "found_search" ? "web search" : found.source === "found_email" ? "its email domain" : "domain guess"} and verified: ${website} (${found.evidence}).`, { confidence: found.confidence });
    biz = (await db.select().from(businesses).where(eq(businesses.id, businessId)).get())!;
  }

  // Stored pages from a recent investigation are reused instead of spending credits: automatically within
  // RESEARCH_STALE_DAYS, always on "re-analyze", never on "research again". Pages kept from an email probe
  // (homepage + contact page only) are not a full crawl, so they are reused only when re-analysis was asked for.
  const mode = (job.payload.mode as InvestigateMode | undefined) ?? "auto";
  let stored = mode === "recrawl" ? null : await loadStoredPages(businessId, biz.website!, mode === "reanalyze" ? Number.POSITIVE_INFINITY : cfg.RESEARCH_STALE_DAYS);
  if (stored?.probeOnly && mode !== "reanalyze") stored = null;
  if (!stored) await requireFirecrawl(setStatus);

  await setStatus("investigating", stored ? "Re-analyzing stored pages" : "Fetching website via Firecrawl");
  const invId = newId();
  const started = Date.now();
  await db.insert(investigations).values({ id: invId, businessId, status: "running" }).run();
  await markResearching(businessId);

  try {
    // 1. Crawl (or reuse stored pages) and off-site footprint in parallel. A new crawl starts with the email probe.
    const needEmail = cfg.RESEARCH_REQUIRE_EMAIL && !biz.email;
    const runFootprint = (site: string) => (cfg.RESEARCH_FOOTPRINT ? footprintFacts(site, { signal }).catch((err) => ({ facts: [] as DetectedFact[], notes: [`Footprint lookups failed: ${(err as Error).message}`] })) : Promise.resolve({ facts: [] as DetectedFact[], notes: [] as string[] }));
    const runCrawl = (site: string): Promise<StagedCrawlResult> =>
      stored
        ? Promise.resolve({ pages: stored.pages, notes: [`Reused ${stored.pages.length} stored page(s) from ${stored.startedAt.slice(0, 10)} (${stored.ageDays} day(s) old, 0 credits)${mode === "reanalyze" ? " on request" : "; use “Research again” for a fresh crawl"}`], durationMs: 0, home: stored.pages.find((p) => p.kind === "home" && p.content) ?? null, credits: 0, stoppedEarly: null, stoppedForEmail: false })
        : crawlStaged(site, { onProgress: (m) => progress({ message: m }), signal, needEmail });
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
    const detectedEmail = detected.find((f) => f.key === "email" && f.status === "verified") ?? null;
    const detectedPhone = detected.find((f) => f.key === "phone" && f.status === "verified")?.value ?? null;

    // 2b. The email gate: without a public address there is nobody to write to, so the remaining pages (already
    // skipped by the probe) and the model call are not spent. Existing research on the business is left as it is.
    if (cfg.RESEARCH_REQUIRE_EMAIL && !pickEmail(biz.email, detectedEmail?.value ?? null, biz.websiteDomain)) {
      const reason = `No public email address was found on the ${fetched.length === 1 ? "homepage" : `${fetched.length} page(s) read`}; research paused before the full analysis. Add an email to continue.`;
      const hasFacts = Boolean(await db.select({ id: facts.id }).from(facts).where(eq(facts.businessId, businessId)).limit(1).get());
      const writes = [
        ...(hasFacts ? [] : detected.map((d) => db.insert(facts).values({ id: newId(), businessId, investigationId: invId, key: d.key, status: d.status === "unknown" ? "not_found" : d.status, value: d.value, evidenceQuote: d.evidenceQuote, sourceUrl: d.sourceUrl, method: "detected" }))),
        db.update(businesses).set({ status: "profiled", statusMessage: "No public email found; research paused", verdict: "no_contact", verdictReasons: [reason], phone: biz.phone ?? detectedPhone, email: pickEmail(biz.email, null, biz.websiteDomain), investigatedAt: nowIso(), updatedAt: nowIso() }).where(eq(businesses.id, businessId)),
        db.update(investigations).set({ status: "done", finishedAt: nowIso(), durationMs: Date.now() - started, pagesFetched: fetched.length, pagesFailed: failed.length, factsVerified: detected.filter((d) => d.status === "verified").length, creditsUsed, verdict: "no_contact", verdictReason: reason, warnings: [], notes }).where(eq(investigations.id, invId)),
      ] as const;
      signal.throwIfAborted();
      await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
      await logActivity(businessId, "system", `Research paused after ${fetched.length} page(s) and ${creditsUsed} Firecrawl credit(s): no public email address found.`, { investigationId: invId });
      await syncStageWithVerdict(businessId, "no_contact");
      return;
    }

    // 3. Model (optional), validated in code. Fixed rule patterns are handed to it as candidates, never kept beside it.
    const playbook = getPlaybook(biz.industry);
    const asFacts = (list: DetectedFact[]) => list.map((d) => ({ key: d.key, status: d.status === "unknown" ? ("not_found" as const) : d.status, value: d.value, evidenceQuote: d.evidenceQuote, sourceUrl: d.sourceUrl }));
    const patterns = ruleOpportunities(asFacts(detected), playbook);
    let outcome: Awaited<ReturnType<typeof investigateWithModel>> | null = null;
    const warnings: string[] = [];
    let model: string | null = null;
    let costUsd = 0;
    let aiSkipped: string | null = cfg.ai.enabled ? null : "AI is not configured";
    signal.throwIfAborted();
    if (cfg.ai.enabled) {
      try {
        outcome = await investigateWithModel({ id: biz.id, name: biz.name, industry: biz.industry, city: biz.city, region: biz.region, category: biz.category }, fetched.map((p) => ({ url: p.url, kind: p.kind, title: p.content!.title, text: p.content!.text })), detected, {
          listing: biz.reviewCount != null ? `${biz.rating ?? "unrated"} rating from ${biz.reviewCount} reviews on Google Maps` : null,
          patterns: patterns.map((p) => ({ category: p.category, title: p.title, keys: p.supporting_fact_keys })),
        });
        warnings.push(...outcome.warnings);
        model = outcome.model;
        costUsd = outcome.costUsd;
        if (outcome.rejected.length) notes.push(`Rejected ${outcome.rejected.length} model fact(s)/observation(s) whose evidence could not be verified verbatim`);
      } catch (err) {
        if (err instanceof AiSpendLimitError || err instanceof AiRefusalError || err instanceof AiUnavailableError) {
          aiSkipped = err.message;
          notes.push(`AI investigation skipped: ${err.message}`);
        } else throw err;
      }
    }
    const finalFacts = outcome ? outcome.facts : asFacts(detected);
    const finalObservations = outcome?.observations ?? [];
    const summaryFact = finalFacts.find((f) => f.key === "summary" && f.status === "verified");

    // 4. One consolidated opportunity: the model's when it ran (its "no" is final), otherwise the rule patterns grouped in code.
    const candidates = outcome ? outcome.opportunities.map((o) => ({ ...o, source: "ai" as const })) : consolidatePatterns(patterns).map((o) => ({ ...o, source: "rules" as const }));

    // 5. Score. Observations are verified evidence (their quotes were checked); gaps are not.
    const verifiedKeys = new Set(finalFacts.filter((f) => f.status === "verified").map((f) => f.key as string));
    const gapKeys = new Set(finalFacts.filter((f) => f.status === "not_found").map((f) => f.key as string));
    const observationRefs = new Set(finalObservations.map((o) => o.ref));
    const scoredAll = candidates.map((o) => {
      const verifiedEvidence = o.supporting_fact_keys.filter((k) => verifiedKeys.has(k) || observationRefs.has(k)).length;
      const gapEvidence = o.supporting_fact_keys.filter((k) => gapKeys.has(k)).length;
      const score = scoreOpportunity({
        category: o.category as OpportunityCategory,
        aiRatings: { value: o.ratings.value, feasibility: o.ratings.feasibility, evidenceStrength: o.ratings.evidence_strength },
        implementationEffort: o.implementation_effort,
        reusability: o.reusability,
        supportingVerifiedCount: verifiedEvidence,
        supportingGapCount: gapEvidence,
        totalVerifiedFacts: verifiedKeys.size + observationRefs.size,
        pagesResearched: fetched.length,
        assumptionCount: o.assumptions.length,
      });
      return { o, score, priority: priorityScore(score.attractiveness, score.confidence), verifiedEvidence, gapEvidence };
    });
    const primary = scoredAll.find((s) => s.o.role === "primary") ?? null;
    const scored = [...(primary ? [primary] : []), ...scoredAll.filter((s) => s !== primary).sort((a, b) => b.priority - a.priority)].slice(0, MAX_OPPORTUNITIES);

    // 6. Qualify. Measured keys (health, dates, hosting) exist for nearly every reachable site, so only content counts as "seen enough".
    const contentVerified = [...verifiedKeys].filter((k) => !MEASURED_KEYS.has(k)).length + observationRefs.size;
    const thin = contentVerified < MIN_VERIFIED_FOR_VERDICT || (fetched.length <= 1 && contentVerified < MIN_VERIFIED_SINGLE_PAGE);
    const q = qualify({
      kind: biz.kind,
      thin,
      thinReason: `Only ${fetched.length} page(s) could be read and ${contentVerified} fact(s) about the business verified; the site does not show enough to assess.`,
      modelRan: Boolean(outcome),
      modelVerdict: outcome?.verdict ?? null,
      modelReason: outcome?.verdictReason ?? null,
      aiSkipped,
      primary: primary ? { source: primary.o.source, title: primary.o.title, verifiedEvidence: primary.verifiedEvidence, gapEvidence: primary.gapEvidence, confidence: primary.score.confidence, attractiveness: primary.score.attractiveness, contradictions: contradictionsFor(primary.o.category, finalFacts) } : null,
    });
    const verdict = q.verdict;
    const verdictReason = q.reasons.join(" ");

    // 7. Contact: the address the site publishes, where it was found, and whether its domain accepts mail.
    const verifiedEmail = finalFacts.find((f) => f.key === "email" && f.status === "verified") ?? null;
    const email = pickEmail(biz.email, verifiedEmail?.value ?? null, biz.websiteDomain);
    const fromSite = Boolean(email && verifiedEmail?.value === email);
    const emailCheck = email ? await checkEmailAddress(email, { mx: cfg.RESEARCH_FOOTPRINT }) : null;
    const phoneFact = finalFacts.find((f) => f.key === "phone" && f.status === "verified")?.value ?? null;
    const contactFact = finalFacts.find((f) => f.key === "contact_person" && f.status === "verified")?.value ?? null;

    // 8. Persist atomically: replace facts, observations and opportunities for this business (one batch; see src/db/client.ts).
    const statusMessage =
      verdict === "qualified" ? `Qualified: ${primary!.o.title}` : verdict === "needs_review" ? (primary ? `Needs review: ${primary.o.title}` : "Needs review") : verdict === "not_a_fit" ? "Not a fit: no convincing opportunity" : `Insufficient evidence: ${fetched.length} page(s), ${contentVerified} verified fact(s)`;
    const writes = [
      db.delete(facts).where(eq(facts.businessId, businessId)),
      ...finalFacts.map((f) => {
        const method = detected.some((d) => d.key === f.key && d.status === f.status && d.value === f.value) ? "detected" : "ai";
        return db.insert(facts).values({ id: newId(), businessId, investigationId: invId, key: f.key, status: f.status, value: f.value, evidenceQuote: f.evidenceQuote, sourceUrl: f.sourceUrl, method });
      }),
      db.delete(observations).where(eq(observations.businessId, businessId)),
      ...finalObservations.map((o) => db.insert(observations).values({ id: newId(), businessId, investigationId: invId, ref: o.ref, kind: o.kind, statement: o.statement, evidenceQuote: o.evidenceQuote, sourceUrl: o.sourceUrl })),
      db.delete(opportunities).where(eq(opportunities.businessId, businessId)),
      ...scored.map(({ o, score }, i) =>
        db
          .insert(opportunities)
          .values({ id: newId(), investigationId: invId, businessId, category: o.category, title: o.title, problemHypothesis: o.problem_hypothesis, proposedSolution: o.proposed_solution, whyNotExistingTool: o.why_not_existing_tool, expectedValue: o.expected_value, supportingFactKeys: o.supporting_fact_keys, assumptions: o.assumptions, validationQuestions: o.validation_questions, implementationEffort: o.implementation_effort, reusability: o.reusability, risks: o.risks, salesAngle: o.sales_angle, aiRatings: { value: o.ratings.value, feasibility: o.ratings.feasibility, evidenceStrength: o.ratings.evidence_strength }, attractivenessScore: score.attractiveness, confidenceScore: score.confidence, scoreBreakdown: score.breakdown, rank: i + 1, source: o.source, role: o.role, components: o.components, whyRelevant: o.why_relevant, scope: o.scope, promptVersion: o.source === "ai" ? INVESTIGATE_PROMPT_VERSION : "rules" }),
      ),
      db
        .update(businesses)
        .set({
          status: "profiled",
          statusMessage,
          verdict,
          verdictReasons: q.reasons,
          summary: summaryFact?.value ?? null,
          // The email verified by this run wins unless the stored one is on the business's own domain (the one case
          // where an older value is at least as trustworthy); vendor/widget addresses are never kept.
          email,
          emailSource: email ? (fromSite ? "site" : (biz.emailSource ?? "listing")) : null,
          emailSourceUrl: email ? (fromSite ? verifiedEmail!.sourceUrl : biz.emailSourceUrl) : null,
          emailStatus: emailCheck?.status ?? null,
          contactName: contactFact ? contactFact.slice(0, 80) : null,
          phone: biz.phone ?? phoneFact,
          bestAttractiveness: primary?.score.attractiveness ?? null,
          bestConfidence: primary?.score.confidence ?? null,
          priority: primary ? primary.priority : null,
          investigatedAt: nowIso(),
          updatedAt: nowIso(),
        })
        .where(eq(businesses.id, businessId)),
      db
        .update(investigations)
        .set({ status: "done", finishedAt: nowIso(), durationMs: Date.now() - started, pagesFetched: fetched.length, pagesFailed: failed.length, factsVerified: verifiedKeys.size + observationRefs.size, factsRejected: outcome?.rejected.length ?? 0, model, costUsd, creditsUsed, workflows: [], verdict, verdictReason, warnings, notes, promptVersion: outcome ? INVESTIGATE_PROMPT_VERSION : "rules" })
        .where(eq(investigations.id, invId)),
    ] as const;
    signal.throwIfAborted();
    await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
    await logActivity(
      businessId,
      "system",
      `Investigated in ${((Date.now() - started) / 1000).toFixed(1)}s: ${fetched.length} page(s), ${verifiedKeys.size} verified facts, ${observationRefs.size} observation(s), ${creditsUsed} Firecrawl credit(s). ${verdictLabel(verdict)}${primary && verdict !== "not_a_fit" ? `: “${primary.o.title}” (${primary.o.source === "ai" ? "AI" : "rule-based"}, ${primary.o.components.length} part(s))` : ""}. ${verdictReason}`,
      { investigationId: invId, verdict },
    );
    await syncStageWithVerdict(businessId, verdict);
    // An unsent email for a business the research now sets aside rests on an idea that no longer stands: withdraw it.
    if (verdict === "not_a_fit") await db.update(outreachDrafts).set({ status: "archived", updatedAt: nowIso() }).where(and(eq(outreachDrafts.businessId, businessId), inArray(outreachDrafts.status, ["needs_review", "ready", "approved", "excluded"]))).run();
    // A qualified business with a usable address gets its email written right away (Settings → Automation).
    if (verdict === "qualified") await maybeAutoDraft(businessId).catch((err) => console.warn(`[outreach] could not queue the email for ${businessId}:`, err));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(investigations).set({ status: "failed", finishedAt: nowIso(), durationMs: Date.now() - started, error: msg, notes, creditsUsed }).where(eq(investigations.id, invId)).run();
    await setStatus("failed", msg.slice(0, 200));
    await syncStageWithVerdict(businessId, "failed").catch(() => {});
    throw err;
  }
}

/** Below this many verified content facts the outcome is "insufficient evidence"; a single-page site needs a few more to count as seen. */
export const MIN_VERIFIED_FOR_VERDICT = 5;
export const MIN_VERIFIED_SINGLE_PAGE = 7;
/** Which email to store after an investigation: see the call site. Exported for tests. */
export function pickEmail(stored: string | null, verified: string | null, websiteDomain: string | null): string | null {
  const own = (e: string | null) => Boolean(e && websiteDomain && (e.endsWith(`@${websiteDomain}`) || e.endsWith(`.${websiteDomain}`)));
  if (verified && !isVendorEmail(verified)) {
    if (own(verified) || !stored || isVendorEmail(stored) || !own(stored)) return verified;
    return stored;
  }
  return stored && isVendorEmail(stored) ? null : stored;
}

/** Measured for nearly every reachable site; they say nothing about how the business operates, so they do not count toward "seen enough". */
export const MEASURED_KEYS = new Set<string>(["website_health", "website_updated", "domain_registered", "site_first_seen", "email_provider"]);

/** One primary opportunity plus at most two independent secondary ideas. */
export const MAX_OPPORTUNITIES = 3;

// ------------------------------------------------------------------ outreach
/** Queue the email for a business: step 0 = first email, 1 = follow-up, 2 = last note, 3 = check-back (steps.ts). One job per business and step at a time. */
export async function enqueueOutreach(businessId: string, opts: { step?: WrittenStep; feedback?: string | null } = {}) {
  const step = opts.step ?? 0;
  await assertBusinessInWorkspace(businessId);
  return enqueueJob("generate_outreach", { businessId, step, feedback: opts.feedback ?? null }, { idempotencyKey: `outreach:${businessId}:${step}` });
}

/**
 * After research: a qualified business with a usable address gets its email
 * written without anyone asking, unless the operator already touched one
 * (edited or approved it) or switched this off.
 */
export async function maybeAutoDraft(businessId: string): Promise<boolean> {
  const cfg = getConfig();
  if (!cfg.ai.enabled) return false;
  const settings = await getSettings();
  if (!settings.autoDraft) return false;
  const db = await getDb();
  const biz = await db.select().from(businesses).where(and(eq(businesses.id, businessId), eq(businesses.workspaceId, await workspaceId()))).get();
  if (!biz || biz.verdict !== "qualified") return false;
  if ((await contactBlockers(biz, settings)).length) return false;
  const existing = await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.businessId, businessId), eq(outreachDrafts.step, 0), ne(outreachDrafts.status, "archived"))).all();
  // Already written and touched by the operator, or already on its way: leave it alone.
  if (existing.some((d) => !["needs_review", "ready"].includes(d.status) || d.editedByUser)) return false;
  await enqueueOutreach(businessId);
  return true;
}

/**
 * Writes one email: evidence pack → writer → fixed checks → independent claim
 * check (→ one rewrite when something fails). The result replaces any earlier
 * unsent email for the same business and step and lands in the open batch as
 * "ready" (all checks passed, recipient usable) or "needs review".
 */
export async function handleGenerateOutreach(job: JobRow, progress: ProgressFn, signal: AbortSignal = new AbortController().signal) {
  const db = await getDb();
  const cfg = getConfig();
  const businessId = String(job.payload.businessId);
  const rawStep = Number(job.payload.step ?? 0);
  if (!isWrittenStep(rawStep)) throw new NonRetryableError(`Step ${rawStep} is not written from research`);
  const step: WrittenStep = rawStep;
  const feedback = (job.payload.feedback as string | null) ?? null;
  const biz = await db.select().from(businesses).where(and(eq(businesses.id, businessId), eq(businesses.workspaceId, await workspaceId()))).get();
  if (!biz) throw new NonRetryableError(`Business ${businessId} not found`);
  if (!cfg.ai.enabled) throw new NonRetryableError("Writing emails needs a model key (ANTHROPIC_API_KEY). Research and review work without it.");
  const opp = (await db.select().from(opportunities).where(and(eq(opportunities.businessId, businessId), eq(opportunities.role, "primary"))).limit(1).get()) ?? (await db.select().from(opportunities).where(eq(opportunities.businessId, businessId)).orderBy(opportunities.rank).limit(1).get());
  if (!opp) throw new NonRetryableError("No opportunity to write about; research the business first");
  const committed = await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.businessId, businessId), inArray(outreachDrafts.status, OUTBOUND_COMMITTED))).orderBy(desc(outreachDrafts.createdAt)).all();
  const first = committed.find((d) => d.step === 0 && d.status === "sent") ?? null;
  if (step === 0 && committed.some((d) => d.step === 0)) throw new NonRetryableError("This business was already emailed; a second first email is never written");
  if (step > 0 && !first) throw new NonRetryableError(`A ${stepNoun(step)} needs a first email that was sent`);
  if (step > 0 && committed.some((d) => d.step === step)) throw new NonRetryableError(`A ${stepNoun(step)} was already sent to this business`);
  const followUp = committed.find((d) => d.step === STEP.followUp && d.status === "sent") ?? null;
  if (step === STEP.lastNote && !followUp) throw new NonRetryableError("A last note comes after a follow-up that was sent");
  // A check-back answers a "not now": it needs that reply, and carries what they said.
  const notNow = step === STEP.checkBack ? ((await db.select().from(inboundEmails).where(and(eq(inboundEmails.businessId, businessId), eq(inboundEmails.kind, "reply"))).orderBy(desc(inboundEmails.receivedAt)).limit(1).get()) ?? null) : null;
  if (step === STEP.checkBack && notNow?.classification !== "not_now") throw new NonRetryableError("A check-back is only written after a \"not now\"");

  // One alternative from the research, preferably of a different kind than the main idea: the follow-up may raise it.
  const alternatives = await db.select().from(opportunities).where(and(eq(opportunities.businessId, businessId), eq(opportunities.role, "secondary"), eq(opportunities.source, "ai"))).orderBy(desc(opportunities.attractivenessScore)).all();
  const alternative = alternatives.find((a) => a.id !== opp.id && a.scope && a.scope !== opp.scope) ?? alternatives.find((a) => a.id !== opp.id && a.category !== opp.category) ?? null;
  const settings = await getSettings();
  const campaign = await openCampaign();
  const [factRows, obsRows] = await Promise.all([db.select().from(facts).where(eq(facts.businessId, businessId)).all(), db.select().from(observations).where(eq(observations.businessId, businessId)).all()]);
  const pack = buildEvidencePack(factRows, obsRows, opp);
  const others = await batchPeers(campaign.id, businessId, step);
  // The company's own name: a map listing may carry a branch or be a search phrase (see company-name.ts).
  const pageRows = await db.select({ text: pages.text, title: pages.title }).from(pages).where(eq(pages.businessId, businessId)).all();
  const companyName = companyNameFor(biz.name, biz.website, pageRows.map((p) => p.text ?? ""), pageRows.map((p) => p.title ?? ""));
  progress({ message: `Writing the ${stepNoun(step)}` });
  let out: Awaited<ReturnType<typeof writeOutreachEmail>>;
  try {
    out = await writeOutreachEmail({
      business: { id: biz.id, name: companyName, city: biz.city, region: biz.region, category: biz.category },
      greeting: greetingFor(companyName),
      sender: { name: settings.senderName, company: settings.senderCompany, offer: settings.offer, bookingLink: settings.bookingLink, voiceSamples: settings.voiceSamples },
      // The plain-words pitch is only trusted from the model: the fixed rule patterns phrase theirs around what was not found.
      opportunity: { title: opp.title, problemHypothesis: opp.problemHypothesis, proposedSolution: opp.proposedSolution, whyRelevant: opp.whyRelevant, pitch: opp.source === "ai" ? opp.salesAngle : null, expectedValue: opp.expectedValue, scope: opp.scope, components: (opp.components ?? []).map((c) => ({ name: c.name, description: c.description })), validationQuestions: opp.validationQuestions },
      also: alternative ? { inPlainWords: `${alternative.title}. ${alternative.salesAngle ?? ""}`.trim(), scope: alternative.scope } : null,
      pack,
      step,
      firstEmail: first ? { subject: first.subject ?? "", body: first.body } : null,
      followUpEmail: step === STEP.lastNote && followUp ? { body: followUp.body } : null,
      theirReply: notNow ? { receivedAt: notNow.receivedAt, summary: notNow.classificationSummary ?? "They said not now." } : null,
      others,
      feedback,
    });
  } catch (err) {
    if (err instanceof AiSpendLimitError || err instanceof AiRefusalError || err instanceof AiUnavailableError) throw new NonRetryableError(err.message);
    throw err;
  }
  signal.throwIfAborted();

  const blockers = await contactBlockers(biz, settings);
  const issues = [...out.validation.issues, ...blockers.map((message) => ({ severity: "block" as const, code: "recipient", message }))];
  const validation = { ...out.validation, issues, passed: !hasBlock(issues) };
  const status = validation.passed ? "ready" : "needs_review";
  const id = newId();
  await db.batch([
    // The new email replaces earlier unsent ones for the same step; they stay in the history as archived.
    db.update(outreachDrafts).set({ status: "archived", updatedAt: nowIso() }).where(and(eq(outreachDrafts.businessId, businessId), eq(outreachDrafts.step, step), inArray(outreachDrafts.status, ["needs_review", "ready", "approved", "excluded", "failed"]))),
    db.insert(outreachDrafts).values({ id, businessId, opportunityId: opp.id, campaignId: campaign.id, step, style: "personal", channel: "email", toEmail: biz.email ?? null, subject: out.email.subject, body: out.email.body, claims: out.email.claims, warnings: issues.map((i) => i.message), validation, status, model: out.model, costUsd: out.costUsd, promptVersion: OUTREACH_PROMPT_VERSION, inReplyTo: step > 0 ? (first?.messageId ?? null) : null }),
    // The check-back is written: the date that asked for it is done with.
    ...(step === STEP.checkBack ? [db.update(prospects).set({ recontactAt: null, updatedAt: nowIso() }).where(eq(prospects.businessId, businessId))] : []),
  ]);
  await countUsage("emails");
  await logActivity(businessId, "system", `${step === 0 ? "Outreach email" : stepLabel(step)} written for “${opp.title}” (${out.attempts} attempt(s), $${out.costUsd.toFixed(3)}): ${validation.passed ? "all checks passed, ready for review" : `needs review: ${issues.filter((i) => i.severity === "block").map((i) => i.message).join(" ")}`}`, { draftId: id, status });
  if (step === 0 && validation.passed) await advanceStageIfBehind(businessId, "ready_to_contact", "email written and checked");
}

/** Latest investigation for a business (helper for pages). */
export async function latestInvestigation(businessId: string) {
  if (!(await businessInWorkspace(businessId))) return null; // another workspace's research is "not there"
  const db = await getDb();
  return (await db.select().from(investigations).where(eq(investigations.businessId, businessId)).orderBy(desc(investigations.startedAt)).limit(1).get()) ?? null;
}
