/**
 * Sending a batch. "Send approved" does not blast: it checks every recipient
 * once more, then queues one job per email at paced times inside the sending
 * hours and the daily cap. Each email gets its Message-ID here, before the
 * first attempt, so a retry can never produce a second, different message.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, campaigns, emailEvents, jobs, outreachDrafts } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { emailDomain, normalizeAddress } from "@/lib/email/address";
import { newId, nowIso } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { getSettings, missingSenderDetails, type AppSettings } from "@/lib/settings";
import { openCampaign, type Campaign } from "./campaigns";
import { contactBlockers } from "./eligibility";

export type Draft = typeof outreachDrafts.$inferSelect;
type Business = typeof businesses.$inferSelect;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface SendPlanOptions {
  dailyCap: number;
  spacingSeconds: number;
  /** Local hours between which sending may happen; equal values = any time. */
  windowStart: number;
  windowEnd: number;
  /** Emails already sent or queued, per local day (dayKey). */
  usedByDay?: Record<string, number>;
  /** Multiplier on the spacing for send i (default: random 0.75-1.25, so sends do not tick like a machine). */
  jitter?: (i: number) => number;
}

/** When each of `n` emails goes out: paced, inside the sending hours, never more than the daily cap on any day. */
export function planSendTimes(now: Date, n: number, o: SendPlanOptions): Date[] {
  const used: Record<string, number> = { ...(o.usedByDay ?? {}) };
  const windowed = o.windowEnd > o.windowStart;
  const startOfDay = (d: Date, addDays: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDays, windowed ? o.windowStart : 0, 0, 0, 0);
  const out: Date[] = [];
  let t = new Date(now);
  for (let i = 0; i < n; i++) {
    for (let guard = 0; guard < 400; guard++) {
      if (windowed && t.getHours() < o.windowStart) t = startOfDay(t, 0);
      else if (windowed && t.getHours() >= o.windowEnd) t = startOfDay(t, 1);
      else if ((used[dayKey(t)] ?? 0) >= o.dailyCap) t = startOfDay(t, 1);
      else break;
    }
    out.push(new Date(t));
    used[dayKey(t)] = (used[dayKey(t)] ?? 0) + 1;
    t = new Date(t.getTime() + Math.round(o.spacingSeconds * 1000 * (o.jitter ? o.jitter(i) : 0.75 + Math.random() * 0.5)));
  }
  return out;
}

/** Emails already sent or queued per local day, from today on. */
export async function usedByDay(now = new Date()): Promise<Record<string, number>> {
  const db = await getDb();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const rows = await db
    .select({ status: outreachDrafts.status, sentAt: outreachDrafts.sentAt, scheduledAt: outreachDrafts.scheduledAt })
    .from(outreachDrafts)
    .where(and(inArray(outreachDrafts.status, ["sent", "bounced", "queued", "sending"]), sql`coalesce(${outreachDrafts.sentAt}, ${outreachDrafts.scheduledAt}) >= ${since}`))
    .all();
  const out: Record<string, number> = {};
  for (const r of rows) {
    const at = r.sentAt ?? r.scheduledAt;
    if (at) out[dayKey(new Date(at))] = (out[dayKey(new Date(at))] ?? 0) + 1;
  }
  return out;
}

export function makeMessageId(fromAddress: string): string {
  return `<${randomUUID()}@${emailDomain(fromAddress) || "localhost"}>`;
}

export interface Preflight {
  campaign: Campaign;
  mailbox: { ok: boolean; reason: string | null; address: string | null };
  /** What the sender still has to fill in under Settings. */
  senderMissing: string[];
  sendable: { draft: Draft; business: Business }[];
  /** Approved emails that will NOT go out, with the reason. */
  blocked: { draft: Draft; business: Business; reasons: string[] }[];
  counts: { approved: number; ready: number; needsReview: number; excluded: number };
  /** When the sendable emails would go out if sent now. */
  plan: { firstAt: string; lastAt: string; perDay: [string, number][] } | null;
  canSend: boolean;
  /** Why nothing can be sent, in one sentence; null when sending is possible. */
  problem: string | null;
}

