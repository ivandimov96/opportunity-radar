/** Read-side queries for pages. Kept in one place so pages stay thin. */
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activities, businesses, businessSources, facts, investigations, jobs, opportunities, outreachDrafts, pages, prospects, searchResults, searches, validationSignals } from "@/db/schema";
import { usageSummary } from "@/lib/ai/usage";
import { getConfig } from "@/lib/config";
import { PIPELINE_STAGE_KEYS } from "@/lib/pipeline/stages";
import { priorityScore } from "@/lib/scoring/score";

export type BusinessRow = typeof businesses.$inferSelect;

async function draftSubquery() {
  const db = await getDb();
  return db
    .select({ businessId: outreachDrafts.businessId, drafts: sql<number>`count(*)`.as("drafts") })
    .from(outreachDrafts)
    .groupBy(outreachDrafts.businessId)
    .as("drafts");
}
async function oppSubquery() {
  const db = await getDb();
  return db
    .select({ businessId: opportunities.businessId, count: sql<number>`count(*)`.as("count") })
    .from(opportunities)
    .groupBy(opportunities.businessId)
    .as("opps");
}

export async function funnelCounts() {
  const db = await getDb();
  const n = async (where: ReturnType<typeof sql>) => (await db.select({ n: sql<number>`count(*)` }).from(businesses).leftJoin(prospects, eq(prospects.businessId, businesses.id)).where(where).get())?.n ?? 0;
  const found = await n(sql`1=1`);
  const investigated = await n(sql`${businesses.status} = 'profiled'`);
  const withOpps = await n(sql`${businesses.verdict} = 'opportunity'`);
  const outreach = (await db.select({ n: sql<number>`count(distinct ${outreachDrafts.businessId})` }).from(outreachDrafts).get())?.n ?? 0;
  const contacted = await n(sql`${prospects.stage} in ('contacted','in_conversation','validated','won')`);
  const validated = await n(sql`${prospects.stage} in ('validated','won')`);
  return [
    { key: "found", label: "Found", n: found, href: "/businesses" },
    { key: "investigated", label: "Investigated", n: investigated, href: "/businesses?status=profiled" },
    { key: "opportunities", label: "With opportunity", n: withOpps, href: "/businesses?quick=has_opps" },
    { key: "outreach", label: "Draft ready", n: outreach, href: "/businesses?quick=drafts" },
    { key: "contacted", label: "Contacted", n: contacted, href: "/pipeline" },
    { key: "validated", label: "Validated", n: validated, href: "/pipeline" },
  ];
}

export type AttentionItem = { kind: "failed" | "draft" | "due" | "ready_draft" | "ready_investigate"; businessId: string; businessName: string; detail: string; href: string; when?: string | null };

/** The operator's inbox: what needs a human decision right now. */
export async function attentionItems(limit = 12): Promise<AttentionItem[]> {
  const db = await getDb();
  const items: AttentionItem[] = [];
  const failed = await db.select().from(businesses).where(eq(businesses.status, "failed")).orderBy(desc(businesses.updatedAt)).limit(5).all();
  for (const b of failed) items.push({ kind: "failed", businessId: b.id, businessName: b.name, detail: `Investigation failed: ${(b.statusMessage ?? "").slice(0, 90)}`, href: `/businesses/${b.id}`, when: b.updatedAt });
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
  if (getConfig().ai.enabled) {
    const readyDraft = await db
      .select({ b: businesses })
      .from(businesses)
      .innerJoin(prospects, eq(prospects.businessId, businesses.id))
      .leftJoin(outreachDrafts, eq(outreachDrafts.businessId, businesses.id))
      .where(and(eq(businesses.verdict, "opportunity"), eq(prospects.stage, "qualified"), sql`${outreachDrafts.id} is null`))
      .orderBy(desc(businesses.priority))
      .limit(5)
      .all();
    for (const r of readyDraft) items.push({ kind: "ready_draft", businessId: r.b.id, businessName: r.b.name, detail: `Opportunity found (priority ${r.b.priority ?? "—"}) — ready for an outreach draft`, href: `/businesses/${r.b.id}?tab=opportunities` });
  }
  const readyInvestigate = await db.select().from(businesses).where(and(eq(businesses.status, "new"), eq(businesses.isDemo, false), sql`${businesses.website} is not null`)).limit(3).all();
  for (const b of readyInvestigate) items.push({ kind: "ready_investigate", businessId: b.id, businessName: b.name, detail: "Found but not investigated yet", href: `/businesses/${b.id}` });
  return items.slice(0, limit);
}

