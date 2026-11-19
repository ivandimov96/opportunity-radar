import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activities, businesses, prospects } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { assertBusinessInWorkspace, businessInWorkspace, workspaceId } from "@/lib/workspace";
import { CONTACTED_STAGES, PIPELINE_STAGE_KEYS, PRE_CONTACT_STAGES, type PipelineStage } from "./stages";

/**
 * Every function here that changes something goes through `ensureProspect` or `logActivity`, and both
 * refuse a business that is not in the acting workspace. A request acts as its signed-in user's
 * workspace and a job as the workspace it was queued in, so each can only move its own businesses.
 */
export async function ensureProspect(businessId: string, stage: PipelineStage = "discovered") {
  await assertBusinessInWorkspace(businessId);
  const db = await getDb();
  const existing = await db.select().from(prospects).where(eq(prospects.businessId, businessId)).get();
  if (existing) return existing;
  await db.insert(prospects).values({ businessId, stage, updatedAt: nowIso() }).onConflictDoNothing().run();
  return (await db.select().from(prospects).where(eq(prospects.businessId, businessId)).get())!;
}

export async function logActivity(businessId: string, type: string, content: string, metadata?: Record<string, unknown>) {
  await assertBusinessInWorkspace(businessId);
  const db = await getDb();
  await db.insert(activities).values({ id: newId(), businessId, type, content, metadata: metadata ?? null }).run();
}

/** Only moves forward automatically; never regresses a stage the operator advanced. */
export async function advanceStageIfBehind(businessId: string, target: PipelineStage, reason: string) {
  const db = await getDb();
  const p = await ensureProspect(businessId);
  const cur = PIPELINE_STAGE_KEYS.indexOf(p.stage as PipelineStage);
  const tgt = PIPELINE_STAGE_KEYS.indexOf(target);
  if (CONTACTED_STAGES.includes(p.stage as PipelineStage)) return;
  if (tgt > cur) {
    await db.update(prospects).set({ stage: target, updatedAt: nowIso() }).where(eq(prospects.businessId, businessId)).run();
    await logActivity(businessId, "stage_change", `Stage set to ${target}: ${reason}`, { from: p.stage, to: target, automatic: true });
  }
}

/** Research started: a business waiting in "discovered" shows as "researching" until the result is in. */
export async function markResearching(businessId: string) {
  const db = await getDb();
  const p = await ensureProspect(businessId);
  if (p.stage !== "discovered") return;
  await db.update(prospects).set({ stage: "researching", updatedAt: nowIso() }).where(eq(prospects.businessId, businessId)).run();
}

/**
 * Keeps the pipeline in step with research: a qualified business moves forward;
 * one that does not qualify (or whose research failed) goes back to "discovered"
 * unless it has already been contacted.
 */
export async function syncStageWithVerdict(businessId: string, verdict: string) {
  if (verdict === "qualified") return advanceStageIfBehind(businessId, "qualified", "research qualified the business");
  const db = await getDb();
  const p = await ensureProspect(businessId);
  if (!PRE_CONTACT_STAGES.includes(p.stage as PipelineStage)) return;
  await db.update(prospects).set({ stage: "discovered", updatedAt: nowIso() }).where(eq(prospects.businessId, businessId)).run();
  if (p.stage !== "researching") await logActivity(businessId, "stage_change", "Stage set to discovered: research no longer qualifies the business", { from: p.stage, to: "discovered", automatic: true });
}

/** A person answered: "contacted" becomes "replied". Later stages are the operator's and are left alone. */
export async function markReplied(businessId: string) {
  const db = await getDb();
  const p = await ensureProspect(businessId);
  if (p.stage !== "contacted") return;
  await db.update(prospects).set({ stage: "replied", updatedAt: nowIso() }).where(eq(prospects.businessId, businessId)).run();
  await logActivity(businessId, "stage_change", "Stage set to replied: a reply arrived", { from: p.stage, to: "replied", automatic: true });
}

/** The first email bounced for good: the business was not reached, so it leaves "contacted". */
export async function markNotReached(businessId: string) {
  const db = await getDb();
  const p = await ensureProspect(businessId);
  if (p.stage !== "contacted") return;
  await db.update(prospects).set({ stage: "qualified", updatedAt: nowIso() }).where(eq(prospects.businessId, businessId)).run();
  await logActivity(businessId, "stage_change", "Stage set to qualified: the email bounced, the business was not reached", { from: p.stage, to: "qualified", automatic: true });
}

export async function setStage(businessId: string, stage: PipelineStage, note?: string) {
  const db = await getDb();
  const p = await ensureProspect(businessId);
  if (p.stage === stage) return;
  await db.update(prospects).set({ stage, updatedAt: nowIso() }).where(eq(prospects.businessId, businessId)).run();
  await logActivity(businessId, "stage_change", note ? `Stage changed to ${stage}: ${note}` : `Stage changed to ${stage}`, { from: p.stage, to: stage });
}

/**
 * A drag on the pipeline board: the card lands in `stage` and the whole target
 * column is saved in the order the operator sees (positions 0..n-1). The stage
 * change, if any, is logged like every other one; a pure reorder is not an event.
 */
export async function moveOnBoard(businessId: string, stage: PipelineStage, orderedIds: string[]) {
  const db = await getDb();
  await setStage(businessId, stage, "moved on the pipeline board");
  const visible = orderedIds.includes(businessId) ? orderedIds : [...orderedIds, businessId];
  // The board may be filtered, so `visible` can be a subset of the column. Keep hidden cards where they
  // are and fill the slots of the visible ones in their new order; the moved card lands just before the
  // visible card that follows it (or at the end).
  const column = (await db.select({ id: prospects.businessId, position: prospects.position, priority: businesses.priority }).from(prospects).innerJoin(businesses, eq(businesses.id, prospects.businessId)).where(and(eq(prospects.stage, stage), eq(businesses.workspaceId, await workspaceId()))).all())
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || (b.priority ?? -1) - (a.priority ?? -1))
    .map((r) => r.id)
    .filter((id) => id !== businessId);
  const inColumn = new Set([...column, businessId]);
  const queue = visible.filter((id) => inColumn.has(id));
  const visibleSet = new Set(queue);
  const final: string[] = [];
  for (const id of column) {
    if (!visibleSet.has(id)) {
      final.push(id);
      continue;
    }
    while (queue.length && queue[0] === businessId) final.push(queue.shift()!);
    if (queue.length) final.push(queue.shift()!);
  }
  final.push(...queue);
  // `final` holds ids of this workspace's column plus the moved card (checked by setStage above): nothing else is repositioned.
  const updates = final.map((id, i) => db.update(prospects).set({ position: i }).where(eq(prospects.businessId, id)));
  if (updates.length) await db.batch(updates as [(typeof updates)[number], ...typeof updates]);
}

export async function setNextAction(businessId: string, nextAction: string | null, nextActionAt: string | null, priority?: string) {
  const db = await getDb();
  await ensureProspect(businessId);
  await db
    .update(prospects)
    .set({ nextAction, nextActionAt, ...(priority ? { priority } : {}), updatedAt: nowIso() })
    .where(eq(prospects.businessId, businessId))
    .run();
}

export async function recentActivities(businessId: string, limit = 50) {
  if (!(await businessInWorkspace(businessId))) return [];
  const db = await getDb();
  return db.select().from(activities).where(eq(activities.businessId, businessId)).orderBy(desc(activities.createdAt)).limit(limit).all();
}
