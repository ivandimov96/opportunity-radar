/**
 * Sending without the operator's click. Off unless the operator chose it in
 * Settings ("hold" or "auto"), and even then only:
 *  - after the operator has sent enough emails by hand to have seen what goes out;
 *  - for emails whose checks ALL passed (a "needs review" email always waits for a person);
 *  - while the sending numbers look healthy: too many bounces, opt-outs or failed
 *    sends pause it, and only the operator resumes it.
 * It uses the operator's own path: approve, then "Send approved" for the open
 * batch. Nothing here talks to the mailbox; pacing, the daily limit and the
 * last recipient check stay where they are for every email.
 */
import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, inboundEmails, outreachDrafts } from "@/db/schema";
import { mailboxFor } from "@/lib/mail";
import { getSettings, replyRulesOf, type AppSettings, type ReplyKind, type SendMode } from "@/lib/settings";
import { businessIdsOf, workspaceId } from "@/lib/workspace";
import { autopilotPause, autopilotResumedAt, pauseAutopilot, type AutopilotPause } from "./autopilot-state";
import { openCampaign } from "./campaigns";
import { approveDraft } from "./drafts";
import { automaticSendHold } from "./eligibility";
import { dailyCapInForce, type DailyCap } from "./limits";
import { sendCampaign } from "./send";
import { STEP } from "./steps";

/** Emails the operator must have approved and sent themselves before the app may send on its own. */
export const TRUST_MIN_MANUAL = 20;
/** The safety checks look at this many of the latest emails, inside this many days. */
export const HEALTH_SAMPLE = 50;
export const HEALTH_WINDOW_DAYS = 30;
/** A rate only counts once it rests on at least this many cases: one bounce in ten emails is not a trend. */
export const HEALTH_MIN_CASES = 2;
export const HEALTH_MAX_RATE = 0.05;
export const HEALTH_MAX_FAILED_PER_DAY = 3;

export interface SendingHealth {
  sent: number;
  bounced: number;
  optOuts: number;
  failedToday: number;
  /** Why sending on its own must stop, in one sentence; null = healthy. */
  problem: string | null;
}

/** What the last emails did. Pure: the numbers come from `sendingHealth`. */
export function judgeHealth(n: { sent: number; bounced: number; optOuts: number; failedToday: number }): string | null {
  if (n.failedToday >= HEALTH_MAX_FAILED_PER_DAY) return `${n.failedToday} emails could not be sent in the last day. Check the mailbox connection.`;
  if (n.bounced >= HEALTH_MIN_CASES && n.bounced / Math.max(1, n.sent) >= HEALTH_MAX_RATE) return `${n.bounced} of the last ${n.sent} emails bounced. Too many bad addresses hurt how your mail is delivered.`;
  if (n.optOuts >= HEALTH_MIN_CASES && n.optOuts / Math.max(1, n.sent) >= HEALTH_MAX_RATE) return `${n.optOuts} of the last ${n.sent} recipients asked not to be contacted again. The audience or the email needs another look.`;
  return null;
}

export async function sendingHealth(now = new Date()): Promise<SendingHealth> {
  const db = await getDb();
  const mine = businessIdsOf(db, await workspaceId());
  const resumed = await autopilotResumedAt();
  const windowStart = new Date(now.getTime() - HEALTH_WINDOW_DAYS * 86_400_000).toISOString();
  const since = resumed && resumed > windowStart ? resumed : windowStart;
  const latest = await db
    .select({ status: outreachDrafts.status })
    .from(outreachDrafts)
    .where(and(inArray(outreachDrafts.businessId, mine), inArray(outreachDrafts.status, ["sent", "bounced"]), ne(outreachDrafts.step, STEP.answer), gte(outreachDrafts.sentAt, since)))
    .orderBy(sql`${outreachDrafts.sentAt} desc`)
    .limit(HEALTH_SAMPLE)
    .all();
  const optOuts = Number((await db.select({ n: sql<number>`count(*)` }).from(inboundEmails).where(and(inArray(inboundEmails.businessId, mine), eq(inboundEmails.classification, "unsubscribe"), gte(inboundEmails.receivedAt, since))).get())?.n ?? 0);
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const failedSince = resumed && resumed > dayAgo ? resumed : dayAgo;
  const failedToday = Number((await db.select({ n: sql<number>`count(*)` }).from(outreachDrafts).where(and(inArray(outreachDrafts.businessId, mine), eq(outreachDrafts.status, "failed"), gte(outreachDrafts.updatedAt, failedSince))).get())?.n ?? 0);
  const numbers = { sent: latest.length, bounced: latest.filter((d) => d.status === "bounced").length, optOuts, failedToday };
  return { ...numbers, problem: judgeHealth(numbers) };
}

/** Emails that went out on the operator's own approval (everything from before approvals were recorded counts as theirs). */
export async function sentByHand(): Promise<number> {
  const db = await getDb();
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(outreachDrafts)
    .where(and(inArray(outreachDrafts.businessId, businessIdsOf(db, await workspaceId())), inArray(outreachDrafts.status, ["sent", "bounced"]), or(isNull(outreachDrafts.approvedBy), ne(outreachDrafts.approvedBy, "autopilot"))))
    .get();
  return Number(row?.n ?? 0);
}

