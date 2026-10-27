/** Read-side queries for pages. Kept in one place so pages stay thin. */
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activities, analyses, businesses, businessSources, jobs, observations, opportunities, outreachDrafts, pages, prospects, researchRuns, searchResults, searches, validationSignals } from "@/db/schema";
import { usageSummary } from "@/lib/ai/usage";
import { getConfig } from "@/lib/config";
import { PIPELINE_STAGE_KEYS } from "@/lib/pipeline/stages";
import { priorityScore } from "@/lib/scoring/score";

export type BusinessRow = typeof businesses.$inferSelect;

async function bestOppSubquery() {
  const db = await getDb();
  return await db
    .select({ businessId: opportunities.businessId, attractiveness: sql<number>`max(${opportunities.attractivenessScore})`.as("attractiveness"), confidence: sql<number>`max(${opportunities.confidenceScore})`.as("confidence"), count: sql<number>`count(*)`.as("count") })
    .from(opportunities)
    .groupBy(opportunities.businessId)
    .as("best");
}

async function draftSubquery() {
  const db = await getDb();
  return await db
    .select({ businessId: outreachDrafts.businessId, drafts: sql<number>`count(*)`.as("drafts"), approved: sql<number>`sum(case when ${outreachDrafts.status} = 'approved' then 1 else 0 end)`.as("approved") })
    .from(outreachDrafts)
    .groupBy(outreachDrafts.businessId)
    .as("drafts");
}

export async function funnelCounts() {
  const db = await getDb();
  const n = async (where: ReturnType<typeof sql>) => (await db.select({ n: sql<number>`count(*)` }).from(businesses).leftJoin(prospects, eq(prospects.businessId, businesses.id)).where(where).get())?.n ?? 0;
  const discovered = await n(sql`1=1`);
  const researched = await n(sql`${businesses.researchStatus} = 'done'`);
  const analyzed = await n(sql`${businesses.analysisStatus} in ('done','insufficient_evidence')`);
  const withOpps = (await db.select({ n: sql<number>`count(distinct ${opportunities.businessId})` }).from(opportunities).get())?.n ?? 0;
  const outreach = (await db.select({ n: sql<number>`count(distinct ${outreachDrafts.businessId})` }).from(outreachDrafts).get())?.n ?? 0;
  const contacted = await n(sql`${prospects.stage} in ('contacted','in_conversation','validated','won')`);
  const validated = await n(sql`${prospects.stage} in ('validated','won')`);
  return [
    { key: "discovered", label: "Discovered", n: discovered, href: "/businesses" },
    { key: "researched", label: "Researched", n: researched, href: "/businesses?research=done" },
    { key: "analyzed", label: "Analyzed", n: analyzed, href: "/businesses?analysis=done" },
    { key: "opportunities", label: "With opportunities", n: withOpps, href: "/businesses?minAttr=1" },
    { key: "outreach", label: "Draft ready", n: outreach, href: "/businesses?stage=outreach_ready" },
    { key: "contacted", label: "Contacted", n: contacted, href: "/pipeline" },
    { key: "validated", label: "Validated", n: validated, href: "/pipeline" },
  ];
}

export type AttentionItem = { kind: "failed" | "draft" | "due" | "ready_analyze" | "ready_draft" | "ready_research"; businessId: string; businessName: string; detail: string; href: string; when?: string | null };