/** Everything "Send approved" would do, without doing it. The same function decides what is actually queued. */
export async function sendPreflight(campaignId: string, now = new Date()): Promise<Preflight | null> {
  const db = await getDb();
  const campaign = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!campaign) return null;
  const cfg = getConfig();
  const settings = await getSettings();
  const rows = await db.select({ draft: outreachDrafts, business: businesses }).from(outreachDrafts).innerJoin(businesses, eq(businesses.id, outreachDrafts.businessId)).where(and(eq(outreachDrafts.campaignId, campaignId), inArray(outreachDrafts.status, ["needs_review", "ready", "approved", "excluded"]))).orderBy(outreachDrafts.createdAt).all();
  const counts = { approved: 0, ready: 0, needsReview: 0, excluded: 0 };
  const sendable: Preflight["sendable"] = [];
  const blocked: Preflight["blocked"] = [];
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.draft.status === "ready") counts.ready++;
    else if (r.draft.status === "needs_review") counts.needsReview++;
    else if (r.draft.status === "excluded") counts.excluded++;
    if (r.draft.status !== "approved") continue;
    counts.approved++;
    const reasons = await contactBlockers(r.business, settings);
    const email = normalizeAddress(r.business.email);
    if (email && seen.has(email)) reasons.push(`${email} is already a recipient in this batch (${seen.get(email)}).`);
    if (!r.draft.body.trim() || !(r.draft.subject ?? "").trim()) reasons.push("The email has no subject or no text.");
    if (r.draft.validation && !r.draft.validation.passed && !r.draft.validation.overridden) reasons.push("The email has not passed its checks.");
    if (reasons.length) blocked.push({ ...r, reasons });
    else {
      sendable.push(r);
      if (email) seen.set(email, r.business.name);
    }
  }
  const senderMissing = missingSenderDetails(settings);
  const mailbox = { ok: cfg.mail.enabled, reason: cfg.mail.reason, address: cfg.mail.address };
  let plan: Preflight["plan"] = null;
  if (sendable.length) {
    const times = planSendTimes(now, sendable.length, { ...planOptions(settings), usedByDay: await usedByDay(now), jitter: () => 1 });
    const perDay = new Map<string, number>();
    for (const t of times) perDay.set(dayKey(t), (perDay.get(dayKey(t)) ?? 0) + 1);
    plan = { firstAt: times[0].toISOString(), lastAt: times[times.length - 1].toISOString(), perDay: [...perDay.entries()] };
  }
  const problem = campaign.status !== "open" ? "This batch was already sent." : !mailbox.ok ? (mailbox.reason ?? "No mailbox is connected.") : senderMissing.length ? `Before sending, add ${senderMissing.join(", ")} under Settings.` : !sendable.length ? (counts.approved ? "None of the approved emails can be sent (see the reasons below)." : "No email is approved yet.") : null;
  return { campaign, mailbox, senderMissing, sendable, blocked, counts, plan, canSend: problem === null, problem };
}

const planOptions = (s: AppSettings) => ({ dailyCap: s.dailySendCap, spacingSeconds: s.sendSpacingSeconds, windowStart: s.sendWindowStart, windowEnd: s.sendWindowEnd });

/** Queues every sendable approved email of the batch at its planned time and closes the batch. Safe to call twice. */
export async function sendCampaign(campaignId: string, now = new Date()): Promise<{ ok: boolean; error?: string; queued: number; skipped: number; firstAt?: string; lastAt?: string }> {
  const pre = await sendPreflight(campaignId, now);
  if (!pre) return { ok: false, error: "Batch not found", queued: 0, skipped: 0 };
  if (!pre.canSend) return { ok: false, error: pre.problem ?? "Nothing to send", queued: 0, skipped: pre.blocked.length };
  const db = await getDb();
  const settings = await getSettings();
  const times = planSendTimes(now, pre.sendable.length, { ...planOptions(settings), usedByDay: await usedByDay(now) });
  let queued = 0;
  for (const [i, { draft, business }] of pre.sendable.entries()) {
    const at = times[i];
    const messageId = draft.messageId ?? makeMessageId(pre.mailbox.address!);
    // Claim approved → queued in one statement: a second click (or a second tab) finds nothing left to queue.
    const claimed = await db.update(outreachDrafts).set({ status: "queued", scheduledAt: at.toISOString(), messageId, toEmail: normalizeAddress(business.email), lastError: null, updatedAt: nowIso() }).where(and(eq(outreachDrafts.id, draft.id), eq(outreachDrafts.status, "approved"))).run();
    if (!claimed.rowsAffected) continue;
    await db.insert(emailEvents).values({ id: newId(), draftId: draft.id, businessId: business.id, type: "queued", detail: { scheduledAt: at.toISOString(), to: business.email } }).run();
    await enqueueJob("send_email", { draftId: draft.id }, { idempotencyKey: `send:${draft.id}`, delayMs: Math.max(0, at.getTime() - Date.now()), maxAttempts: 4 });
    queued++;
  }
  if (queued) {
    await db.update(campaigns).set({ status: "sending", sentAt: nowIso() }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "open"))).run();
    await carryOverUnsent(campaignId);
  }
  return { ok: true, queued, skipped: pre.blocked.length, firstAt: times[0]?.toISOString(), lastAt: times[times.length - 1]?.toISOString() };
}

