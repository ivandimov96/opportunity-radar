/**
 * The scheduler: what the app does on its own, once a minute, inside the worker.
 *  - reads the inbox every few minutes while there is sent mail to watch;
 *  - writes the follow-up and the last note for a first email that went unanswered, and one
 *    check-back for someone who answered "not now";
 *  - writes the email for qualified businesses that do not have one yet;
 *  - researches saved businesses, best leads first, while few emails are waiting for review;
 *  - starts a search from the operator's targets when few businesses are left to research;
 *  - passes ready emails on for sending once their waiting time is over.
 * The last two are off until the operator switches them on in Settings: by default
 * it never sends anything and never starts a search.
 * Every step is bounded by the budgets in Settings and by the monthly spend guards.
 * It looks across all workspaces (the budgets are still shared) and queues each job as
 * the workspace of the business it is for, so the handler runs where the business lives.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { FIRST_WORKSPACE_ID, businesses, inboundEmails, investigations, jobs, outreachDrafts, prospects } from "@/db/schema";
import { AUTO_SEARCH_CREDITS, autoSearchesToday, startAutoSearch } from "@/lib/discovery/auto-search";
import { usageTotal } from "@/lib/discovery/usage";
import { runAutopilot } from "@/lib/outreach/autopilot";
import { planFollowUps } from "@/lib/pipeline/follow-up";
import { SEQUENCE_STEPS, STEP } from "@/lib/outreach/steps";
import { getConfig } from "@/lib/config";
import { isFirecrawlConfigured } from "@/lib/research/firecrawl";
import { contactBlockers } from "@/lib/outreach/eligibility";
import { getSettings, getState, searchTargetsOf, setState } from "@/lib/settings";
import { enqueueOutreach, maybeAutoDraft, tryInvestigation } from "./handlers";
import { enqueueJob } from "./queue";
import { syncMailboxKey, workspacesWithMailbox } from "@/lib/mail";
import { businessIdsOf, runInWorkspace } from "@/lib/workspace";

export const SYNC_EVERY_MS = 5 * 60_000;
const PER_TICK = 3;

/** Working days (Mon-Fri) that have fully passed between two moments. */
export function businessDaysBetween(from: Date, to: Date): number {
  let n = 0;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (d < end) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6 && d <= end) n++;
  }
  return n;
}

/** A job of this kind failed in the last day: do not queue it again automatically (it would fail, or spend, in a loop). */
async function failedRecently(idempotencyKey: string): Promise<boolean> {
  const db = await getDb();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  return Boolean(await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.idempotencyKey, idempotencyKey), eq(jobs.status, "failed"), gte(jobs.finishedAt, since))).get());
}

/** Fewer businesses than this waiting for research, and a new search is due. */
export const AUTO_SEARCH_LOW_STOCK = 5;

export interface SchedulerResult {
  sync: boolean;
  /** Follow-ups and last notes queued for writing. */
  followUps: number;
  checkBacks: number;
  /** The name of the search the app started on its own, if it did. */
  search: string | null;
  autopilot: { approved: number; queued: number };
  drafts: number;
  research: number;
}

