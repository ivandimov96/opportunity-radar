/**
 * Three jobs: discover a search, investigate a business, draft outreach.
 * Investigation is one job: fetch → detect facts → (AI) profile + opportunities
 * → score → verdict. A failure for one business never affects another.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, businessSources, facts, investigations, opportunities, outreachDrafts, pages, searchResults, searches, type SearchStats } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { PROVIDERS, upsertCandidate, type BusinessCandidate, type DiscoveryProviderKey } from "@/lib/discovery";
import { ProviderError } from "@/lib/discovery/types";
import { generateOutreach, investigateWithModel, AiRefusalError, AiSpendLimitError, AiUnavailableError, type OutreachStyle } from "@/lib/ai";
import { validateOutreach } from "@/lib/ai/outreach";
import { draftFromTemplate } from "@/lib/outreach/template";
import { newId, nowIso } from "@/lib/ids";
import { crawlWebsite } from "@/lib/research/crawler";
import { detectFacts, isVendorEmail, type DetectedFact } from "@/lib/research/detect";
import { safeFetch } from "@/lib/research/fetcher";
import { footprintFacts } from "@/lib/research/footprint";
import { findWebsite } from "@/lib/discovery/find-website";
import { normalizeCity, normalizeName, normalizePhone, normalizeWebsite, websiteDomain } from "@/lib/discovery/normalize";
import { scoreOpportunity, priorityScore } from "@/lib/scoring/score";
import { leadScore, type LeadHints } from "@/lib/scoring/lead";
import { ruleOpportunities } from "@/lib/scoring/rules";
import { getPlaybook, type OpportunityCategory } from "@/lib/industries";
import { filtersOf } from "@/lib/search-input";
import { advanceStageIfBehind, ensureProspect, logActivity } from "@/lib/pipeline/prospects";
import { enqueueJob, type JobRow } from "./queue";

export type ProgressFn = (p: { message?: string; done?: number; total?: number }) => void;
export class NonRetryableError extends Error {}

// ------------------------------------------------------------------ discover
/**
 * Discovery in two phases so the result cap keeps the BEST candidates, not the
 * first ones a source happened to return:
 *   1. collect from every selected source (each source fails on its own);
 *   2. score every candidate from discovery data alone (lead score + hints),
 *      apply the filters with skip counts, rank, then store up to the cap.
 * Candidates beyond the cap that match a listed business are still merged so
 * their source record (e.g. a permit date) is not lost.
 */
