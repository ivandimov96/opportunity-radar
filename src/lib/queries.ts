/** Read-side queries for pages. Kept in one place so pages stay thin. Searches and businesses (and what hangs off a business) are read for the acting workspace only. */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activities, businesses, businessSources, facts, inboundEmails, investigations, jobs, observations, opportunities, outreachDrafts, pages, prospects, searchCandidates, searchResults, searches } from "@/db/schema";
import { usageSummary } from "@/lib/ai/usage";
import { getConfig } from "@/lib/config";
import { MACHINE_STAGES, PIPELINE_STAGE_KEYS } from "@/lib/pipeline/stages";
import { priorityScore } from "@/lib/scoring/score";
import { getSettings, missingSenderDetails } from "@/lib/settings";
import { settingsHref } from "@/lib/settings-nav";
import { workspaceId } from "@/lib/workspace";

export type BusinessRow = typeof businesses.$inferSelect;

async function draftSubquery() {
  const db = await getDb();
  return db
    .select({ businessId: outreachDrafts.businessId, drafts: sql<number>`count(*)`.as("drafts") })
    .from(outreachDrafts)
    .where(ne(outreachDrafts.status, "archived"))
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

/** Ids of the businesses of a workspace: the tables that hang off a business (emails, replies, activity) are scoped through it. */
function businessIdsOf(db: Awaited<ReturnType<typeof getDb>>, ws: string) {
  // A subquery, never awaited on its own (awaiting it would run it and hand back rows).
  return db.select({ id: businesses.id }).from(businesses).where(eq(businesses.workspaceId, ws));
}

export type AttentionItem = { kind: "failed" | "draft" | "due" | "ready_draft" | "ready_investigate"; businessId: string; businessName: string; detail: string; href: string; when?: string | null };

export interface SearchListFilters {
  q?: string;
  from?: string | null;
  to?: string | null;
  sort?: "created" | "name" | "results" | "status";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}
export async function listSearches(f: SearchListFilters = {}) {
  const db = await getDb();
  const conds = [eq(searches.workspaceId, await workspaceId())];
  if (f.q) conds.push(or(like(searches.name, `%${f.q}%`), like(searches.city, `%${f.q}%`), like(searches.region, `%${f.q}%`), like(searches.industry, `%${f.q}%`))!);
  if (f.from) conds.push(sql`${searches.createdAt} >= ${f.from}`);
  if (f.to) conds.push(sql`${searches.createdAt} <= ${f.to}`);
  const dir = f.dir === "asc" ? asc : desc;
  const order = { created: searches.createdAt, name: sql`lower(${searches.name})`, results: sql`coalesce(json_extract(${searches.stats}, '$.total'), -1)`, status: searches.status }[f.sort ?? "created"];
  const where = and(...conds);
  const pageSize = f.pageSize ?? 500;
  const page = f.page ?? 1;
  const rows = await db.select().from(searches).where(where).orderBy(dir(order), desc(searches.createdAt)).limit(pageSize).offset((page - 1) * pageSize).all();
  const total = (await db.select({ n: sql<number>`count(*)` }).from(searches).where(where).get())?.n ?? rows.length;
  return { rows, total, page, pageSize };
}

export async function getSearchWithResults(id: string, f: { q?: string; sort?: "priority" | "lead" | "name" | "status" | "rank"; dir?: "asc" | "desc" } = {}) {
  const db = await getDb();
  const ws = await workspaceId();
  const search = await db.select().from(searches).where(and(eq(searches.id, id), eq(searches.workspaceId, ws))).get();
  if (!search) return null;
  const dr = await draftSubquery();
  const op = await oppSubquery();
  const conds = [eq(searchResults.searchId, id), eq(businesses.workspaceId, ws)];
  if (f.q) conds.push(or(like(businesses.name, `%${f.q}%`), like(businesses.city, `%${f.q}%`), like(businesses.websiteDomain, `%${f.q}%`), like(businesses.street, `%${f.q}%`))!);
  const dir = f.dir === "asc" ? asc : desc;
  const order = { priority: sql`coalesce(${businesses.priority}, -1)`, lead: sql`coalesce(${businesses.leadScore}, -1)`, name: sql`lower(${businesses.name})`, status: businesses.status, rank: searchResults.rank }[f.sort ?? "priority"];
  const rows = await db
    .select({ business: businesses, rank: searchResults.rank, wasNew: searchResults.wasNew, stage: prospects.stage, oppCount: op.count, draftCount: dr.drafts })
    .from(searchResults)
    .innerJoin(businesses, eq(searchResults.businessId, businesses.id))
    .leftJoin(prospects, eq(prospects.businessId, businesses.id))
    .leftJoin(op, eq(op.businessId, businesses.id))
    .leftJoin(dr, eq(dr.businessId, businesses.id))
    .where(and(...conds))
    .orderBy(dir(order), desc(sql`coalesce(${businesses.leadScore}, -1)`), searchResults.rank)
    .all();
  const job = (await db.select().from(jobs).where(and(eq(jobs.type, "discover_search"), sql`json_extract(${jobs.payload}, '$.searchId') = ${id}`)).orderBy(desc(jobs.createdAt)).limit(1).get()) ?? null;
  const ids = rows.map((r) => r.business.id);
  const topOpps = ids.length ? await db.select({ businessId: opportunities.businessId, title: opportunities.title, category: opportunities.category, source: opportunities.source }).from(opportunities).where(and(inArray(opportunities.businessId, ids), eq(opportunities.rank, 1))).all() : [];
  const invs = ids.length ? await db.select().from(investigations).where(inArray(investigations.businessId, ids)).orderBy(desc(investigations.startedAt)).all() : [];
  const srcs = ids.length ? await db.select({ businessId: businessSources.businessId, provider: businessSources.provider }).from(businessSources).where(inArray(businessSources.businessId, ids)).all() : [];
  const latestInv = new Map<string, (typeof invs)[number]>();
  for (const inv of invs) if (!latestInv.has(inv.businessId)) latestInv.set(inv.businessId, inv);
  const topByBiz = new Map(topOpps.map((o) => [o.businessId, o]));
  const sourcesByBiz = new Map<string, string[]>();
  for (const sr of srcs) sourcesByBiz.set(sr.businessId, [...new Set([...(sourcesByBiz.get(sr.businessId) ?? []), sr.provider])]);
  const full = rows.map((r) => ({ ...r, topOpp: topByBiz.get(r.business.id) ?? null, investigation: latestInv.get(r.business.id) ?? null, sources: sourcesByBiz.get(r.business.id) ?? [] }));
  return { search, rows: full, job };
}

/** CSV with everything collected for one search: discovery fields, lead score, status, verdict, scores, top opportunity, research stats. */
export async function exportSearchCsv(searchId: string) {
  const data = await getSearchWithResults(searchId);
  if (!data) return null;
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["rank", "name", "kind", "lead_score", "sources", "website", "website_source", "email", "phone", "street", "city", "region", "postal_code", "country", "category", "status", "status_message", "verdict", "priority", "best_attractiveness", "best_confidence", "top_opportunity", "top_opportunity_category", "top_opportunity_source", "opportunities", "drafts", "stage", "pages_fetched", "facts_verified", "investigation_seconds", "investigated_at", "summary"];
  const lines = data.rows.map((r) => {
    const b = r.business;
    return [r.rank, b.name, b.kind, b.leadScore, r.sources.join("|"), b.website, b.websiteSource, b.email, b.phone, b.street, b.city, b.region, b.postalCode, b.country, b.category, b.status, b.statusMessage, b.verdict, b.priority, b.bestAttractiveness, b.bestConfidence, r.topOpp?.title, r.topOpp?.category, r.topOpp?.source, r.oppCount ?? 0, r.draftCount ?? 0, r.stage ?? "lead", r.investigation?.pagesFetched, r.investigation?.factsVerified, r.investigation?.durationMs != null ? (r.investigation.durationMs / 1000).toFixed(1) : "", b.investigatedAt, b.summary].map(esc).join(",");
  });
  return { name: data.search.name, csv: [header.join(","), ...lines].join("\n") };
}

export interface BusinessFilters {
  q?: string;
  industry?: string;
  stage?: string;
  status?: string;
  verdict?: string;
  minPriority?: number;
  website?: "yes" | "no";
  sort?: "priority" | "lead" | "name" | "updated" | "discovered" | "investigated";
  dir?: "asc" | "desc";
  quick?: "needs_investigation" | "qualified" | "needs_review" | "drafts" | "not_a_fit" | "no_contact" | "stale" | "failed" | "chains";
  dateField?: "createdAt" | "investigatedAt" | "updatedAt";
  from?: string | null; // ISO lower bound
  to?: string | null; // ISO upper bound
  page?: number;
  pageSize?: number;
  limit?: number;
}

export const BUSINESS_SORTS = ["priority", "lead", "name", "updated", "discovered", "investigated"] as const;
export const BUSINESS_DATE_FIELDS = [
  { key: "createdAt", label: "Found" },
  { key: "investigatedAt", label: "Researched" },
  { key: "updatedAt", label: "Updated" },
] as const;

/** The "quick" views of the businesses list, in the order the page shows them. */
export const BUSINESS_QUICK_VIEWS = ["", "needs_investigation", "qualified", "needs_review", "drafts", "not_a_fit", "no_contact", "stale", "failed", "chains"] as const;

type DraftSub = Awaited<ReturnType<typeof draftSubquery>>;

function quickCondition(quick: BusinessFilters["quick"], dr: DraftSub): SQL | undefined {
  const staleBefore = new Date(Date.now() - getConfig().RESEARCH_STALE_DAYS * 86_400_000).toISOString();
  switch (quick) {
    case "needs_investigation":
      return and(inArray(businesses.status, ["new", "failed"]), sql`${businesses.kind} != 'chain'`);
    case "chains":
      return eq(businesses.kind, "chain");
    case "qualified":
      return eq(businesses.verdict, "qualified");
    case "needs_review":
      return inArray(businesses.verdict, ["needs_review", "insufficient_evidence"]);
    case "drafts":
      return sql`coalesce(${dr.drafts}, 0) > 0`;
    case "not_a_fit":
      return eq(businesses.verdict, "not_a_fit");
    case "no_contact":
      return eq(businesses.verdict, "no_contact");
    case "failed":
      return eq(businesses.status, "failed");
    case "stale":
      return and(eq(businesses.status, "profiled"), sql`${businesses.investigatedAt} < ${staleBefore}`);
    default:
      return undefined;
  }
}

/** WHERE clause for the businesses list: text search, the labeled filters, the date range and the quick view. */
function businessWhere(f: BusinessFilters, dr: DraftSub, ws: string): SQL | undefined {
  const conds: SQL[] = [eq(businesses.workspaceId, ws)];
  if (f.q) conds.push(or(like(businesses.name, `%${f.q}%`), like(businesses.city, `%${f.q}%`), like(businesses.websiteDomain, `%${f.q}%`), like(businesses.email, `%${f.q}%`), like(businesses.phone, `%${f.q}%`))!);
  if (f.industry) conds.push(eq(businesses.industry, f.industry));
  if (f.stage) conds.push(eq(prospects.stage, f.stage));
  if (f.status) conds.push(eq(businesses.status, f.status));
  if (f.verdict) conds.push(eq(businesses.verdict, f.verdict));
  if (f.website === "yes") conds.push(sql`${businesses.website} is not null`);
  if (f.website === "no") conds.push(sql`${businesses.website} is null`);
  if (f.minPriority) conds.push(sql`coalesce(${businesses.priority}, 0) >= ${f.minPriority}`);
  const dateCol = { createdAt: businesses.createdAt, investigatedAt: businesses.investigatedAt, updatedAt: businesses.updatedAt }[f.dateField ?? "createdAt"];
  if (f.from) conds.push(sql`${dateCol} >= ${f.from}`);
  if (f.to) conds.push(sql`${dateCol} <= ${f.to}`);
  const quick = quickCondition(f.quick, dr);
  if (quick) conds.push(quick);
  return conds.length ? and(...conds) : undefined;
}

/** How many businesses each quick view holds under the current search and filters (the chips' counts). */
export async function quickViewCounts(f: BusinessFilters = {}) {
  const db = await getDb();
  const dr = await draftSubquery();
  // One pass: the shared filters in WHERE, one conditional sum per view.
  const where = businessWhere({ ...f, quick: undefined }, dr, await workspaceId());
  const cols = Object.fromEntries(BUSINESS_QUICK_VIEWS.map((key) => {
    const cond = quickCondition((key || undefined) as BusinessFilters["quick"], dr);
    return [key || "all", cond ? sql<number>`sum(case when ${cond} then 1 else 0 end)` : sql<number>`count(*)`];
  }));
  const row = await db.select(cols).from(businesses).leftJoin(prospects, eq(prospects.businessId, businesses.id)).leftJoin(dr, eq(dr.businessId, businesses.id)).where(where).get();
  return Object.fromEntries(BUSINESS_QUICK_VIEWS.map((key) => [key, Number(row?.[key || "all"] ?? 0)])) as Record<string, number>;
}

export async function listBusinesses(f: BusinessFilters = {}) {
  const db = await getDb();
  const dr = await draftSubquery();
  const op = await oppSubquery();
  const where = businessWhere(f, dr, await workspaceId());
  const dir = f.dir === "asc" ? asc : desc;
  const orderExpr = {
    priority: sql`coalesce(${businesses.priority}, -1)`,
    lead: sql`coalesce(${businesses.leadScore}, -1)`,
    name: sql`lower(${businesses.name})`,
    updated: businesses.updatedAt,
    // To the minute: the businesses of one search are saved together, so they stay together and the best come first within it.
    discovered: sql`substr(${businesses.createdAt}, 1, 16)`,
    investigated: sql`coalesce(${businesses.investigatedAt}, '')`,
  }[f.sort ?? "priority"];
  const secondary =
    f.sort === "discovered"
      ? desc(sql`coalesce(${businesses.priority}, -1) * 1000 + coalesce(${businesses.leadScore}, -1)`)
      : f.sort === "priority" || !f.sort
        ? desc(sql`coalesce(${businesses.leadScore}, -1)`)
        : asc(businesses.name);
  const base = db
    .select({ business: businesses, stage: prospects.stage, nextAction: prospects.nextAction, nextActionAt: prospects.nextActionAt, oppCount: op.count, draftCount: dr.drafts })
    .from(businesses)
    .leftJoin(prospects, eq(prospects.businessId, businesses.id))
    .leftJoin(op, eq(op.businessId, businesses.id))
    .leftJoin(dr, eq(dr.businessId, businesses.id))
    .where(where)
    .orderBy(dir(orderExpr), secondary, businesses.name);
  const pageSize = f.pageSize ?? f.limit ?? 500;
  const page = f.page ?? 1;
  const rows = await base.limit(pageSize).offset((page - 1) * pageSize).all();
  const totalRow = await db.select({ n: sql<number>`count(*)` }).from(businesses).leftJoin(prospects, eq(prospects.businessId, businesses.id)).leftJoin(dr, eq(dr.businessId, businesses.id)).where(where).get();
  return { rows, total: totalRow?.n ?? rows.length, page, pageSize };
}

export async function getBusinessDetail(id: string) {
  const db = await getDb();
  const ws = await workspaceId();
  const business = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.workspaceId, ws))).get();
  if (!business) return null;
  const sources = await db.select().from(businessSources).where(eq(businessSources.businessId, id)).all();
  const prospect = (await db.select().from(prospects).where(eq(prospects.businessId, id)).get()) ?? null;
  const runs = await db.select().from(investigations).where(eq(investigations.businessId, id)).orderBy(desc(investigations.startedAt)).limit(5).all();
  const latest = runs[0] ?? null;
  const pageRows = latest ? await db.select({ id: pages.id, url: pages.url, finalUrl: pages.finalUrl, kind: pages.kind, statusCode: pages.statusCode, title: pages.title, bytes: pages.bytes, error: pages.error, fetchedAt: pages.fetchedAt, renderer: pages.renderer, credits: pages.credits, hasHtml: sql<number>`case when ${pages.html} is null then 0 else 1 end`, textLength: sql<number>`length(coalesce(${pages.text}, ''))` }).from(pages).where(eq(pages.investigationId, latest.id)).all() : [];
  const foundBy = await db
    .select({ searchId: searches.id, name: searches.name, rank: searchResults.rank, wasNew: searchResults.wasNew, createdAt: searches.createdAt, providers: searches.providers })
    .from(searchResults)
    .innerJoin(searches, eq(searchResults.searchId, searches.id))
    .where(and(eq(searchResults.businessId, id), eq(searches.workspaceId, ws)))
    .orderBy(desc(searches.createdAt))
    .all();
  const factRows = await db.select().from(facts).where(eq(facts.businessId, id)).all();
  const opps = await db.select().from(opportunities).where(eq(opportunities.businessId, id)).orderBy(opportunities.rank).all();
  const drafts = await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, id)).orderBy(desc(outreachDrafts.createdAt)).all();
  const activityCount = (await db.select({ n: sql<number>`count(*)` }).from(activities).where(eq(activities.businessId, id)).get())?.n ?? 0;
  const observationRows = await db.select().from(observations).where(eq(observations.businessId, id)).orderBy(observations.ref).all();
  const inbound = await db.select().from(inboundEmails).where(eq(inboundEmails.businessId, id)).orderBy(desc(inboundEmails.receivedAt)).all();
  const activeJobs = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.workspaceId, ws), inArray(jobs.status, ["queued", "running"]), sql`json_extract(${jobs.payload}, '$.businessId') = ${id}`))
    .all();
  return { business, sources, prospect, runs, latest, pages: pageRows, facts: factRows, opportunities: opps, observations: observationRows, drafts, inbound, activityCount, activeJobs, foundBy };
}

