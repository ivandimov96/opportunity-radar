/** Read-side queries for pages. Kept in one place so pages stay thin. */
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activities, analyses, businesses, businessSources, jobs, observations, opportunities, outreachDrafts, pages, prospects, researchRuns, searchResults, searches, validationSignals } from "@/db/schema";
import { usageSummary } from "@/lib/ai/usage";
import { PIPELINE_STAGE_KEYS } from "@/lib/pipeline/stages";
import { priorityScore } from "@/lib/scoring/score";

export type BusinessRow = typeof businesses.$inferSelect;

function bestOppSubquery() {
  const db = getDb();
  return db
    .select({ businessId: opportunities.businessId, attractiveness: sql<number>`max(${opportunities.attractivenessScore})`.as("attractiveness"), confidence: sql<number>`max(${opportunities.confidenceScore})`.as("confidence"), count: sql<number>`count(*)`.as("count") })
    .from(opportunities)
    .groupBy(opportunities.businessId)
    .as("best");
}

export function dashboardStats() {
  const db = getDb();
  const count = (where?: ReturnType<typeof eq>) => db.select({ n: sql<number>`count(*)` }).from(businesses).where(where).get()?.n ?? 0;
  const total = count();
  const researched = count(eq(businesses.researchStatus, "done"));
  const withOpps = db.select({ n: sql<number>`count(distinct ${opportunities.businessId})` }).from(opportunities).get()?.n ?? 0;
  const insufficient = count(eq(businesses.analysisStatus, "insufficient_evidence"));
  const demo = count(eq(businesses.isDemo, true));
  const stages = db.select({ stage: prospects.stage, n: sql<number>`count(*)` }).from(prospects).groupBy(prospects.stage).all();
  const queue = db.select({ status: jobs.status, n: sql<number>`count(*)` }).from(jobs).groupBy(jobs.status).all();
  const recentSearches = db.select().from(searches).orderBy(desc(searches.createdAt)).limit(5).all();
  const top = db
    .select({ opp: opportunities, business: businesses })
    .from(opportunities)
    .innerJoin(businesses, eq(opportunities.businessId, businesses.id))
    .orderBy(desc(sql`${opportunities.attractivenessScore} * 0.6 + ${opportunities.confidenceScore} * 0.4`))
    .limit(8)
    .all();
  const nextActions = db
    .select({ prospect: prospects, business: businesses })
    .from(prospects)
    .innerJoin(businesses, eq(prospects.businessId, businesses.id))
    .where(sql`${prospects.nextAction} is not null`)
    .orderBy(sql`coalesce(${prospects.nextActionAt}, '9999')`)
    .limit(8)
    .all();
  return { total, researched, withOpps, insufficient, demo, stages, queue, recentSearches, top, nextActions, ai: usageSummary() };
}

export function listSearches() {
  const db = getDb();
  return db.select().from(searches).orderBy(desc(searches.createdAt)).all();
}

export function getSearchWithResults(id: string) {
  const db = getDb();
  const search = db.select().from(searches).where(eq(searches.id, id)).get();
  if (!search) return null;
  const best = bestOppSubquery();
  const rows = db
    .select({ business: businesses, rank: searchResults.rank, wasNew: searchResults.wasNew, stage: prospects.stage, attractiveness: best.attractiveness, confidence: best.confidence, oppCount: best.count })
    .from(searchResults)
    .innerJoin(businesses, eq(searchResults.businessId, businesses.id))
    .leftJoin(prospects, eq(prospects.businessId, businesses.id))
    .leftJoin(best, eq(best.businessId, businesses.id))
    .where(eq(searchResults.searchId, id))
    .orderBy(searchResults.rank)
    .all();
  const job = db.select().from(jobs).where(and(eq(jobs.type, "discover_search"), sql`json_extract(${jobs.payload}, '$.searchId') = ${id}`)).orderBy(desc(jobs.createdAt)).limit(1).get() ?? null;
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
  limit?: number;
}

