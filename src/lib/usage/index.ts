/**
 * Usage per workspace: counting what each one does in a month, and holding it
 * to its plan. Counting is one statement per event (`count`); limits are asked
 * before work is queued (`room`, `assertRoom`) and once more when it starts.
 * Nothing here spends anything, and nothing is ever counted down.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { FIRST_WORKSPACE_ID, aiUsage, businesses, investigations, jobs, users, workspaceUsage, workspaces } from "@/db/schema";
import { nowIso } from "@/lib/ids";
import { workspaceId } from "@/lib/workspace";
import { METRIC_NOUN, PLANS, planOf, type LimitedMetric, type Metric, type Plan } from "./plans";

export * from "./plans";

/** The month usage is counted over: UTC, "YYYY-MM". */
export const usagePeriod = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
/** The day the counters start again, as a date people read ("1 December"). */
export function resetsOn(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** Thrown where work would go over the plan. The message is written for the person who pressed the button. */
export class UsageLimitError extends Error {
  constructor(
    message: string,
    public readonly metric: LimitedMetric,
  ) {
    super(message);
    this.name = "UsageLimitError";
  }
}

/** Counts `n` of something for the acting workspace, this month. */
export async function count(metric: Metric, n = 1): Promise<void> {
  if (n <= 0) return;
  const db = await getDb();
  const at = nowIso();
  await db
    .insert(workspaceUsage)
    .values({ workspaceId: await workspaceId(), period: usagePeriod(), metric, used: n, updatedAt: at })
    .onConflictDoUpdate({ target: [workspaceUsage.workspaceId, workspaceUsage.period, workspaceUsage.metric], set: { used: sql`${workspaceUsage.used} + ${n}`, updatedAt: at } })
    .run();
}

async function planFor(ws: string): Promise<Plan> {
  const db = await getDb();
  const row = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws)).get();
  // A workspace row that predates plans, or code running without one (scripts, tests), is the product's own.
  return row ? planOf(row.plan) : ws === FIRST_WORKSPACE_ID ? PLANS.owner : planOf(null);
}

async function usedThisMonth(ws: string): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select({ metric: workspaceUsage.metric, used: workspaceUsage.used }).from(workspaceUsage).where(and(eq(workspaceUsage.workspaceId, ws), eq(workspaceUsage.period, usagePeriod()))).all();
  return Object.fromEntries(rows.map((r) => [r.metric, r.used]));
}

/** Work that is queued or running and will be counted when it starts: it already takes up room. */
async function pending(ws: string, metric: LimitedMetric): Promise<number> {
  const db = await getDb();
  const type = metric === "searches" ? "discover_search" : "investigate_business";
  const row = await db.select({ n: sql<number>`count(*)` }).from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.type, type), eq(jobs.status, "queued"))).get();
  return Number(row?.n ?? 0);
}

export interface Room {
  plan: Plan;
  used: number;
  /** null = no limit. */
  limit: number | null;
  /** How many more may be started now (queued work counted in); Infinity without a limit. */
  left: number;
  /** Why nothing more may be started, in plain words; null while there is room. */
  reason: string | null;
}

/** How much of a limited metric the acting workspace may still start this month. */
export async function room(metric: LimitedMetric, ws?: string): Promise<Room> {
  const id = ws ?? (await workspaceId());
  const plan = await planFor(id);
  const limit = plan.limits[metric];
  const used = (await usedThisMonth(id))[metric] ?? 0;
  if (limit === null) return { plan, used, limit, left: Infinity, reason: null };
  const left = Math.max(0, limit - used - (await pending(id, metric)));
  const noun = METRIC_NOUN[metric];
  return { plan, used, limit, left, reason: left > 0 ? null : `Your ${plan.label} plan includes ${limit} ${limit === 1 ? noun.one : noun.many} a month and all of them are used. The count starts again on ${resetsOn()}.` };
}

/** Refuses, in the person's words, to start `n` more than the plan has room for. */
export async function assertRoom(metric: LimitedMetric, n = 1): Promise<void> {
  const r = await room(metric);
  if (r.left >= n) return;
  const noun = METRIC_NOUN[metric];
  throw new UsageLimitError(r.left === 0 ? r.reason! : `Your ${r.plan.label} plan has room for ${r.left} more ${r.left === 1 ? noun.one : noun.many} this month, not ${n}. The count starts again on ${resetsOn()}.`, metric);
}