/**
 * The board for a period: the businesses in the stages a person works with
 * that last moved (stage, next action, order) between two moments. Either
 * moment may be open; with both open it is the whole board.
 */
export async function pipelineBoard(f: { q?: string; industry?: string; fromIso?: string | null; toIso?: string | null } = {}) {
  const db = await getDb();
  const dr = await draftSubquery();
  // The board shows the stages a person works with. "Discovered" and "Researching" can hold hundreds of
  // businesses the system is still handling, so they are counted, not listed.
  const conds = [notInArray(prospects.stage, MACHINE_STAGES), eq(businesses.workspaceId, await workspaceId())];
  if (f.q) conds.push(or(like(businesses.name, `%${f.q}%`), like(businesses.city, `%${f.q}%`), like(businesses.websiteDomain, `%${f.q}%`))!);
  if (f.industry) conds.push(eq(businesses.industry, f.industry));
  if (f.fromIso) conds.push(gte(prospects.updatedAt, f.fromIso));
  if (f.toIso) conds.push(lte(prospects.updatedAt, f.toIso));
  const rows = await db
    .select({ business: businesses, prospect: prospects, draftCount: dr.drafts })
    .from(prospects)
    .innerJoin(businesses, eq(prospects.businessId, businesses.id))
    .leftJoin(dr, eq(dr.businessId, businesses.id))
    .where(and(...conds))
    // Manual board order first (cards never ordered by hand go after the ordered ones), then priority.
    .orderBy(asc(sql`coalesce(${prospects.position}, 1000000000)`), desc(sql`coalesce(${businesses.priority}, -1)`))
    .all();
  const byStage = Object.fromEntries(PIPELINE_STAGE_KEYS.filter((k) => !MACHINE_STAGES.includes(k)).map((k) => [k, [] as typeof rows]));
  for (const r of rows) (byStage[r.prospect.stage] ?? (byStage[r.prospect.stage] = [])).push(r);
  return byStage;
}