export async function handleDiscoverSearch(job: JobRow, progress: ProgressFn, signal: AbortSignal = new AbortController().signal) {
  const db = await getDb();
  const searchId = String(job.payload.searchId);
  const search = await db.select().from(searches).where(eq(searches.id, searchId)).get();
  if (!search) throw new NonRetryableError(`Search ${searchId} not found`);
  await db.update(searches).set({ status: "running", updatedAt: nowIso(), error: null }).where(eq(searches.id, searchId)).run();

  const filters = filtersOf(search);
  const stats: SearchStats = { providerResults: {}, notes: [], durationMs: 0, candidates: 0, ranked: 0, created: 0, merged: 0, skippedNoWebsite: 0, skippedNoPhone: 0, skippedChains: 0, skippedKnown: 0, skippedClosed: 0, queuedForInvestigation: 0, area: null, total: 0, attribution: [] };
  const providerKeys = (search.providers as DiscoveryProviderKey[]).filter((k): k is Exclude<DiscoveryProviderKey, "csv"> => k !== "csv");
  const errors: string[] = [];
  const startedAt = Date.now();
  const note = (m: string) => stats.notes!.push(m);

  // ---- 1. Collect
  const collected: { c: BusinessCandidate; key: Exclude<DiscoveryProviderKey, "csv"> }[] = [];
  for (const key of providerKeys) {
    const provider = PROVIDERS[key];
    if (!provider) continue;
    const avail = provider.isAvailable();
    if (!avail.available) {
      stats.providerResults[key] = { found: 0, error: avail.reason };
      continue;
    }
    signal.throwIfAborted();
    progress({ message: `Discovering via ${provider.label}` });
    const t0 = Date.now();
    try {
      const result = await provider.discover(
        { industry: search.industry, categoryQuery: search.categoryQuery, keywords: search.keywords, country: search.country, region: search.region, city: search.city, maxResults: search.maxResults, requireWebsite: search.requireWebsite, segments: filters.segments, areaMode: filters.areaMode, radiusKm: filters.radiusKm, lat: filters.centerLat ?? null, lng: filters.centerLon ?? null },
        { onProgress: (m) => progress({ message: `${provider.label}: ${m}` }) },
      );
      stats.providerResults[key] = { found: result.candidates.length, durationMs: Date.now() - t0 };
      if (result.area && !stats.area) stats.area = result.area;
      if (!stats.attribution.includes(result.attribution)) stats.attribution.push(result.attribution);
      for (const n of result.notes) note(`${provider.label}: ${n}`);
      note(`${provider.label}: ${result.candidates.length} candidate(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      for (const c of result.candidates) collected.push({ c, key });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.providerResults[key] = { found: 0, error: msg, durationMs: Date.now() - t0 };
      note(`${provider.label}: failed after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${msg}`);
      errors.push(`${provider.label}: ${msg}`);
      if (err instanceof ProviderError && err.retryable && providerKeys.length === 1 && job.attempts < job.maxAttempts) {
        await db.update(searches).set({ stats, status: "queued", error: msg, updatedAt: nowIso() }).where(eq(searches.id, searchId)).run();
        throw err;
      }
    }
  }

  // ---- 2. Score, filter, rank
  progress({ message: `Ranking ${collected.length} candidates` });
  const ownerCounts = new Map<string, number>();
  for (const { c } of collected) {
    const owner = (c.raw as { taxpayerName?: string | null } | undefined)?.taxpayerName?.toLowerCase();
    if (owner) ownerCounts.set(owner, (ownerCounts.get(owner) ?? 0) + 1);
  }
  const hintsFor = (c: BusinessCandidate): LeadHints => {
    const raw = (c.raw ?? {}) as { taxpayerName?: string | null; firstSalesDate?: string | null; opening_hours?: string };
    const years = raw.firstSalesDate ? (Date.now() - new Date(raw.firstSalesDate).getTime()) / (365.25 * 86_400_000) : null;
    return { openingHours: Boolean(raw.opening_hours), yearsActive: Number.isFinite(years as number) ? years : null, outletCount: raw.taxpayerName ? ownerCounts.get(raw.taxpayerName.toLowerCase()) ?? 1 : undefined, brand: c.brand ?? null };
  };
  type Ranked = { c: BusinessCandidate; key: Exclude<DiscoveryProviderKey, "csv">; lead: ReturnType<typeof leadScore>; hints: LeadHints };
  const ranked: Ranked[] = [];
  for (const { c, key } of collected) {
    if (c.operatingStatus === "closed") {
      stats.skippedClosed!++;
      continue;
    }
    if (search.requireWebsite && !c.website) {
      stats.skippedNoWebsite++;
      continue;
    }
    if (filters.requirePhone && !c.phone) {
      stats.skippedNoPhone!++;
      continue;
    }
    const hints = hintsFor(c);
    const lead = leadScore({ name: c.name, industry: search.industry, website: c.website, phone: c.phone, email: c.email, street: c.street, city: c.city, category: c.category }, hints);
    if (filters.excludeChains && lead.kind === "chain") {
      stats.skippedChains!++;
      continue;
    }
    ranked.push({ c, key, lead, hints });
  }
  ranked.sort((a, b) => b.lead.score - a.lead.score);
  stats.candidates = collected.length;
  stats.ranked = ranked.length;
  note(`Ranking: ${collected.length} candidate(s) collected; ${stats.skippedClosed} closed, ${stats.skippedNoWebsite} without website, ${stats.skippedNoPhone} without phone, ${stats.skippedChains} chain(s) skipped; ${ranked.length} ranked by lead score; cap ${search.maxResults}`);

  // ---- 3. Store the best up to the cap; merge the rest that match a listed business
  signal.throwIfAborted();
  let rank = 0;
  const seenIds = new Set<string>();
  const investigable: { id: string; leadScore: number }[] = [];
  const leftovers: Ranked[] = [];
  for (const r of ranked) {
    if (rank >= search.maxResults) {
      leftovers.push(r);
      continue;
    }
    const outcome = await upsertCandidate(db, r.c, { industry: search.industry, searchId, isDemo: r.key === "demo", leadReasons: r.lead.reasons });
    if (seenIds.has(outcome.businessId)) continue;
    seenIds.add(outcome.businessId);
    if (filters.skipKnown && !outcome.wasNew) {
      stats.skippedKnown!++;
      continue;
    }
    rank++;
    if (outcome.wasNew) stats.created++;
    else stats.merged++;
    await db.insert(searchResults).values({ searchId, businessId: outcome.businessId, rank, wasNew: outcome.wasNew }).onConflictDoNothing().run();
    await ensureProspect(outcome.businessId);
    const biz = await db.select().from(businesses).where(eq(businesses.id, outcome.businessId)).get();
    if (biz && r.key !== "demo") {
      const stored = leadScore(biz, r.hints);
      if (biz.leadScore !== stored.score || biz.kind !== stored.kind) await db.update(businesses).set({ leadScore: stored.score, kind: stored.kind, leadReasons: stored.reasons }).where(eq(businesses.id, biz.id)).run();
      if (search.autoInvestigate && stored.kind !== "chain" && stored.score >= filters.minLeadScore && ["new", "no_website", "failed"].includes(biz.status) && (biz.website || getConfig().RESEARCH_FIND_WEBSITE)) investigable.push({ id: biz.id, leadScore: stored.score });
    }
  }
  if (leftovers.length) {
    // Same business seen by another source (registry row for a map place, …): attach the source record without listing it again.
    const listed = await db.select({ id: businesses.id, nameNormalized: businesses.nameNormalized, city: businesses.city, phone: businesses.phone, websiteDomain: businesses.websiteDomain }).from(businesses).where(inArray(businesses.id, [...seenIds])).all();
    const byName = new Set(listed.map((b) => `${b.nameNormalized}|${normalizeCity(b.city) ?? ""}`));
    const byPhone = new Set(listed.map((b) => b.phone).filter(Boolean));
    const byDomain = new Set(listed.map((b) => b.websiteDomain).filter(Boolean));
    let mergedExtra = 0;
    for (const r of leftovers) {
      const match = byName.has(`${normalizeName(r.c.name)}|${normalizeCity(r.c.city) ?? ""}`) || (r.c.phone && byPhone.has(normalizePhone(r.c.phone))) || (r.c.website && byDomain.has(websiteDomain(normalizeWebsite(r.c.website))));
      if (!match) continue;
      await upsertCandidate(db, r.c, { industry: search.industry, searchId, isDemo: r.key === "demo" });
      mergedExtra++;
    }
    if (mergedExtra) note(`${mergedExtra} additional source record(s) beyond the cap merged into listed businesses`);
    note(`${leftovers.length - mergedExtra} candidate(s) beyond the cap not stored`);
  }
  // Best leads first; the queue is FIFO so enqueue order is investigation order.
  investigable.sort((a, b) => b.leadScore - a.leadScore);
  for (const t of investigable.slice(0, filters.autoInvestigateLimit ?? investigable.length)) {
    await enqueueInvestigation(t.id);
    stats.queuedForInvestigation!++;
  }
  stats.total = rank;
  stats.durationMs = Date.now() - startedAt;
  note(`Stored ${rank} result(s) (${stats.created} new, ${stats.merged} merged); ${stats.queuedForInvestigation} queued for investigation; ${(stats.durationMs / 1000).toFixed(1)} s total`);
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

  // 0. Locate a website when none is on record (search + verified domain guesses).
  if (!biz.website) {
    if (!cfg.RESEARCH_FIND_WEBSITE) {
      await setStatus("no_website", "No website on record (website finder disabled)");
      throw new NonRetryableError("Business has no website to investigate");
    }
    await setStatus("investigating", "Locating the website");
    progress({ message: "Locating the website" });
    const found = await findWebsite({ name: biz.name, city: biz.city, region: biz.region, phone: biz.phone, street: biz.street, email: biz.email }, { fetcher: (u, o) => safeFetch(u, { ...o, signal }) });
    if (!found) {
      await setStatus("no_website", "Website could not be located (search and domain guesses were checked)");
      await logActivity(businessId, "system", "Website finder: no verified website found.", {});
      throw new NonRetryableError("No website could be located for this business");
    }
    notes.push(...found.notes);
    const website = normalizeWebsite(found.website)!;
    const lead = leadScore({ ...biz, website });
    await db.update(businesses).set({ website, websiteDomain: websiteDomain(website), websiteSource: found.source, leadScore: lead.score, kind: lead.kind, updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
    await logActivity(businessId, "system", `Website located by ${found.source === "found_search" ? "web search" : found.source === "found_email" ? "its email domain" : "domain guess"} and verified: ${website} (${found.evidence}).`, { confidence: found.confidence });
    biz = (await db.select().from(businesses).where(eq(businesses.id, businessId)).get())!;
  }

  await setStatus("investigating", "Fetching website");
  const invId = newId();
  const started = Date.now();
  await db.insert(investigations).values({ id: invId, businessId, status: "running" }).run();

  try {
    // 1. Crawl and off-site footprint in parallel.
    const runFootprint = (site: string) => (cfg.RESEARCH_FOOTPRINT ? footprintFacts(site, { signal }).catch((err) => ({ facts: [] as DetectedFact[], notes: [`Footprint lookups failed: ${(err as Error).message}`] })) : Promise.resolve({ facts: [] as DetectedFact[], notes: [] as string[] }));
    let [crawl, footprint] = await Promise.all([crawlWebsite(biz.website!, { onProgress: (m) => progress({ message: m }), signal }), runFootprint(biz.website!)]);
    notes.push(...crawl.notes, ...footprint.notes);
    signal.throwIfAborted();
    const savePages = async (c: typeof crawl) => {
      for (const p of c.pages) await db.insert(pages).values({ id: newId(), investigationId: invId, businessId, url: p.url, finalUrl: p.finalUrl, kind: p.kind, statusCode: p.status, title: p.content?.title ?? null, text: p.content?.text ?? null, bytes: p.bytes, error: p.error, renderer: p.renderer }).run();
    };
    await savePages(crawl);
    if (!crawl.pages.some((p) => p.content) && cfg.RESEARCH_FIND_WEBSITE && !/robots\.txt|Blocked:/.test(crawl.pages[0]?.error ?? "")) {
      // The recorded website is dead (404, DNS, timeout): the business may have moved domains. Try to locate the current site.
      await setStatus("investigating", "Website unreachable; looking for a current one");
      progress({ message: "Website unreachable; looking for a current one" });
      const found = await findWebsite({ name: biz.name, city: biz.city, region: biz.region, phone: biz.phone, street: biz.street, email: biz.email }, { fetcher: (u, o) => safeFetch(u, { ...o, signal }) });
      notes.push(...(found?.notes ?? ["Website finder found no verified alternative"]));
      if (found && websiteDomain(found.website) !== biz.websiteDomain) {
        const website = normalizeWebsite(found.website)!;
        notes.push(`Recorded website ${biz.website} is unreachable; verified current site ${website} (${found.evidence})`);
        await db.update(businesses).set({ website, websiteDomain: websiteDomain(website), websiteSource: found.source, updatedAt: nowIso() }).where(eq(businesses.id, businessId)).run();
        await logActivity(businessId, "system", `Recorded website was unreachable; located and verified ${website} by ${found.source === "found_search" ? "web search" : found.source === "found_email" ? "its email domain" : "domain guess"} (${found.evidence}).`, { previous: biz.website, confidence: found.confidence });
        biz = (await db.select().from(businesses).where(eq(businesses.id, businessId)).get())!;
        [crawl, footprint] = await Promise.all([crawlWebsite(website, { onProgress: (m) => progress({ message: m }), signal }), runFootprint(website)]);
        notes.push(...crawl.notes, ...footprint.notes);
        signal.throwIfAborted();
        await savePages(crawl);
      }
    }
    const fetched = crawl.pages.filter((p) => p.content);
    const failed = crawl.pages.filter((p) => !p.content);
    if (!fetched.length) throw new NonRetryableError(`Website could not be fetched: ${failed[0]?.error ?? "unknown error"}`);
    if (crawl.home && normalizeWebsite(crawl.home.finalUrl) && websiteDomain(crawl.home.finalUrl) !== biz.websiteDomain) notes.push(`Website now resolves to ${crawl.home.finalUrl}`);

    // 2. Deterministic facts from the site, plus off-site records.
    await setStatus("investigating", cfg.ai.enabled ? "Building profile and analyzing opportunities" : "Detecting profile facts");
    const detected: DetectedFact[] = [...detectFacts(fetched.map((p) => ({ content: p.content!, url: p.url, kind: p.kind })), crawl.home ? { finalUrl: crawl.home.finalUrl, bytes: crawl.home.bytes, ms: crawl.home.ms } : undefined), ...footprint.facts, ...(await registryFacts(businessId))];

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
          // A verified email on the business's own domain beats whatever discovery or an older run recorded (vendor/widget addresses included).
          email: emailFact && (!biz.email || isVendorEmail(biz.email) || (biz.websiteDomain && emailFact.endsWith(`@${biz.websiteDomain}`))) ? emailFact : biz.email && isVendorEmail(biz.email) ? null : (biz.email ?? emailFact),
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
        .set({ status: "done", finishedAt: nowIso(), durationMs: Date.now() - started, pagesFetched: fetched.length, pagesFailed: failed.length, factsVerified: verifiedKeys.size, factsRejected: outcome?.rejected.length ?? 0, model, costUsd, workflows: outcome?.workflows ?? [], verdict, verdictReason, warnings, notes })
        .where(eq(investigations.id, invId)),
    ] as const;
    signal.throwIfAborted();
    await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
    await logActivity(businessId, "system", `Investigated in ${((Date.now() - started) / 1000).toFixed(1)}s: ${fetched.length} page(s), ${verifiedKeys.size} verified facts, ${footprint.facts.length} off-site record(s). ${verdict === "opportunity" ? `${scored.length} opportunity hypothesis(es) (${scored.filter((s) => s.o.source === "ai").length} AI, ${scored.filter((s) => s.o.source === "rules").length} rule-based).` : verdict === "no_opportunity" ? `No compelling opportunity: ${verdictReason}` : "No pattern matched; AI analysis not run."}`, { investigationId: invId });
    if (verdict === "opportunity") await advanceStageIfBehind(businessId, "qualified", "investigation found an opportunity");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(investigations).set({ status: "failed", finishedAt: nowIso(), durationMs: Date.now() - started, error: msg, notes }).where(eq(investigations.id, invId)).run();
    await setStatus("failed", msg.slice(0, 200));
    throw err;
  }
}

/** Facts from public registries the business was discovered in (e.g. Texas sales tax permit dates). */
async function registryFacts(businessId: string): Promise<DetectedFact[]> {
  const db = await getDb();
  const sources = await db.select().from(businessSources).where(eq(businessSources.businessId, businessId)).all();
  const permit = sources.find((s) => s.provider === "tx_permits" && (s.raw as { firstSalesDate?: string } | null)?.firstSalesDate);
  if (!permit) return [];
  const raw = permit.raw as { firstSalesDate: string; permitIssued?: string | null; taxpayerName?: string | null };
  return [{ key: "permit_since", status: "verified", value: raw.firstSalesDate.slice(0, 4), evidenceQuote: `Texas sales tax permit: first sales ${raw.firstSalesDate}${raw.taxpayerName ? `, taxpayer ${raw.taxpayerName}` : ""}`, sourceUrl: permit.sourceUrl ?? null }];
}

/** Below this many verified content facts the verdict is "insufficient evidence"; a single-page site needs a few more to count as seen. */
export const MIN_VERIFIED_FOR_VERDICT = 5;
export const MIN_VERIFIED_SINGLE_PAGE = 7;
/** Measured for nearly every reachable site; they say nothing about how the business operates, so they do not count toward the verdict threshold. */
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