export async function dashboardStats() {
  const db = await getDb();
  const total = (await db.select({ n: sql<number>`count(*)` }).from(businesses).get())?.n ?? 0;
  const queue = await db.select({ status: jobs.status, n: sql<number>`count(*)` }).from(jobs).groupBy(jobs.status).all();
  const recentSearches = await db.select().from(searches).orderBy(desc(searches.createdAt)).limit(5).all();
  const top = await db
    .select({ opp: opportunities, business: businesses })
    .from(opportunities)
    .innerJoin(businesses, eq(opportunities.businessId, businesses.id))
    .where(eq(opportunities.rank, 1))
    .orderBy(desc(sql`${opportunities.attractivenessScore} * 0.6 + ${opportunities.confidenceScore} * 0.4`))
    .limit(8)
    .all();
  return { total, queue, recentSearches, top, ai: await usageSummary() };
}

export async function listSearches() {
  const db = await getDb();
  return db.select().from(searches).orderBy(desc(searches.createdAt)).all();
}

export async function getSearchWithResults(id: string) {
  const db = await getDb();
  const search = await db.select().from(searches).where(eq(searches.id, id)).get();
  if (!search) return null;
  const dr = await draftSubquery();
  const op = await oppSubquery();
  const rows = await db
    .select({ business: businesses, rank: searchResults.rank, wasNew: searchResults.wasNew, stage: prospects.stage, oppCount: op.count, draftCount: dr.drafts })
    .from(searchResults)
    .innerJoin(businesses, eq(searchResults.businessId, businesses.id))
    .leftJoin(prospects, eq(prospects.businessId, businesses.id))
    .leftJoin(op, eq(op.businessId, businesses.id))
    .leftJoin(dr, eq(dr.businessId, businesses.id))
    .where(eq(searchResults.searchId, id))
    .orderBy(desc(sql`coalesce(${businesses.priority}, -1)`), searchResults.rank)
    .all();
  const job = (await db.select().from(jobs).where(and(eq(jobs.type, "discover_search"), sql`json_extract(${jobs.payload}, '$.searchId') = ${id}`)).orderBy(desc(jobs.createdAt)).limit(1).get()) ?? null;
  return { search, rows, job };
}

export interface BusinessFilters {
  q?: string;
  industry?: string;
  stage?: string;
  status?: string;
  verdict?: string;
  minPriority?: number;
  website?: "yes" | "no";
  demo?: "hide" | "only";
  sort?: "priority" | "name" | "updated";
  quick?: "needs_investigation" | "has_opps" | "drafts" | "no_opportunity" | "failed";
  limit?: number;
}