/** How many businesses sit in the stages the system manages, with the research outcome of those that were looked at. */
/**
 * What the app shell shows on every page: how much is waiting in each section,
 * and what still has to be set up before the whole flow can run. Three counts
 * and one settings read; nothing here touches the network.
 */
export async function navStatus(): Promise<{ counts: { businesses: number; outreach: number; pipeline: number }; setup: { label: string; href: string }[] }> {
  const db = await getDb();
  const cfg = getConfig();
  const one = async (q: Promise<{ n: number } | undefined>) => Number((await q)?.n ?? 0);
  const ws = await workspaceId();
  const mine = businessIdsOf(db, ws);
  const [toJudge, emails, replies, settings] = await Promise.all([
    one(
      db
        .select({ n: sql<number>`count(*)` })
        .from(businesses)
        .leftJoin(prospects, eq(prospects.businessId, businesses.id))
        .where(sql`${businesses.workspaceId} = ${ws} and ${businesses.verdict} in ('needs_review', 'insufficient_evidence') and coalesce(${prospects.stage}, 'discovered') in ('discovered', 'researching')`)
        .get(),
    ),
    one(db.select({ n: sql<number>`count(*)` }).from(outreachDrafts).where(and(inArray(outreachDrafts.status, ["ready", "needs_review", "failed"]), inArray(outreachDrafts.businessId, mine))).get()),
    one(db.select({ n: sql<number>`count(*)` }).from(inboundEmails).where(and(eq(inboundEmails.kind, "reply"), isNull(inboundEmails.handledAt), inArray(inboundEmails.businessId, mine))).get()),
    getSettings(),
  ]);
  const setup: { label: string; href: string }[] = [];
  if (!cfg.googleMaps.enabled) setup.push({ label: "Business search key", href: settingsHref("connections") });
  if (!cfg.firecrawl.enabled) setup.push({ label: "Website research key", href: settingsHref("connections") });
  if (!cfg.ai.enabled) setup.push({ label: "AI key", href: settingsHref("connections") });
  if (!cfg.mail.enabled) setup.push({ label: "Mailbox", href: settingsHref("mailbox") });
  if (missingSenderDetails(settings).length > 0) setup.push({ label: "Your sender details", href: settingsHref("sender") });
  return { counts: { businesses: toJudge, outreach: emails, pipeline: replies }, setup };
}