/**
 * The last check, when the work actually starts: counts it, or refuses when the month is already full
 * (something queued before the limit was reached, or a plan that was lowered meanwhile).
 */
export async function countOrRefuse(metric: LimitedMetric): Promise<void> {
  const id = await workspaceId();
  const plan = await planFor(id);
  const limit = plan.limits[metric];
  if (limit !== null && ((await usedThisMonth(id))[metric] ?? 0) >= limit) {
    const noun = METRIC_NOUN[metric];
    throw new UsageLimitError(`Your ${plan.label} plan includes ${limit} ${limit === 1 ? noun.one : noun.many} a month and all of them are used. The count starts again on ${resetsOn()}.`, metric);
  }
  await count(metric);
}

export interface WorkspaceUsage {
  plan: Plan;
  resetsOn: string;
  searches: { used: number; limit: number | null };
  research: { used: number; limit: number | null };
  emails: number;
  /** What it cost the product this month. */
  cost: { aiUsd: number; pageCredits: number; searchCredits: number };
}

/** This month's usage of one workspace: what its owner sees under Settings, and one line of the owner's table. */
export async function usageOf(ws?: string): Promise<WorkspaceUsage> {
  const id = ws ?? (await workspaceId());
  const db = await getDb();
  const since = monthStart().toISOString();
  const [plan, used, ai, pages] = await Promise.all([
    planFor(id),
    usedThisMonth(id),
    db.select({ usd: sql<number>`coalesce(sum(${aiUsage.estimatedCostUsd}), 0)` }).from(aiUsage).where(and(eq(aiUsage.workspaceId, id), gte(aiUsage.createdAt, since))).get(),
    db
      .select({ credits: sql<number>`coalesce(sum(${investigations.creditsUsed}), 0)` })
      .from(investigations)
      .where(and(gte(investigations.startedAt, since), inArray(investigations.businessId, db.select({ id: businesses.id }).from(businesses).where(eq(businesses.workspaceId, id)))))
      .get(),
  ]);
  return {
    plan,
    resetsOn: resetsOn(),
    searches: { used: used.searches ?? 0, limit: plan.limits.searches },
    research: { used: used.research ?? 0, limit: plan.limits.research },
    emails: used.emails ?? 0,
    cost: { aiUsd: Number(ai?.usd ?? 0), pageCredits: Number(pages?.credits ?? 0), searchCredits: used.search_credits ?? 0 },
  };
}

/** Every workspace with who owns it and what it used this month: the table only the product's own workspace sees. */
export async function usageByWorkspace(): Promise<({ id: string; name: string; owner: string | null; createdAt: string } & WorkspaceUsage)[]> {
  const db = await getDb();
  const rows = await db.select().from(workspaces).all();
  const people = await db.select({ workspaceId: users.workspaceId, email: users.email, createdAt: users.createdAt }).from(users).orderBy(users.createdAt).all();
  const out = [];
  for (const w of rows) out.push({ id: w.id, name: w.name, owner: people.find((p) => p.workspaceId === w.id)?.email ?? null, createdAt: w.createdAt, ...(await usageOf(w.id)) });
  // The product's own first, then the ones that cost the most this month.
  return out.sort((a, b) => Number(b.id === FIRST_WORKSPACE_ID) - Number(a.id === FIRST_WORKSPACE_ID) || b.cost.aiUsd - a.cost.aiUsd || a.name.localeCompare(b.name));
}

/** Puts a workspace on a plan. Only the product's own workspace may call this (checked by the action). */
export async function setWorkspacePlan(ws: string, plan: string): Promise<boolean> {
  if (!PLANS[plan]) return false;
  const db = await getDb();
  // "owner" is for the product's own workspace, and that one stays on it.
  if ((plan === "owner") !== (ws === FIRST_WORKSPACE_ID)) return false;
  const row = await db.update(workspaces).set({ plan }).where(eq(workspaces.id, ws)).returning({ id: workspaces.id }).get();
  return Boolean(row);
}
