/**
 * The scheduler: what the app does on its own, once a minute, inside the worker.
 *  - reads the inbox every few minutes while there is sent mail to watch;
 *  - writes one follow-up for a first email that went unanswered (it still waits for approval);
 *  - writes the email for qualified businesses that do not have one yet;
 *  - researches saved businesses, best leads first, while few emails are waiting for review.
 * It never sends anything and never starts a search: those stay the operator's.
 * Every step is bounded by the budgets in Settings and by the monthly spend guards.
 * It looks across all workspaces (the budgets are still shared) and queues each job as
 * the workspace of the business it is for, so the handler runs where the business lives.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, inboundEmails, investigations, jobs, outreachDrafts, prospects } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { isFirecrawlConfigured } from "@/lib/research/firecrawl";
import { contactBlockers } from "@/lib/outreach/eligibility";
import { getSettings, getState, setState } from "@/lib/settings";
import { enqueueInvestigation, enqueueOutreach, maybeAutoDraft } from "./handlers";
import { enqueueJob } from "./queue";
import { MAILBOX_WORKSPACE_ID, syncMailboxKey } from "@/lib/mail";
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

export interface SchedulerResult {
  sync: boolean;
  followUps: number;
  drafts: number;
  research: number;
}

export async function runScheduler(now = new Date()): Promise<SchedulerResult> {
  const out: SchedulerResult = { sync: false, followUps: 0, drafts: 0, research: 0 };
  const cfg = getConfig();
  const db = await getDb();
  const settings = await getSettings();

  // 1. Inbox: only while there is sent mail a reply could belong to. One mailbox, so one workspace: the one it belongs to.
  if (cfg.mail.enabled) {
    const last = await getState<{ at: string }>("mail.syncQueued");
    const due = !last || now.getTime() - new Date(last.at).getTime() >= SYNC_EVERY_MS;
    const watching = due ? await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(inArray(outreachDrafts.businessId, businessIdsOf(db, MAILBOX_WORKSPACE_ID)), inArray(outreachDrafts.status, ["sent", "bounced"]), gte(outreachDrafts.sentAt, new Date(now.getTime() - 90 * 86_400_000).toISOString()))).limit(1).get() : null;
    if (watching) {
      await runInWorkspace(MAILBOX_WORKSPACE_ID, () => enqueueJob("sync_mailbox", {}, { idempotencyKey: syncMailboxKey(MAILBOX_WORKSPACE_ID), maxAttempts: 1 }));
      await setState("mail.syncQueued", { at: now.toISOString() });
      out.sync = true;
    }
  }

  if (cfg.ai.enabled) {
    // 2. One follow-up per unanswered first email, after the configured number of working days.
    if (settings.followUpDays > 0) {
      const cutoff = new Date(now.getTime() - settings.followUpDays * 86_400_000).toISOString();
      const candidates = await db
        .select({ businessId: outreachDrafts.businessId, sentAt: outreachDrafts.sentAt })
        .from(outreachDrafts)
        .innerJoin(prospects, eq(prospects.businessId, outreachDrafts.businessId))
        .where(and(eq(outreachDrafts.step, 0), eq(outreachDrafts.status, "sent"), lte(outreachDrafts.sentAt, cutoff), eq(prospects.stage, "contacted")))
        .orderBy(outreachDrafts.sentAt)
        .limit(40)
        .all();
      for (const c of candidates) {
        if (out.followUps >= PER_TICK) break;
        if (businessDaysBetween(new Date(c.sentAt!), now) < settings.followUpDays) continue;
        if (await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.businessId, c.businessId), eq(outreachDrafts.step, 1), ne(outreachDrafts.status, "archived"))).limit(1).get()) continue;
        if (await db.select({ id: inboundEmails.id }).from(inboundEmails).where(and(eq(inboundEmails.businessId, c.businessId), inArray(inboundEmails.kind, ["reply", "bounce"]))).limit(1).get()) continue;
        const biz = await db.select().from(businesses).where(eq(businesses.id, c.businessId)).get();
        // Checked as the business's own workspace: "already emailed" only counts that workspace's emails.
        if (!biz || (await runInWorkspace(biz.workspaceId, () => contactBlockers(biz, settings))).length) continue;
        if (await failedRecently(`outreach:${c.businessId}:1`)) continue;
        const { created } = await runInWorkspace(biz.workspaceId, () => enqueueOutreach(c.businessId, { step: 1 }));
        if (created) out.followUps++;
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
        await runInWorkspace(b.workspaceId, () => enqueueInvestigation(b.id));
        out.research++;
      }
    }
  }
  return out;
}