export async function machineStageCounts() {
  const db = await getDb();
  const rows = await db
    .select({ stage: prospects.stage, verdict: businesses.verdict, status: businesses.status, n: sql<number>`count(*)` })
    .from(prospects)
    .innerJoin(businesses, eq(prospects.businessId, businesses.id))
    .where(and(inArray(prospects.stage, MACHINE_STAGES), eq(businesses.workspaceId, await workspaceId())))
    .groupBy(prospects.stage, businesses.verdict, businesses.status)
    .all();
  const sum = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).reduce((n, r) => n + Number(r.n), 0);
  return {
    discovered: sum((r) => r.stage === "discovered"),
    researching: sum((r) => r.stage === "researching"),
    notResearched: sum((r) => r.stage === "discovered" && r.status !== "profiled"),
    needsReview: sum((r) => r.verdict === "needs_review" || r.verdict === "insufficient_evidence"),
    notAFit: sum((r) => r.verdict === "not_a_fit"),
    noContact: sum((r) => r.verdict === "no_contact"),
  };
}
export async function exportBusinessesCsv() {
  const { rows } = await listBusinesses({ limit: 10000 });
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["name", "industry", "website", "email", "phone", "city", "region", "country", "status", "verdict", "priority", "best_attractiveness", "best_confidence", "stage", "summary"];
  const lines = rows.map((r) => [r.business.name, r.business.industry, r.business.website, r.business.email, r.business.phone, r.business.city, r.business.region, r.business.country, r.business.status, r.business.verdict, r.business.priority, r.business.bestAttractiveness, r.business.bestConfidence, r.stage, r.business.summary].map(esc).join(","));
  return [header.join(","), ...lines].join("\n");
}