/** The operator's inbox: what needs a human decision right now. */
export async function attentionItems(limit = 12): Promise<AttentionItem[]> {
  const db = await getDb();
  const items: AttentionItem[] = [];
  const failed = await db
    .select({ job: jobs, name: businesses.name, id: businesses.id })
    .from(jobs)
    .innerJoin(businesses, sql`json_extract(${jobs.payload}, '$.businessId') = ${businesses.id}`)
    .where(eq(jobs.status, "failed"))
    .orderBy(desc(jobs.finishedAt))
    .limit(5)
    .all();
  for (const f of failed) items.push({ kind: "failed", businessId: f.id, businessName: f.name, detail: `${f.job.type.replace(/_/g, " ")} failed: ${(f.job.error ?? "").slice(0, 90)}`, href: `/businesses/${f.id}`, when: f.job.finishedAt });
  const drafts = await db
    .select({ d: outreachDrafts, name: businesses.name })
    .from(outreachDrafts)
    .innerJoin(businesses, eq(outreachDrafts.businessId, businesses.id))
    .where(eq(outreachDrafts.status, "draft"))
    .orderBy(desc(outreachDrafts.createdAt))
    .limit(6)
    .all();
  for (const d of drafts) items.push({ kind: "draft", businessId: d.d.businessId, businessName: d.name, detail: `Outreach draft awaiting review${d.d.warnings.length ? ` · ${d.d.warnings.length} warning${d.d.warnings.length === 1 ? "" : "s"}` : ""}`, href: `/businesses/${d.d.businessId}?tab=outreach`, when: d.d.createdAt });
  const due = await db
    .select({ p: prospects, name: businesses.name })
    .from(prospects)
    .innerJoin(businesses, eq(prospects.businessId, businesses.id))
    .where(sql`${prospects.nextAction} is not null`)
    .orderBy(sql`coalesce(${prospects.nextActionAt}, '9999')`)
    .limit(6)
    .all();
  for (const d of due) items.push({ kind: "due", businessId: d.p.businessId, businessName: d.name, detail: d.p.nextAction!, href: `/businesses/${d.p.businessId}?tab=activity`, when: d.p.nextActionAt });
  if (!getConfig().ai.enabled) return items.slice(0, limit);
  const readyAnalyze = await db
    .select({ b: businesses })
    .from(businesses)
    .where(and(eq(businesses.researchStatus, "done"), eq(businesses.analysisStatus, "not_started"), eq(businesses.isDemo, false)))
    .limit(4)
    .all();
  for (const r of readyAnalyze) items.push({ kind: "ready_analyze", businessId: r.b.id, businessName: r.b.name, detail: "Research done — ready for opportunity analysis", href: `/businesses/${r.b.id}?tab=findings` });
  const readyDraft = await db
    .select({ b: businesses })
    .from(businesses)
    .innerJoin(prospects, eq(prospects.businessId, businesses.id))
    .leftJoin(outreachDrafts, eq(outreachDrafts.businessId, businesses.id))
    .where(and(eq(businesses.analysisStatus, "done"), eq(prospects.stage, "qualified"), sql`${outreachDrafts.id} is null`))
    .limit(4)
    .all();
  for (const r of readyDraft) items.push({ kind: "ready_draft", businessId: r.b.id, businessName: r.b.name, detail: "Opportunity found — ready for an outreach draft", href: `/businesses/${r.b.id}?tab=opportunities` });
  return items.slice(0, limit);
}

export async function dashboardStats() {
  const db = await getDb();
  const count = async (where?: ReturnType<typeof eq>) => (await db.select({ n: sql<number>`count(*)` }).from(businesses).where(where).get())?.n ?? 0;
  const total = await count();
  const researched = await count(eq(businesses.researchStatus, "done"));
  const withOpps = (await db.select({ n: sql<number>`count(distinct ${opportunities.businessId})` }).from(opportunities).get())?.n ?? 0;
  const insufficient = await count(eq(businesses.analysisStatus, "insufficient_evidence"));
  const demo = await count(eq(businesses.isDemo, true));
  const stages = await db.select({ stage: prospects.stage, n: sql<number>`count(*)` }).from(prospects).groupBy(prospects.stage).all();
  const queue = await db.select({ status: jobs.status, n: sql<number>`count(*)` }).from(jobs).groupBy(jobs.status).all();
  const recentSearches = await db.select().from(searches).orderBy(desc(searches.createdAt)).limit(5).all();
  const top = await db
    .select({ opp: opportunities, business: businesses })
    .from(opportunities)
    .innerJoin(businesses, eq(opportunities.businessId, businesses.id))
    .orderBy(desc(sql`${opportunities.attractivenessScore} * 0.6 + ${opportunities.confidenceScore} * 0.4`))
    .limit(8)
    .all();
  const nextActions = await db
    .select({ prospect: prospects, business: businesses })
    .from(prospects)
    .innerJoin(businesses, eq(prospects.businessId, businesses.id))
    .where(sql`${prospects.nextAction} is not null`)
    .orderBy(sql`coalesce(${prospects.nextActionAt}, '9999')`)
    .limit(8)
    .all();
  return { total, researched, withOpps, insufficient, demo, stages, queue, recentSearches, top, nextActions, ai: await usageSummary() };
}