/** Emails of a closed batch that were not sent (not approved, excluded, blocked) move on to the open batch. */
async function carryOverUnsent(campaignId: string) {
  const db = await getDb();
  const left = await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.campaignId, campaignId), inArray(outreachDrafts.status, ["needs_review", "ready", "approved", "excluded"]))).all();
  if (!left.length) return;
  const next = await openCampaign();
  await db.update(outreachDrafts).set({ campaignId: next.id }).where(inArray(outreachDrafts.id, left.map((d) => d.id))).run();
}

/** A batch is done when nothing of it is queued or being sent any more. */
export async function closeCampaignIfDone(campaignId: string | null) {
  if (!campaignId) return;
  const db = await getDb();
  const pending = await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.campaignId, campaignId), inArray(outreachDrafts.status, ["queued", "sending"]))).limit(1).get();
  if (pending) return;
  await db.update(campaigns).set({ status: "sent" }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "sending"))).run();
}

/** Stops what has not gone out yet: queued emails return to "approved" in the open batch. Emails already sent stay sent. */
export async function cancelQueued(campaignId: string): Promise<number> {
  const db = await getDb();
  const queued = await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.campaignId, campaignId), eq(outreachDrafts.status, "queued"))).all();
  let n = 0;
  for (const d of queued) {
    const res = await db.update(outreachDrafts).set({ status: "approved", scheduledAt: null, updatedAt: nowIso() }).where(and(eq(outreachDrafts.id, d.id), eq(outreachDrafts.status, "queued"))).run();
    if (!res.rowsAffected) continue;
    await db.update(jobs).set({ status: "cancelled", finishedAt: nowIso() }).where(and(eq(jobs.type, "send_email"), eq(jobs.status, "queued"), sql`json_extract(${jobs.payload}, '$.draftId') = ${d.id}`)).run();
    await db.insert(emailEvents).values({ id: newId(), draftId: d.id, businessId: d.businessId, type: "cancelled", detail: { by: "operator" } }).run();
    n++;
  }
  await carryOverUnsent(campaignId);
  await closeCampaignIfDone(campaignId);
  return n;
}

/** Try a failed email again, now. The operator does this after checking that it is not already in their Sent folder. */
export async function retryFailed(draftId: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.update(outreachDrafts).set({ status: "queued", scheduledAt: nowIso(), lastError: null, updatedAt: nowIso() }).where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.status, "failed"), isNotNull(outreachDrafts.messageId))).returning().get();
  if (!res) return false;
  await db.insert(emailEvents).values({ id: newId(), draftId, businessId: res.businessId, type: "queued", detail: { retry: true } }).run();
  await enqueueJob("send_email", { draftId }, { idempotencyKey: `send:${draftId}`, maxAttempts: 4 });
  return true;
}

/** Emails sent today (local day): the number the daily cap is compared with. */
export async function sentToday(now = new Date()): Promise<number> {
  const db = await getDb();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const row = await db.select({ n: sql<number>`count(*)` }).from(outreachDrafts).where(and(inArray(outreachDrafts.status, ["sent", "bounced"]), gte(outreachDrafts.sentAt, since))).get();
  return Number(row?.n ?? 0);
}