/** Recent jobs of the acting workspace for the system page, newest first, with the business/search they belong to. */
export async function recentJobs(limit = 60) {
  const db = await getDb();
  const rows = await db.select().from(jobs).where(eq(jobs.workspaceId, await workspaceId())).orderBy(desc(jobs.createdAt)).limit(limit).all();
  const bizIds = [...new Set(rows.map((j) => (j.payload as { businessId?: string }).businessId).filter((x): x is string => Boolean(x)))];
  const searchIds = [...new Set(rows.map((j) => (j.payload as { searchId?: string }).searchId).filter((x): x is string => Boolean(x)))];
  const ws = await workspaceId();
  const bizNames = bizIds.length ? await db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(and(inArray(businesses.id, bizIds), eq(businesses.workspaceId, ws))).all() : [];
  const searchNames = searchIds.length ? await db.select({ id: searches.id, name: searches.name }).from(searches).where(and(inArray(searches.id, searchIds), eq(searches.workspaceId, ws))).all() : [];
  const nameOf = new Map<string, { href: string; label: string }>();
  for (const b of bizNames) nameOf.set(b.id, { href: `/businesses/${b.id}`, label: b.name });
  for (const s of searchNames) nameOf.set(s.id, { href: `/searches/${s.id}`, label: s.name });
  return rows.map((j) => {
    const p = j.payload as { businessId?: string; searchId?: string };
    return { ...j, subject: nameOf.get(p.businessId ?? p.searchId ?? "") ?? null };
  });
}