export async function listSearches() {
  const db = await getDb();
  return await db.select().from(searches).orderBy(desc(searches.createdAt)).all();
}

export async function getSearchWithResults(id: string) {
  const db = await getDb();
  const search = await db.select().from(searches).where(eq(searches.id, id)).get();
  if (!search) return null;
  const best = await bestOppSubquery();
  const dr = await draftSubquery();
  const rows = await db
    .select({ business: businesses, rank: searchResults.rank, wasNew: searchResults.wasNew, stage: prospects.stage, attractiveness: best.attractiveness, confidence: best.confidence, oppCount: best.count, draftCount: dr.drafts })
    .from(searchResults)
    .innerJoin(businesses, eq(searchResults.businessId, businesses.id))
    .leftJoin(prospects, eq(prospects.businessId, businesses.id))
    .leftJoin(best, eq(best.businessId, businesses.id))
    .leftJoin(dr, eq(dr.businessId, businesses.id))
    .where(eq(searchResults.searchId, id))
    .orderBy(searchResults.rank)
    .all();
  const job = (await db.select().from(jobs).where(and(eq(jobs.type, "discover_search"), sql`json_extract(${jobs.payload}, '$.searchId') = ${id}`)).orderBy(desc(jobs.createdAt)).limit(1).get()) ?? null;
  return { search, rows, job };
}

export interface BusinessFilters {
  q?: string;
  industry?: string;
  stage?: string;
  research?: string;
  analysis?: string;
  minAttr?: number;
  minConf?: number;
  website?: "yes" | "no";
  demo?: "hide" | "only";
  sort?: "priority" | "attractiveness" | "confidence" | "name" | "updated";
  quick?: "needs_research" | "needs_analysis" | "has_opps" | "drafts" | "insufficient";
  limit?: number;
}