export function listBusinesses(f: BusinessFilters = {}) {
  const db = getDb();
  const best = bestOppSubquery();
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
  if (f.minAttr) conds.push(sql`coalesce(${best.attractiveness}, 0) >= ${f.minAttr}`);
  if (f.minConf) conds.push(sql`coalesce(${best.confidence}, 0) >= ${f.minConf}`);
  const order = {
    priority: desc(sql`coalesce(${best.attractiveness},0) * 0.6 + coalesce(${best.confidence},0) * 0.4`),
    attractiveness: desc(sql`coalesce(${best.attractiveness},0)`),
    confidence: desc(sql`coalesce(${best.confidence},0)`),
    name: businesses.name,
    updated: desc(businesses.updatedAt),
  }[f.sort ?? "priority"];
  return db
    .select({ business: businesses, stage: prospects.stage, nextAction: prospects.nextAction, attractiveness: best.attractiveness, confidence: best.confidence, oppCount: best.count })
    .from(businesses)
    .leftJoin(prospects, eq(prospects.businessId, businesses.id))
    .leftJoin(best, eq(best.businessId, businesses.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(order, businesses.name)
    .limit(f.limit ?? 500)
    .all();
}

export function getBusinessDetail(id: string) {
  const db = getDb();
  const business = db.select().from(businesses).where(eq(businesses.id, id)).get();
  if (!business) return null;
  const sources = db.select().from(businessSources).where(eq(businessSources.businessId, id)).all();
  const prospect = db.select().from(prospects).where(eq(prospects.businessId, id)).get() ?? null;
  const runs = db.select().from(researchRuns).where(eq(researchRuns.businessId, id)).orderBy(desc(researchRuns.startedAt)).limit(5).all();
  const latestRun = runs[0] ?? null;
  const pageRows = latestRun ? db.select({ id: pages.id, url: pages.url, finalUrl: pages.finalUrl, kind: pages.kind, statusCode: pages.statusCode, title: pages.title, bytes: pages.bytes, error: pages.error, fetchedAt: pages.fetchedAt, textLength: sql<number>`length(coalesce(${pages.text}, ''))` }).from(pages).where(eq(pages.researchRunId, latestRun.id)).all() : [];
  const obs = db.select().from(observations).where(eq(observations.businessId, id)).orderBy(observations.kind, observations.category).all();
  const analysis = db.select().from(analyses).where(eq(analyses.businessId, id)).orderBy(desc(analyses.createdAt)).limit(1).get() ?? null;
  const opps = analysis ? db.select().from(opportunities).where(eq(opportunities.analysisId, analysis.id)).orderBy(opportunities.rank).all() : [];
  const drafts = db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, id)).orderBy(desc(outreachDrafts.createdAt)).all();
  const acts = db.select().from(activities).where(eq(activities.businessId, id)).orderBy(desc(activities.createdAt)).limit(100).all();
  const signals = db.select().from(validationSignals).where(eq(validationSignals.businessId, id)).orderBy(desc(validationSignals.createdAt)).all();
  const activeJobs = db
    .select()
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"]), sql`json_extract(${jobs.payload}, '$.businessId') = ${id}`))
    .all();
  const failedJobs = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "failed"), sql`json_extract(${jobs.payload}, '$.businessId') = ${id}`))
    .orderBy(desc(jobs.finishedAt))
    .limit(3)
    .all();
  return { business, sources, prospect, runs, latestRun, pages: pageRows, observations: obs, analysis, opportunities: opps, drafts, activities: acts, signals, activeJobs, failedJobs };
}

export function pipelineBoard() {
  const db = getDb();
  const best = bestOppSubquery();
  const rows = db
    .select({ business: businesses, prospect: prospects, attractiveness: best.attractiveness, confidence: best.confidence })
    .from(prospects)
    .innerJoin(businesses, eq(prospects.businessId, businesses.id))
    .leftJoin(best, eq(best.businessId, businesses.id))
    .orderBy(desc(sql`coalesce(${best.attractiveness},0) * 0.6 + coalesce(${best.confidence},0) * 0.4`))
    .all();
  const byStage = Object.fromEntries(PIPELINE_STAGE_KEYS.map((k) => [k, [] as typeof rows]));
  for (const r of rows) (byStage[r.prospect.stage] ?? (byStage[r.prospect.stage] = [])).push(r);
  return byStage;
}

export function patternSummary() {
  const db = getDb();
  const groups = db
    .select({ category: opportunities.category, industry: businesses.industry, businesses: sql<number>`count(distinct ${opportunities.businessId})`, avgAttr: sql<number>`round(avg(${opportunities.attractivenessScore}))`, avgConf: sql<number>`round(avg(${opportunities.confidenceScore}))`, demoCount: sql<number>`sum(case when ${businesses.isDemo} then 1 else 0 end)` })
    .from(opportunities)
    .innerJoin(businesses, eq(opportunities.businessId, businesses.id))
    .groupBy(opportunities.category, businesses.industry)
    .orderBy(desc(sql`count(distinct ${opportunities.businessId})`))
    .all();
  const allOpps = db.select({ opp: opportunities, business: businesses }).from(opportunities).innerJoin(businesses, eq(opportunities.businessId, businesses.id)).all();
  const allObs = db.select({ id: observations.id, statement: observations.statement }).from(observations).all();
  const obsById = new Map(allObs.map((o) => [o.id, o.statement]));
  const signalRows = db.select({ category: validationSignals.opportunityCategory, type: validationSignals.signalType, n: sql<number>`count(*)` }).from(validationSignals).groupBy(validationSignals.opportunityCategory, validationSignals.signalType).all();
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

export function exportBusinessesCsv() {
  const rows = listBusinesses({ limit: 10000 });
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["name", "industry", "website", "email", "phone", "city", "region", "country", "stage", "research_status", "analysis_status", "best_attractiveness", "best_confidence", "is_demo"];
  const lines = rows.map((r) => [r.business.name, r.business.industry, r.business.website, r.business.email, r.business.phone, r.business.city, r.business.region, r.business.country, r.stage, r.business.researchStatus, r.business.analysisStatus, r.attractiveness, r.confidence, r.business.isDemo ? "DEMO" : ""].map(esc).join(","));
  return [header.join(","), ...lines].join("\n");
}