/** How each discovery source behaved over the last searches: runs, failures, average time, last error. */
export async function sourceHealth(limit = 40) {
  const db = await getDb();
  const rows = await db.select({ stats: searches.stats, createdAt: searches.createdAt }).from(searches).where(and(sql`${searches.stats} is not null`, eq(searches.workspaceId, await workspaceId()))).orderBy(desc(searches.createdAt)).limit(limit).all();
  const acc = new Map<string, { runs: number; failures: number; totalMs: number; timed: number; found: number; lastError: string | null; lastAt: string | null }>();
  for (const r of rows) {
    for (const [key, pr] of Object.entries(r.stats?.providerResults ?? {})) {
      const a = acc.get(key) ?? { runs: 0, failures: 0, totalMs: 0, timed: 0, found: 0, lastError: null, lastAt: null };
      a.runs++;
      a.found += pr.found;
      if (pr.error) {
        a.failures++;
        if (!a.lastError) a.lastError = pr.error.slice(0, 160);
      }
      if (pr.durationMs != null) {
        a.totalMs += pr.durationMs;
        a.timed++;
      }
      if (!a.lastAt) a.lastAt = r.createdAt;
      acc.set(key, a);
    }
  }
  return [...acc.entries()].map(([key, a]) => ({ key, ...a, avgMs: a.timed ? Math.round(a.totalMs / a.timed) : null }));
}


// ------------------------------------------------------------ search candidates
export const CANDIDATE_SORTS = ["rank", "lead", "name", "completeness", "discovered"] as const;
export type CandidateSort = (typeof CANDIDATE_SORTS)[number];

export interface CandidateFilters {
  q?: string;
  source?: string;
  website?: "yes" | "no";
  phone?: "yes" | "no";
  saved?: "yes" | "no";
  sort?: CandidateSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  from?: string | null;
  to?: string | null;
}