export async function listBusinesses(f: BusinessFilters = {}) {
  const db = await getDb();
  const best = await bestOppSubquery();
  const dr = await draftSubquery();
  const conds = [];
  if (f.q) conds.push(or(like(businesses.name, `%${f.q}%`), like(businesses.city, `%${f.q}%`), like(businesses.websiteDomain, `%${f.q}%`)));
  if (f.industry) conds.push(eq(businesses.industry, f.industry));
  if (f.stage) conds.push(eq(prospects.stage, f.stage));
  if (f.research) conds.push(eq(businesses.researchStatus, f.research));
  if (f.analysis) conds.push(eq(businesses.analysisStatus, f.analysis));
  if (f.website === "yes") conds.push(sql`${businesses.website} is not null`);
  if (f.website === "no") conds.push(sql`${businesses.website} is null`);
  if (f.demo === "hide") conds.push(eq(businesses.isDemo, false));
  if (f.demo === "only") conds.push(eq(businesses.isDemo, true));
  if (f.quick === "needs_research") conds.push(and(sql`${businesses.website} is not null`, inArray(businesses.researchStatus, ["not_started", "failed"]), eq(businesses.isDemo, false)));
  if (f.quick === "needs_analysis") conds.push(and(eq(businesses.researchStatus, "done"), inArray(businesses.analysisStatus, ["not_started", "failed"])));
  if (f.quick === "has_opps") conds.push(sql`coalesce(${best.count}, 0) > 0`);
  if (f.quick === "drafts") conds.push(sql`coalesce(${dr.drafts}, 0) > 0`);
  if (f.quick === "insufficient") conds.push(eq(businesses.analysisStatus, "insufficient_evidence"));
  if (f.minAttr) conds.push(sql`coalesce(${best.attractiveness}, 0) >= ${f.minAttr}`);
  if (f.minConf) conds.push(sql`coalesce(${best.confidence}, 0) >= ${f.minConf}`);
  const order = {
    priority: desc(sql`coalesce(${best.attractiveness},0) * 0.6 + coalesce(${best.confidence},0) * 0.4`),
    attractiveness: desc(sql`coalesce(${best.attractiveness},0)`),
    confidence: desc(sql`coalesce(${best.confidence},0)`),
    name: businesses.name,
    updated: desc(businesses.updatedAt),
  }[f.sort ?? "priority"];
  return await db
    .select({ business: businesses, stage: prospects.stage, nextAction: prospects.nextAction, nextActionAt: prospects.nextActionAt, attractiveness: best.attractiveness, confidence: best.confidence, oppCount: best.count, draftCount: dr.drafts })
    .from(businesses)
    .leftJoin(prospects, eq(prospects.businessId, businesses.id))
    .leftJoin(best, eq(best.businessId, businesses.id))
    .leftJoin(dr, eq(dr.businessId, businesses.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(order, businesses.name)
    .limit(f.limit ?? 500)
    .all();
}

export async function getBusinessDetail(id: string) {
  const db = await getDb();
  const business = await db.select().from(businesses).where(eq(businesses.id, id)).get();
  if (!business) return null;
  const sources = await db.select().from(businessSources).where(eq(businessSources.businessId, id)).all();
  const prospect = (await db.select().from(prospects).where(eq(prospects.businessId, id)).get()) ?? null;
  const runs = await db.select().from(researchRuns).where(eq(researchRuns.businessId, id)).orderBy(desc(researchRuns.startedAt)).limit(5).all();
  const latestRun = runs[0] ?? null;
  const pageRows = latestRun ? await db.select({ id: pages.id, url: pages.url, finalUrl: pages.finalUrl, kind: pages.kind, statusCode: pages.statusCode, title: pages.title, bytes: pages.bytes, error: pages.error, fetchedAt: pages.fetchedAt, textLength: sql<number>`length(coalesce(${pages.text}, ''))` }).from(pages).where(eq(pages.researchRunId, latestRun.id)).all() : [];
  const obs = await db.select().from(observations).where(eq(observations.businessId, id)).orderBy(observations.kind, observations.category).all();
  const analysis = (await db.select().from(analyses).where(eq(analyses.businessId, id)).orderBy(desc(analyses.createdAt)).limit(1).get()) ?? null;
  const opps = analysis ? await db.select().from(opportunities).where(eq(opportunities.analysisId, analysis.id)).orderBy(opportunities.rank).all() : [];
  const drafts = await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, id)).orderBy(desc(outreachDrafts.createdAt)).all();
  const acts = await db.select().from(activities).where(eq(activities.businessId, id)).orderBy(desc(activities.createdAt)).limit(100).all();
  const signals = await db.select().from(validationSignals).where(eq(validationSignals.businessId, id)).orderBy(desc(validationSignals.createdAt)).all();
  const activeJobs = await db
    .select()
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"]), sql`json_extract(${jobs.payload}, '$.businessId') = ${id}`))
    .all();
  const failedJobs = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "failed"), sql`json_extract(${jobs.payload}, '$.businessId') = ${id}`))
    .orderBy(desc(jobs.finishedAt))
    .limit(3)
    .all();
  return { business, sources, prospect, runs, latestRun, pages: pageRows, observations: obs, analysis, opportunities: opps, drafts, activities: acts, signals, activeJobs, failedJobs };
}