export async function runScheduler(now = new Date()): Promise<SchedulerResult> {
  const out: SchedulerResult = { sync: false, followUps: 0, checkBacks: 0, search: null, autopilot: { approved: 0, queued: 0 }, drafts: 0, research: 0 };
  const cfg = getConfig();
  const db = await getDb();
  const settings = await getSettings();

  // 1. Inbox: for every workspace with a mailbox of its own, and only while it has sent mail a reply could belong to.
  const withMailbox = await workspacesWithMailbox();
  for (const ws of withMailbox) {
    await runInWorkspace(ws, async () => {
      const last = await getState<{ at: string }>("mail.syncQueued");
      if (last && now.getTime() - new Date(last.at).getTime() < SYNC_EVERY_MS) return;
      const watching = await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(inArray(outreachDrafts.businessId, businessIdsOf(db, ws)), inArray(outreachDrafts.status, ["sent", "bounced"]), gte(outreachDrafts.sentAt, new Date(now.getTime() - 90 * 86_400_000).toISOString()))).limit(1).get();
      if (!watching) return;
      await enqueueJob("sync_mailbox", {}, { idempotencyKey: syncMailboxKey(ws), maxAttempts: 1 });
      await setState("mail.syncQueued", { at: now.toISOString() });
      out.sync = true;
    });
  }

  if (cfg.ai.enabled) {
    // 2. The sequence after an unanswered first email: a follow-up, then a last note, each after the configured working days.
    if (settings.followUpDays > 0 && settings.followUpCount > 0) {
      const cutoff = new Date(now.getTime() - settings.followUpDays * 86_400_000).toISOString();
      for (const [i, step] of SEQUENCE_STEPS.slice(0, settings.followUpCount).entries()) {
        const previous = i === 0 ? STEP.first : SEQUENCE_STEPS[i - 1];
        const candidates = await db
          .select({ businessId: outreachDrafts.businessId, sentAt: outreachDrafts.sentAt })
          .from(outreachDrafts)
          .innerJoin(prospects, eq(prospects.businessId, outreachDrafts.businessId))
          // An out-of-office reply postpones the next email (prospects.hold_until).
          .where(and(eq(outreachDrafts.step, previous), eq(outreachDrafts.status, "sent"), lte(outreachDrafts.sentAt, cutoff), eq(prospects.stage, "contacted"), or(isNull(prospects.holdUntil), lte(prospects.holdUntil, now.toISOString()))))
          .orderBy(outreachDrafts.sentAt)
          .limit(40)
          .all();
        for (const c of candidates) {
          if (out.followUps >= PER_TICK) break;
          if (businessDaysBetween(new Date(c.sentAt!), now) < settings.followUpDays) continue;
          if (await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.businessId, c.businessId), eq(outreachDrafts.step, step), ne(outreachDrafts.status, "archived"))).limit(1).get()) continue;
          if (await db.select({ id: inboundEmails.id }).from(inboundEmails).where(and(eq(inboundEmails.businessId, c.businessId), inArray(inboundEmails.kind, ["reply", "bounce"]))).limit(1).get()) continue;
          const biz = await db.select().from(businesses).where(eq(businesses.id, c.businessId)).get();
          // Checked as the business's own workspace: "already emailed" only counts that workspace's emails.
          if (!biz || (await runInWorkspace(biz.workspaceId, () => contactBlockers(biz, settings))).length) continue;
          if (await failedRecently(`outreach:${c.businessId}:${step}`)) continue;
          const { created } = await runInWorkspace(biz.workspaceId, () => enqueueOutreach(c.businessId, { step }));
          if (created) out.followUps++;
        }
      }
    }

    // 2b. One check-back for everyone who answered "not now", when its day has come (set when the reply was read).
    if (settings.recontactDays > 0) {
      const due = await db.select({ businessId: prospects.businessId }).from(prospects).where(and(isNotNull(prospects.recontactAt), lte(prospects.recontactAt, now.toISOString()), eq(prospects.stage, "replied"))).limit(20).all();
      for (const d of due) {
        if (out.checkBacks >= PER_TICK) break;
        if (await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.businessId, d.businessId), eq(outreachDrafts.step, STEP.checkBack), ne(outreachDrafts.status, "archived"))).limit(1).get()) continue;
        const biz = await db.select().from(businesses).where(eq(businesses.id, d.businessId)).get();
        if (!biz || (await runInWorkspace(biz.workspaceId, () => contactBlockers(biz, settings))).length) continue;
        if (await failedRecently(`outreach:${d.businessId}:${STEP.checkBack}`)) continue;
        const { created } = await runInWorkspace(biz.workspaceId, () => enqueueOutreach(d.businessId, { step: STEP.checkBack }));
        if (created) out.checkBacks++;
      }
    }

    // 3. Qualified businesses that have no email yet (qualified by hand, or while the budget was used up).
    if (settings.autoDraft) {
      const withDraft = db.select({ id: outreachDrafts.businessId }).from(outreachDrafts).where(and(eq(outreachDrafts.step, 0), ne(outreachDrafts.status, "archived")));
      const pending = await db
        .select({ id: businesses.id, workspaceId: businesses.workspaceId })
        .from(businesses)
        .innerJoin(prospects, eq(prospects.businessId, businesses.id))
        .where(and(eq(businesses.verdict, "qualified"), eq(businesses.status, "profiled"), isNotNull(businesses.email), eq(prospects.stage, "qualified"), notInArray(businesses.id, withDraft)))
        .orderBy(desc(businesses.priority))
        .limit(10)
        .all();
      for (const b of pending) {
        if (out.drafts >= PER_TICK) break;
        if (await failedRecently(`outreach:${b.id}:0`)) continue;
        if (await runInWorkspace(b.workspaceId, () => maybeAutoDraft(b.id))) out.drafts++;
      }
    }
  }

  // 4. Research on its own, best leads first, while the review queue is short and today's allowance is not used up.
  if (settings.autoResearch && settings.researchPerDay > 0 && isFirecrawlConfigured()) {
    const waiting = Number((await db.select({ n: sql<number>`count(*)` }).from(outreachDrafts).where(inArray(outreachDrafts.status, ["ready", "approved"])).get())?.n ?? 0);
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const today = Number((await db.select({ n: sql<number>`count(*)` }).from(investigations).where(gte(investigations.startedAt, midnight)).get())?.n ?? 0);
    const inFlight = Number((await db.select({ n: sql<number>`count(*)` }).from(jobs).where(and(eq(jobs.type, "investigate_business"), inArray(jobs.status, ["queued", "running"]))).get())?.n ?? 0);
    const room = Math.min(PER_TICK - inFlight, settings.researchPerDay - today - inFlight);
    if (waiting < settings.readyBuffer && room > 0) {
      const next = await db
        .select({ id: businesses.id, workspaceId: businesses.workspaceId })
        .from(businesses)
        .where(and(eq(businesses.status, "new"), isNotNull(businesses.website), ne(businesses.kind, "chain"), isNull(businesses.investigatedAt)))
        .orderBy(desc(businesses.leadScore))
        .limit(room)
        .all();
      for (const b of next) {
        if (await failedRecently(`investigate:${b.id}`)) continue;
        // A workspace whose plan is used up for the month is skipped, quietly: its owner sees why under Settings.
        if (await runInWorkspace(b.workspaceId, () => tryInvestigation(b.id))) continue;
        out.research++;
      }
    }
  }

  // 4b. Follow-up: every business in play gets (or keeps) its next action; costs nothing and sends nothing.
  await runInWorkspace(FIRST_WORKSPACE_ID, () => planFollowUps(now)).catch((err) => console.warn("[scheduler] follow-up planning failed", err));

  // 5. Finding businesses on its own: one search when the stock waiting for research runs low (Settings → Automation).
  const targets = searchTargetsOf(settings);
  if (settings.autoSearch && targets.length && cfg.googleMaps.enabled) {
    await runInWorkspace(FIRST_WORKSPACE_ID, async () => {
      const stock = Number((await db.select({ n: sql<number>`count(*)` }).from(businesses).where(and(eq(businesses.workspaceId, FIRST_WORKSPACE_ID), eq(businesses.status, "new"), isNotNull(businesses.website), ne(businesses.kind, "chain"), isNull(businesses.investigatedAt))).get())?.n ?? 0);
      const waiting = Number((await db.select({ n: sql<number>`count(*)` }).from(outreachDrafts).where(inArray(outreachDrafts.status, ["ready", "approved"])).get())?.n ?? 0);
      const searching = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.type, "discover_search"), inArray(jobs.status, ["queued", "running"]))).limit(1).get();
      if (searching || stock >= Math.max(AUTO_SEARCH_LOW_STOCK, settings.researchPerDay) || waiting >= settings.readyBuffer) return;
      if ((await autoSearchesToday(now)) >= settings.searchesPerDay) return;
      // The search credits do not renew: the last ones are left for searches the operator starts.
      if ((await usageTotal("serper")) + AUTO_SEARCH_CREDITS > cfg.SERPER_CREDIT_BUDGET) return;
      const started = await startAutoSearch(targets);
      if (started) out.search = started.name;
    });
  }

  // 6. Sending on its own, when the operator chose it: the ready emails whose waiting time is over (see outreach/autopilot.ts).
  // Each workspace decides for itself (its own setting, mailbox, limits and safety pause).
  for (const ws of withMailbox) {
    const run = await runInWorkspace(ws, () => runAutopilot(now));
    out.autopilot = { approved: out.autopilot.approved + run.approved, queued: out.autopilot.queued + run.queued };
  }
  return out;
}