/** What a search found: candidates with their saved business (if any), filtered, sorted and paged server-side. */
export async function getSearchCandidates(searchId: string, f: CandidateFilters = {}) {
  const db = await getDb();
  const ws = await workspaceId();
  // Candidates carry no workspace of their own: they are read through their search, and a search of another workspace has none.
  const ofSearch = inArray(searchCandidates.searchId, db.select({ id: searches.id }).from(searches).where(and(eq(searches.id, searchId), eq(searches.workspaceId, ws))));
  const conds = [ofSearch];
  if (f.q) conds.push(or(like(searchCandidates.name, `%${f.q}%`), like(searchCandidates.city, `%${f.q}%`), like(searchCandidates.websiteDomain, `%${f.q}%`), like(searchCandidates.street, `%${f.q}%`), like(searchCandidates.category, `%${f.q}%`))!);
  if (f.source) conds.push(like(searchCandidates.sources, `%"provider":"${f.source.replace(/[^a-z_]/g, "")}"%`));
  if (f.website === "yes") conds.push(isNotNull(searchCandidates.website));
  if (f.website === "no") conds.push(isNull(searchCandidates.website));
  if (f.phone === "yes") conds.push(isNotNull(searchCandidates.phone));
  if (f.phone === "no") conds.push(isNull(searchCandidates.phone));
  if (f.saved === "yes") conds.push(isNotNull(searchCandidates.businessId));
  if (f.saved === "no") conds.push(isNull(searchCandidates.businessId));
  if (f.from) conds.push(gte(searchCandidates.createdAt, f.from));
  if (f.to) conds.push(lte(searchCandidates.createdAt, f.to));
  const dir = f.dir === "asc" ? asc : desc;
  const order = { rank: searchCandidates.rank, lead: searchCandidates.leadScore, name: sql`lower(${searchCandidates.name})`, completeness: searchCandidates.completeness, discovered: searchCandidates.createdAt }[f.sort ?? "rank"];
  const pageSize = f.pageSize ?? 50;
  const page = f.page ?? 1;
  const where = and(...conds);
  const rows = await db
    .select({ candidate: searchCandidates, business: { id: businesses.id, status: businesses.status, verdict: businesses.verdict, priority: businesses.priority, investigatedAt: businesses.investigatedAt } })
    .from(searchCandidates)
    .leftJoin(businesses, and(eq(searchCandidates.businessId, businesses.id), eq(businesses.workspaceId, ws)))
    .where(where)
    .orderBy(dir(order), searchCandidates.rank)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const totalRow = await db.select({ n: sql<number>`count(*)` }).from(searchCandidates).where(where).get();
  const all = await db.select({ sources: searchCandidates.sources, website: searchCandidates.website, phone: searchCandidates.phone, businessId: searchCandidates.businessId, possibleDuplicateOf: searchCandidates.possibleDuplicateOf }).from(searchCandidates).where(ofSearch).all();
  const bySource: Record<string, number> = {};
  for (const r of all) for (const s of new Set(r.sources.map((x) => x.provider))) bySource[s] = (bySource[s] ?? 0) + 1;
  const counts = { total: all.length, saved: all.filter((r) => r.businessId).length, withWebsite: all.filter((r) => r.website).length, withPhone: all.filter((r) => r.phone).length, possibleDuplicates: all.filter((r) => r.possibleDuplicateOf).length, bySource };
  return { rows: rows.map((r) => ({ ...r.candidate, business: r.business?.id ? r.business : null })), total: totalRow?.n ?? 0, page, pageSize, counts };
}

/** Header data for a search page: the search, its latest discovery job, and what happened to the saved businesses. */
export async function getSearchOverview(id: string) {
  const db = await getDb();
  const ws = await workspaceId();
  const search = await db.select().from(searches).where(and(eq(searches.id, id), eq(searches.workspaceId, ws))).get();
  if (!search) return null;
  const job = (await db.select().from(jobs).where(and(eq(jobs.type, "discover_search"), sql`json_extract(${jobs.payload}, '$.searchId') = ${id}`)).orderBy(desc(jobs.createdAt)).limit(1).get()) ?? null;
  const saved = await db.select({ status: businesses.status, verdict: businesses.verdict, kind: businesses.kind }).from(searchResults).innerJoin(businesses, eq(searchResults.businessId, businesses.id)).where(and(eq(searchResults.searchId, id), eq(businesses.workspaceId, ws))).all();
  const businessStats = {
    saved: saved.length,
    investigated: saved.filter((b) => b.status === "profiled").length,
    processing: saved.filter((b) => b.status === "queued" || b.status === "investigating").length,
    investigable: saved.filter((b) => b.kind !== "chain" && ["new", "failed", "no_website"].includes(b.status)).length,
    withOpportunity: saved.filter((b) => b.verdict === "qualified").length,
    failed: saved.filter((b) => b.status === "failed").length,
  };
  return { search, job, businessStats };
}

/** Stage changes across all prospects, newest first: the pipeline's move history. */
/** How many businesses are on the board at all, whatever the period, and which of them have a reply nobody answered yet. */
export async function boardTotals(): Promise<{ onBoard: number; openReplies: Record<string, number> }> {
  const db = await getDb();
  const mine = businessIdsOf(db, await workspaceId());
  const [total, replies] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(prospects).where(and(notInArray(prospects.stage, MACHINE_STAGES), inArray(prospects.businessId, mine))).get(),
    db.select({ businessId: inboundEmails.businessId, n: sql<number>`count(*)` }).from(inboundEmails).where(and(eq(inboundEmails.kind, "reply"), isNull(inboundEmails.handledAt), inArray(inboundEmails.businessId, mine))).groupBy(inboundEmails.businessId).all(),
  ]);
  return { onBoard: Number(total?.n ?? 0), openReplies: Object.fromEntries(replies.filter((r) => r.businessId).map((r) => [r.businessId as string, Number(r.n)])) };
}

/** The kinds of event the process history can be narrowed to, with the activity types each covers. */
export const HISTORY_KINDS = [
  { key: "all", label: "Everything", types: [] as string[] },
  { key: "stage", label: "Stage moves", types: ["stage_change"] },
  { key: "contact", label: "Emails, calls and notes", types: ["email", "call", "meeting", "note"] },
  { key: "system", label: "Research and system", types: ["system"] },
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number]["key"];