export async function pipelineBoard() {
  const db = await getDb();
  const best = await bestOppSubquery();
  const dr = await draftSubquery();
  const rows = await db
    .select({ business: businesses, prospect: prospects, attractiveness: best.attractiveness, confidence: best.confidence, draftCount: dr.drafts })
    .from(prospects)
    .innerJoin(businesses, eq(prospects.businessId, businesses.id))
    .leftJoin(best, eq(best.businessId, businesses.id))
    .leftJoin(dr, eq(dr.businessId, businesses.id))
    .orderBy(desc(sql`coalesce(${best.attractiveness},0) * 0.6 + coalesce(${best.confidence},0) * 0.4`))
    .all();
  const byStage = Object.fromEntries(PIPELINE_STAGE_KEYS.map((k) => [k, [] as typeof rows]));
  for (const r of rows) (byStage[r.prospect.stage] ?? (byStage[r.prospect.stage] = [])).push(r);
  return byStage;
}

export async function patternSummary() {
  const db = await getDb();
  const groups = await db
    .select({ category: opportunities.category, industry: businesses.industry, businesses: sql<number>`count(distinct ${opportunities.businessId})`, avgAttr: sql<number>`round(avg(${opportunities.attractivenessScore}))`, avgConf: sql<number>`round(avg(${opportunities.confidenceScore}))`, demoCount: sql<number>`sum(case when ${businesses.isDemo} then 1 else 0 end)` })
    .from(opportunities)
    .innerJoin(businesses, eq(opportunities.businessId, businesses.id))
    .groupBy(opportunities.category, businesses.industry)
    .orderBy(desc(sql`count(distinct ${opportunities.businessId})`))
    .all();
  const allOpps = await db.select({ opp: opportunities, business: businesses }).from(opportunities).innerJoin(businesses, eq(opportunities.businessId, businesses.id)).all();
  const allObs = await db.select({ id: observations.id, statement: observations.statement }).from(observations).all();
  const obsById = new Map(allObs.map((o) => [o.id, o.statement]));
  const signalRows = await db.select({ category: validationSignals.opportunityCategory, type: validationSignals.signalType, n: sql<number>`count(*)` }).from(validationSignals).groupBy(validationSignals.opportunityCategory, validationSignals.signalType).all();
  return groups.map((g) => {
    const members = allOpps.filter((o) => o.opp.category === g.category && o.business.industry === g.industry);
    const evidence = new Map<string, number>();
    const assumptions = new Map<string, number>();
    const efforts: Record<string, number> = {};
    for (const m of members) {
      for (const id of m.opp.supportingObservationIds) {
        const s = obsById.get(id);
        if (s) evidence.set(s, (evidence.get(s) ?? 0) + 1);
      }
      for (const a of m.opp.assumptions) assumptions.set(a, (assumptions.get(a) ?? 0) + 1);
      efforts[m.opp.implementationEffort] = (efforts[m.opp.implementationEffort] ?? 0) + 1;
    }
    const top = (m: Map<string, number>, n = 4) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return {
      ...g,
      titles: members.slice(0, 5).map((m) => ({ title: m.opp.title, businessId: m.business.id, businessName: m.business.name, priority: priorityScore(m.opp.attractivenessScore, m.opp.confidenceScore) })),
      sharedEvidence: top(evidence),
      commonAssumptions: top(assumptions),
      efforts,
      signals: signalRows.filter((s) => s.category === g.category),
    };
  });
}

export async function exportBusinessesCsv() {
  const rows = await listBusinesses({ limit: 10000 });
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["name", "industry", "website", "email", "phone", "city", "region", "country", "stage", "research_status", "analysis_status", "best_attractiveness", "best_confidence", "is_demo"];
  const lines = rows.map((r) => [r.business.name, r.business.industry, r.business.website, r.business.email, r.business.phone, r.business.city, r.business.region, r.business.country, r.stage, r.business.researchStatus, r.business.analysisStatus, r.attractiveness, r.confidence, r.business.isDemo ? "DEMO" : ""].map(esc).join(","));
  return [header.join(","), ...lines].join("\n");
}