export interface AutopilotStatus {
  mode: SendMode;
  /** True when the app would send on its own right now. */
  active: boolean;
  /** Why it is not active although a mode is chosen; null when active or manual. */
  waitingFor: string | null;
  paused: AutopilotPause | null;
  sentByHand: number;
  cap: DailyCap;
}

/** Everything the pages show about the autopilot, and the one decision the scheduler asks: may it send now? */
export async function autopilotStatus(settings?: AppSettings, now = new Date()): Promise<AutopilotStatus> {
  const s = settings ?? (await getSettings());
  const [paused, byHand, cap, box] = await Promise.all([autopilotPause(), sentByHand(), dailyCapInForce(s, now), mailboxFor()]);
  const waitingFor =
    s.sendMode === "manual"
      ? null
      : !box.enabled
        ? (box.reason ?? "No mailbox is connected.")
        : paused
          ? paused.reason
          : byHand < TRUST_MIN_MANUAL
            ? `It starts after you have sent ${TRUST_MIN_MANUAL} emails yourself (${byHand} so far), so you have seen what goes out.`
            : null;
  return { mode: s.sendMode, active: s.sendMode !== "manual" && waitingFor === null, waitingFor, paused, sentByHand: byHand, cap };
}

export interface AutopilotRun {
  approved: number;
  queued: number;
  /** Set when this run paused the autopilot. */
  paused?: string;
}

/** When an email that became ready at `readyAt` goes out on its own, or null in manual mode. */
export function releaseTime(readyAt: string, settings: Pick<AppSettings, "sendMode" | "holdHours">): Date | null {
  if (settings.sendMode === "manual") return null;
  return new Date(new Date(readyAt).getTime() + (settings.sendMode === "hold" ? settings.holdHours * 3_600_000 : 0));
}

/**
 * One autopilot round for the acting workspace: passes on the ready emails whose waiting time is over and
 * queues what is approved in the open batch. Called by the scheduler once a minute; does nothing in manual mode.
 */
export async function runAutopilot(now = new Date()): Promise<AutopilotRun> {
  const out: AutopilotRun = { approved: 0, queued: 0 };
  const settings = await getSettings();
  if (settings.sendMode === "manual") return out;
  const status = await autopilotStatus(settings, now);
  if (!status.active) return out;
  const health = await sendingHealth(now);
  if (health.problem) {
    await pauseAutopilot(`${health.problem} Sending on its own is paused until you resume it.`);
    return { ...out, paused: health.problem };
  }
  // "Weekdays only": the weekend is left alone. What is ready waits, with its waiting time long over, for Monday.
  if (settings.autoSendWeekdaysOnly && (now.getDay() === 0 || now.getDay() === 6)) return out;
  const db = await getDb();
  const campaign = await openCampaign();
  const mine = businessIdsOf(db, await workspaceId());
  // Ready since before this moment = the waiting time is over (an edit restarts it: it touches updatedAt).
  const cutoff = new Date(now.getTime() - (settings.sendMode === "hold" ? settings.holdHours * 3_600_000 : 0)).toISOString();
  const ripe = await db
    .select({ id: outreachDrafts.id, step: outreachDrafts.step, inboundId: outreachDrafts.inboundId, business: businesses })
    .from(outreachDrafts)
    .innerJoin(businesses, eq(businesses.id, outreachDrafts.businessId))
    .where(and(eq(outreachDrafts.campaignId, campaign.id), inArray(outreachDrafts.businessId, mine), eq(outreachDrafts.status, "ready"), lte(outreachDrafts.updatedAt, cutoff)))
    .orderBy(outreachDrafts.createdAt)
    .all();
  for (const d of ripe) {
    if (d.step === STEP.answer) {
      // An answer goes out on its own only for a kind of reply the operator set to "send" (asked again now: they may have changed it).
      const reply = d.inboundId ? await db.select({ kind: inboundEmails.classification }).from(inboundEmails).where(eq(inboundEmails.id, d.inboundId)).get() : null;
      if (replyRulesOf(settings)[reply?.kind as ReplyKind]?.action !== "send") continue;
    }
    // The operator's own narrowing: which kind of email, and how good a lead. What is left out waits for them.
    if (d.step === STEP.first && !settings.autoSendFirst) continue;
    if (d.step !== STEP.first && d.step !== STEP.answer && !settings.autoSendFollowUps) continue;
    if (d.step !== STEP.answer && settings.autoSendMinScore > 0 && (d.business.priority ?? d.business.leadScore ?? 0) < settings.autoSendMinScore) continue;
    // An answer goes to someone who wrote to us; every other email needs a recipient the rules let us write to unasked.
    if (d.step !== STEP.answer && (await automaticSendHold(d.business))) continue;
    if ((await approveDraft(d.id, "autopilot")).ok) out.approved++;
  }
  // Emails the operator approved themselves go out with the same round: under the autopilot, approving is sending.
  const waiting = await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.campaignId, campaign.id), inArray(outreachDrafts.businessId, mine), eq(outreachDrafts.status, "approved"))).limit(1).get();
  if (!waiting) return out;
  const res = await sendCampaign(campaign.id, now);
  out.queued = res.ok ? res.queued : 0;
  return out;
}