/**
 * The history of the whole process: every recorded event across all businesses
 * in a period (found and researched, verdicts, emails written and sent,
 * replies, stage moves by the system or by hand, notes), newest first.
 */
export async function pipelineHistory({ fromIso, toIso, kind = "all", q, page = 1, pageSize = 40 }: { fromIso?: string | null; toIso?: string | null; kind?: HistoryKind; q?: string; page?: number; pageSize?: number }) {
  const db = await getDb();
  const period = [eq(businesses.workspaceId, await workspaceId()), fromIso ? gte(activities.createdAt, fromIso) : undefined, toIso ? lte(activities.createdAt, toIso) : undefined, q ? or(like(businesses.name, `%${q}%`), like(businesses.city, `%${q}%`), like(businesses.websiteDomain, `%${q}%`)) : undefined];
  const types = HISTORY_KINDS.find((k) => k.key === kind)?.types ?? [];
  const where = and(...period, types.length ? inArray(activities.type, types) : undefined);
  const [rows, total, byType] = await Promise.all([
    db
      .select({ id: activities.id, type: activities.type, content: activities.content, metadata: activities.metadata, createdAt: activities.createdAt, businessId: businesses.id, businessName: businesses.name })
      .from(activities)
      .innerJoin(businesses, eq(activities.businessId, businesses.id))
      .where(where)
      .orderBy(desc(activities.createdAt), desc(activities.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all(),
    db.select({ n: sql<number>`count(*)` }).from(activities).innerJoin(businesses, eq(activities.businessId, businesses.id)).where(where).get(),
    db.select({ type: activities.type, n: sql<number>`count(*)` }).from(activities).innerJoin(businesses, eq(activities.businessId, businesses.id)).where(and(...period)).groupBy(activities.type).all(),
  ]);
  const perType = Object.fromEntries(byType.map((r) => [r.type, Number(r.n)])) as Record<string, number>;
  const counts = Object.fromEntries(HISTORY_KINDS.map((k) => [k.key, k.types.length ? k.types.reduce((n, t) => n + (perType[t] ?? 0), 0) : Object.values(perType).reduce((a, b) => a + b, 0)])) as Record<HistoryKind, number>;
  return {
    items: rows.map((r) => ({ id: r.id, type: r.type, content: r.content, metadata: (r.metadata ?? null) as Record<string, unknown> | null, createdAt: r.createdAt, business: { id: r.businessId, name: r.businessName } })),
    total: Number(total?.n ?? 0),
    counts,
  };
}

export async function recentStageChanges({ limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}) {
  const db = await getDb();
  const ws = await workspaceId();
  const total = (await db.select({ n: sql<number>`count(*)` }).from(activities).where(and(eq(activities.type, "stage_change"), inArray(activities.businessId, businessIdsOf(db, ws)))).get())?.n ?? 0;
  const rows = await db
    .select({ id: activities.id, businessId: activities.businessId, name: businesses.name, content: activities.content, metadata: activities.metadata, createdAt: activities.createdAt })
    .from(activities)
    .innerJoin(businesses, eq(activities.businessId, businesses.id))
    .where(and(eq(activities.type, "stage_change"), eq(businesses.workspaceId, ws)))
    .orderBy(desc(activities.createdAt), desc(activities.id))
    .limit(limit)
    .offset(offset)
    .all();
  const items = rows.map((r) => {
    const m = (r.metadata ?? {}) as { from?: string; to?: string; automatic?: boolean };
    const reason = r.content.replace(/^Stage (?:changed|set) to \w+:?\s*/, "");
    return { id: r.id, businessId: r.businessId, name: r.name, from: m.from ?? null, to: m.to ?? null, automatic: Boolean(m.automatic), reason, at: r.createdAt };
  });
  return { items, total };
}

/** One page of a business's activity log, newest first, optionally limited to some event types; plus counts per type. */
export async function businessActivities(id: string, { types, page, pageSize }: { types?: string[]; page: number; pageSize: number }) {
  const db = await getDb();
  const ofBusiness = and(eq(activities.businessId, id), inArray(activities.businessId, businessIdsOf(db, await workspaceId())));
  const where = types?.length ? and(ofBusiness, inArray(activities.type, types)) : ofBusiness;
  const [items, total, byType] = await Promise.all([
    db.select().from(activities).where(where).orderBy(desc(activities.createdAt), desc(activities.id)).limit(pageSize).offset((page - 1) * pageSize).all(),
    db.select({ n: sql<number>`count(*)` }).from(activities).where(where).get().then((r) => r?.n ?? 0),
    db.select({ type: activities.type, n: sql<number>`count(*)` }).from(activities).where(ofBusiness).groupBy(activities.type).all(),
  ]);
  return { items, total, countsByType: Object.fromEntries(byType.map((r) => [r.type, r.n])) as Record<string, number> };
}