export async function listBusinesses(f: BusinessFilters = {}) {
  const db = await getDb();
  const dr = await draftSubquery();
  const op = await oppSubquery();
  const conds = [];
  if (f.q) conds.push(or(like(businesses.name, `%${f.q}%`), like(businesses.city, `%${f.q}%`), like(businesses.websiteDomain, `%${f.q}%`)));
  if (f.industry) conds.push(eq(businesses.industry, f.industry));
  if (f.stage) conds.push(eq(prospects.stage, f.stage));
  if (f.status) conds.push(eq(businesses.status, f.status));
  if (f.verdict) conds.push(eq(businesses.verdict, f.verdict));
  if (f.website === "yes") conds.push(sql`${businesses.website} is not null`);
  if (f.website === "no") conds.push(sql`${businesses.website} is null`);
  if (f.demo === "hide") conds.push(eq(businesses.isDemo, false));
  if (f.demo === "only") conds.push(eq(businesses.isDemo, true));
  if (f.minPriority) conds.push(sql`coalesce(${businesses.priority}, 0) >= ${f.minPriority}`);
  if (f.quick === "needs_investigation") conds.push(and(sql`${businesses.website} is not null`, inArray(businesses.status, ["new", "failed"]), eq(businesses.isDemo, false)));
  if (f.quick === "has_opps") conds.push(eq(businesses.verdict, "opportunity"));
  if (f.quick === "drafts") conds.push(sql`coalesce(${dr.drafts}, 0) > 0`);
  if (f.quick === "no_opportunity") conds.push(eq(businesses.verdict, "no_opportunity"));
  if (f.quick === "failed") conds.push(eq(businesses.status, "failed"));
  const order = { priority: desc(sql`coalesce(${businesses.priority}, -1)`), name: businesses.name, updated: desc(businesses.updatedAt) }[f.sort ?? "priority"];
  return db
    .select({ business: businesses, stage: prospects.stage, nextAction: prospects.nextAction, nextActionAt: prospects.nextActionAt, oppCount: op.count, draftCount: dr.drafts })
    .from(businesses)
    .leftJoin(prospects, eq(prospects.businessId, businesses.id))
    .leftJoin(op, eq(op.businessId, businesses.id))
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
  const runs = await db.select().from(investigations).where(eq(investigations.businessId, id)).orderBy(desc(investigations.startedAt)).limit(5).all();
  const latest = runs[0] ?? null;
  const pageRows = latest ? await db.select({ id: pages.id, url: pages.url, finalUrl: pages.finalUrl, kind: pages.kind, statusCode: pages.statusCode, title: pages.title, bytes: pages.bytes, error: pages.error, fetchedAt: pages.fetchedAt, textLength: sql<number>`length(coalesce(${pages.text}, ''))` }).from(pages).where(eq(pages.investigationId, latest.id)).all() : [];
  const factRows = await db.select().from(facts).where(eq(facts.businessId, id)).all();
  const opps = await db.select().from(opportunities).where(eq(opportunities.businessId, id)).orderBy(opportunities.rank).all();
  const drafts = await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, id)).orderBy(desc(outreachDrafts.createdAt)).all();
  const acts = await db.select().from(activities).where(eq(activities.businessId, id)).orderBy(desc(activities.createdAt)).limit(100).all();
  const signals = await db.select().from(validationSignals).where(eq(validationSignals.businessId, id)).orderBy(desc(validationSignals.createdAt)).all();
  const activeJobs = await db
    .select()
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"]), sql`json_extract(${jobs.payload}, '$.businessId') = ${id}`))
    .all();
  return { business, sources, prospect, runs, latest, pages: pageRows, facts: factRows, opportunities: opps, drafts, activities: acts, signals, activeJobs };
}

export async function pipelineBoard() {
  const db = await getDb();
  const dr = await draftSubquery();
  const rows = await db
    .select({ business: businesses, prospect: prospects, draftCount: dr.drafts })
    .from(prospects)
    .innerJoin(businesses, eq(prospects.businessId, businesses.id))
    .leftJoin(dr, eq(dr.businessId, businesses.id))
    .orderBy(desc(sql`coalesce(${businesses.priority}, -1)`))
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
  const allFacts = await db.select({ businessId: facts.businessId, key: facts.key, status: facts.status, value: facts.value }).from(facts).all();
  const factIndex = new Map(allFacts.map((f) => [`${f.businessId}:${f.key}`, f]));
  const signalRows = await db.select({ category: validationSignals.opportunityCategory, type: validationSignals.signalType, n: sql<number>`count(*)` }).from(validationSignals).groupBy(validationSignals.opportunityCategory, validationSignals.signalType).all();
  return groups.map((g) => {
    const members = allOpps.filter((o) => o.opp.category === g.category && o.business.industry === g.industry);
    const evidence = new Map<string, number>();
    const assumptions = new Map<string, number>();
    const efforts: Record<string, number> = {};
    for (const m of members) {
      for (const key of m.opp.supportingFactKeys) {
        const f = factIndex.get(`${m.business.id}:${key}`);
        if (!f) continue;
        const label = f.status === "verified" ? `${key}: ${f.value ?? "yes"}` : `${key}: not found on site`;
        evidence.set(label, (evidence.get(label) ?? 0) + 1);
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
  const header = ["name", "industry", "website", "email", "phone", "city", "region", "country", "status", "verdict", "priority", "best_attractiveness", "best_confidence", "stage", "summary", "is_demo"];
  const lines = rows.map((r) => [r.business.name, r.business.industry, r.business.website, r.business.email, r.business.phone, r.business.city, r.business.region, r.business.country, r.business.status, r.business.verdict, r.business.priority, r.business.bestAttractiveness, r.business.bestConfidence, r.stage, r.business.summary, r.business.isDemo ? "DEMO" : ""].map(esc).join(","));
  return [header.join(","), ...lines].join("\n");
}
