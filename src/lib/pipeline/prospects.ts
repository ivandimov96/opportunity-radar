import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activities, prospects, validationSignals } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { PIPELINE_STAGE_KEYS, type PipelineStage, type ValidationSignalType } from "./stages";

export function ensureProspect(businessId: string, stage: PipelineStage = "discovered") {
  const db = getDb();
  const existing = db.select().from(prospects).where(eq(prospects.businessId, businessId)).get();
  if (existing) return existing;
  db.insert(prospects).values({ businessId, stage, updatedAt: nowIso() }).onConflictDoNothing().run();
  return db.select().from(prospects).where(eq(prospects.businessId, businessId)).get()!;
}

export function logActivity(businessId: string, type: string, content: string, metadata?: Record<string, unknown>) {
  getDb().insert(activities).values({ id: newId(), businessId, type, content, metadata: metadata ?? null }).run();
}

/** Only moves forward automatically; never regresses a stage the operator advanced. */
export function advanceStageIfBehind(businessId: string, target: PipelineStage, reason: string) {
  const db = getDb();
  const p = ensureProspect(businessId);
  const cur = PIPELINE_STAGE_KEYS.indexOf(p.stage as PipelineStage);
  const tgt = PIPELINE_STAGE_KEYS.indexOf(target);
  const terminal = ["contacted", "in_conversation", "validated", "won", "lost", "disqualified"];
  if (terminal.includes(p.stage)) return;
  if (tgt > cur) {
    db.update(prospects).set({ stage: target, updatedAt: nowIso() }).where(eq(prospects.businessId, businessId)).run();
    logActivity(businessId, "stage_change", `Stage set to ${target}: ${reason}`, { from: p.stage, to: target, automatic: true });
  }
}

export function setStage(businessId: string, stage: PipelineStage, note?: string) {
  const db = getDb();
  const p = ensureProspect(businessId);
  if (p.stage === stage) return;
  db.update(prospects).set({ stage, updatedAt: nowIso() }).where(eq(prospects.businessId, businessId)).run();
  logActivity(businessId, "stage_change", note ? `Stage changed to ${stage}: ${note}` : `Stage changed to ${stage}`, { from: p.stage, to: stage });
}

export function setNextAction(businessId: string, nextAction: string | null, nextActionAt: string | null, priority?: string) {
  ensureProspect(businessId);
  getDb()
    .update(prospects)
    .set({ nextAction, nextActionAt, ...(priority ? { priority } : {}), updatedAt: nowIso() })
    .where(eq(prospects.businessId, businessId))
    .run();
}

export function addValidationSignal(businessId: string, opportunityCategory: string, signalType: ValidationSignalType, notes?: string) {
  const db = getDb();
  db.insert(validationSignals).values({ id: newId(), businessId, opportunityCategory, signalType, notes: notes ?? null }).run();
  logActivity(businessId, "validation", `Validation signal: ${signalType} for ${opportunityCategory}${notes ? ` — ${notes}` : ""}`, { opportunityCategory, signalType });
  if (signalType === "confirmed_problem" || signalType === "pilot") setStage(businessId, "validated", "validation signal recorded");
  if (signalType === "paying") setStage(businessId, "won", "paying customer");
}

export function recentActivities(businessId: string, limit = 50) {
  return getDb().select().from(activities).where(eq(activities.businessId, businessId)).orderBy(desc(activities.createdAt)).limit(limit).all();
}
