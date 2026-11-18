/**
 * Which idea a business is approached with. Research proposes one main idea
 * and up to two different alternatives; the operator may prefer one of the
 * alternatives. Choosing it makes it the idea outreach is built on and
 * withdraws any unsent email that was written about the previous one.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, opportunities, outreachDrafts } from "@/db/schema";
import { nowIso } from "@/lib/ids";
import { logActivity } from "@/lib/pipeline/prospects";
import { priorityScore } from "@/lib/scoring/score";
import { OUTBOUND_COMMITTED } from "./eligibility";

export type ChooseIdeaResult = { ok: true; title: string; withdrawn: number } | { ok: false; error: string };

export async function chooseIdea(businessId: string, opportunityId: string): Promise<ChooseIdeaResult> {
  const db = await getDb();
  const all = await db.select().from(opportunities).where(eq(opportunities.businessId, businessId)).all();
  const chosen = all.find((o) => o.id === opportunityId);
  if (!chosen) return { ok: false, error: "That idea no longer exists; the business may have been researched again." };
  if (chosen.role === "primary") return { ok: true, title: chosen.title, withdrawn: 0 };
  // Once a first email is on its way or out, the conversation has a subject: it is not swapped underneath it.
  const committed = await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.businessId, businessId), eq(outreachDrafts.step, 0), inArray(outreachDrafts.status, OUTBOUND_COMMITTED))).limit(1).get();
  if (committed) return { ok: false, error: "This business was already emailed about the current idea." };

  const unsent = await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.businessId, businessId), inArray(outreachDrafts.status, ["needs_review", "ready", "approved", "excluded"]))).all();
  const biz = await db.select({ verdict: businesses.verdict }).from(businesses).where(eq(businesses.id, businessId)).get();
  // One batch: roles, the scores the lists sort by, and the withdrawal succeed or fail together (see src/db/client.ts).
  await db.batch([
    db.update(opportunities).set({ role: "secondary" }).where(eq(opportunities.businessId, businessId)),
    db.update(opportunities).set({ role: "primary" }).where(eq(opportunities.id, chosen.id)),
    db
      .update(businesses)
      .set({ bestAttractiveness: chosen.attractivenessScore, bestConfidence: chosen.confidenceScore, priority: priorityScore(chosen.attractivenessScore, chosen.confidenceScore), ...(biz?.verdict === "qualified" ? { statusMessage: `Qualified: ${chosen.title}` } : {}), updatedAt: nowIso() })
      .where(eq(businesses.id, businessId)),
    db.update(outreachDrafts).set({ status: "archived", updatedAt: nowIso() }).where(and(eq(outreachDrafts.businessId, businessId), inArray(outreachDrafts.status, ["needs_review", "ready", "approved", "excluded"]))),
  ]);
  await logActivity(businessId, "note", `You chose a different idea to raise: “${chosen.title}”.${unsent.length ? ` The unsent email about the previous idea was withdrawn.` : ""}`, { opportunityId: chosen.id });
  return { ok: true, title: chosen.title, withdrawn: unsent.length };
}
