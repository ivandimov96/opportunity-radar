/**
 * How many emails may leave per day. In manual mode it is the operator's own
 * number. While the app sends on its own, a mailbox that has not sent for long
 * starts low and rises week by week: a sudden jump in volume from a new sender
 * is the classic reason mail lands in spam. The operator's number stays the ceiling.
 */
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { outreachDrafts } from "@/db/schema";
import type { AppSettings } from "@/lib/settings";
import { businessIdsOf, workspaceId } from "@/lib/workspace";

export const WARM_UP_START = 10;
export const WARM_UP_STEP_PER_WEEK = 5;

/** The warm-up limit for a mailbox whose first email went out at `firstSentAt`: 10 a day in the first week, 5 more each week after. */
export function warmUpCap(firstSentAt: Date | null, now: Date): number {
  if (!firstSentAt) return WARM_UP_START;
  const weeks = Math.max(0, Math.floor((now.getTime() - firstSentAt.getTime()) / (7 * 86_400_000)));
  return WARM_UP_START + WARM_UP_STEP_PER_WEEK * weeks;
}

export interface DailyCap {
  cap: number;
  /** True while the warm-up, not the operator's number, is what limits sending. */
  warmingUp: boolean;
}

/** The daily limit in force for the acting workspace. */
export async function dailyCapInForce(settings: Pick<AppSettings, "dailySendCap" | "sendMode">, now = new Date()): Promise<DailyCap> {
  if (settings.sendMode === "manual") return { cap: settings.dailySendCap, warmingUp: false };
  const db = await getDb();
  const row = await db
    .select({ first: sql<string | null>`min(${outreachDrafts.sentAt})` })
    .from(outreachDrafts)
    .where(and(inArray(outreachDrafts.businessId, businessIdsOf(db, await workspaceId())), inArray(outreachDrafts.status, ["sent", "bounced"]), isNotNull(outreachDrafts.sentAt)))
    .get();
  const ramp = warmUpCap(row?.first ? new Date(row.first) : null, now);
  return ramp < settings.dailySendCap ? { cap: ramp, warmingUp: true } : { cap: settings.dailySendCap, warmingUp: false };
}
