/**
 * Nothing is forgotten: every business that is in play has a next action, and
 * the app plans it from where the business stands. The rules are one pure
 * function (`plannedAction`), so what is planned can be read and tested in one
 * place; `planFollowUps` applies it to the whole workspace.
 *
 * `prospects.updated_at` is left alone: it says when the operator last moved the business, and planning is not that.
 *
 * What the app never does here:
 *  - replace an action the operator planned themselves (`next_action_key` is null);
 *  - plan again the action the operator just ticked off (`next_action_done`);
 *  - move a date the operator pushed back (an action whose key is unchanged is left alone).
 */
import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, inboundEmails, outreachDrafts, prospects } from "@/db/schema";
import { stepNoun, STEP } from "@/lib/outreach/steps";
import { getSettings, type AppSettings } from "@/lib/settings";
import { workspaceId } from "@/lib/workspace";

export interface FollowUpState {
  stage: string;
  /** Research status and outcome of the business. */
  status: string;
  verdict: string | null;
  /** Emails that are not archived: which step, where they stand, when they went out. */
  drafts: { id: string; step: number; status: string; sentAt: string | null }[];
  /** The newest reply nobody has answered or ticked off yet, if any. */
  openReply: { id: string; receivedAt: string } | null;
  /** The newest reply of any kind (for a conversation that is already going). */
  lastReplyId: string | null;
}

export interface PlannedAction {
  /** Identifies the rule and what it is about; the same key is never planned twice in a row. */
  key: string;
  text: string;
  at: Date;
}

/** `days` working days (Mon-Fri) after `from`. */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}

const inDays = (now: Date, days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 9, 0, 0, 0);

/** The next action the app would plan for a business in this state, or null when nothing is due from anyone. */
export function plannedAction(s: FollowUpState, settings: Pick<AppSettings, "followUpDays" | "followUpCount">, now = new Date()): PlannedAction | null {
  if (s.stage === "won" || s.stage === "lost") return null;

  // 1. Someone wrote back: that comes before everything else.
  if (s.openReply) return { key: `reply:${s.openReply.id}`, text: "Read and answer their reply", at: new Date(s.openReply.receivedAt) };

  // 2. An email is waiting for a decision (the earliest step first).
  const waiting = [...s.drafts].sort((a, b) => a.step - b.step);
  const failed = waiting.find((d) => d.status === "failed");
  if (failed) return { key: `send_failed:${failed.id}`, text: `The ${stepNoun(failed.step)} was not sent: retry it or check your mailbox`, at: now };
  const fix = waiting.find((d) => d.status === "needs_review");
  if (fix) return { key: `fix:${fix.id}`, text: fix.step === STEP.answer ? "Check the answer to their reply and send it" : `Check the ${stepNoun(fix.step)}: something in it needs your eye`, at: now };
  const review = waiting.find((d) => d.status === "ready");
  if (review) return { key: `review:${review.id}`, text: `Review and approve the ${stepNoun(review.step)}`, at: now };
  const approved = waiting.find((d) => d.status === "approved");
  if (approved) return { key: `send:${approved.id}`, text: `Send the approved ${stepNoun(approved.step)}`, at: now };
  if (waiting.some((d) => d.status === "queued" || d.status === "sending")) return null; // on its way: nothing to do

  // 2b. The first email bounced and nothing else is on its way: the business was never reached.
  const bounced = waiting.find((d) => d.status === "bounced" && d.step === STEP.first);
  if (bounced && !waiting.some((d) => d.status === "sent")) return { key: `bounced:${bounced.id}`, text: "The email bounced: find another address or set the business aside", at: now };

  // 3. Stages the operator sets by hand: a check-in so a conversation does not go quiet.
  if (s.stage === "meeting_scheduled") return { key: "stage:meeting_scheduled", text: "After the meeting: note what was said and move the stage", at: inDays(now, 2) };
  if (s.stage === "proposal_sent") return { key: "stage:proposal_sent", text: "Follow up on the proposal", at: inDays(now, 3) };
  if (s.stage === "replied") return { key: `stage:replied:${s.lastReplyId ?? "none"}`, text: "Keep the conversation going: check in with them", at: inDays(now, 3) };

  // 4. Emailed and waiting: say when the next email of the sequence is due, and what is left to do after the last one.
  const sent = s.drafts.filter((d) => d.status === "sent" && d.sentAt && d.step <= STEP.lastNote).sort((a, b) => b.step - a.step);
  if (s.stage === "contacted" && sent.length) {
    const last = sent[0];
    const due = addWorkingDays(new Date(last.sentAt!), Math.max(1, settings.followUpDays || 5));
    if (settings.followUpDays > 0 && last.step < settings.followUpCount) return { key: `wait:${last.step}`, text: `No reply yet: the ${stepNoun(last.step + 1)} is written on this day`, at: due };
    return { key: `closeout:${last.step}`, text: "No answer to the last email: call them or close as lost", at: due };
  }

  // 5. Before any email: research that needs a person.
  if (s.status === "failed") return { key: "research_failed", text: "Research failed: try it again or remove the business", at: now };
  if (s.status === "no_website") return { key: "no_website", text: "No website was found: add it or remove the business", at: now };
  if (s.verdict === "needs_review" || s.verdict === "insufficient_evidence") return { key: `decide:${s.verdict}`, text: "Decide: qualify it yourself or set it aside", at: now };
  if (s.verdict === "no_contact") return { key: "no_contact", text: "No email address was found: add one or set it aside", at: now };
  return null;
}

export interface FollowUpRun {
  planned: number;
  cleared: number;
}

/** Brings the planned next action of every business of the acting workspace in line with where it stands. Cheap: a few queries, then only the rows that change. */
export async function planFollowUps(now = new Date()): Promise<FollowUpRun> {
  const out: FollowUpRun = { planned: 0, cleared: 0 };
  const db = await getDb();
  const ws = await workspaceId();
  const settings = await getSettings();
  const rows = await db
    .select({ id: businesses.id, status: businesses.status, verdict: businesses.verdict, stage: prospects.stage, action: prospects.nextAction, key: prospects.nextActionKey, done: prospects.nextActionDone })
    .from(prospects)
    .innerJoin(businesses, eq(businesses.id, prospects.businessId))
    // A business that was only found and never touched has nothing to follow up: it waits in the list with the others.
    .where(and(eq(businesses.workspaceId, ws), sql`not (${prospects.stage} in ('discovered', 'researching') and ${businesses.status} in ('new', 'queued', 'investigating') and ${prospects.nextAction} is null)`))
    .all();
  if (!rows.length) return out;
  const mine = db.select({ id: businesses.id }).from(businesses).where(eq(businesses.workspaceId, ws));
  const [draftRows, replyRows] = await Promise.all([
    db.select({ id: outreachDrafts.id, businessId: outreachDrafts.businessId, step: outreachDrafts.step, status: outreachDrafts.status, sentAt: outreachDrafts.sentAt }).from(outreachDrafts).where(and(inArray(outreachDrafts.businessId, mine), notInArray(outreachDrafts.status, ["archived", "excluded"]))).all(),
    db.select({ id: inboundEmails.id, businessId: inboundEmails.businessId, receivedAt: inboundEmails.receivedAt, handledAt: inboundEmails.handledAt }).from(inboundEmails).where(and(inArray(inboundEmails.businessId, mine), eq(inboundEmails.kind, "reply"))).orderBy(inboundEmails.receivedAt).all(),
  ]);
  const drafts = new Map<string, FollowUpState["drafts"]>();
  for (const d of draftRows) drafts.set(d.businessId, [...(drafts.get(d.businessId) ?? []), d]);
  const open = new Map<string, { id: string; receivedAt: string }>();
  const lastReply = new Map<string, string>();
  for (const r of replyRows) {
    lastReply.set(r.businessId, r.id); // ordered by time: the last one wins
    if (!r.handledAt) open.set(r.businessId, { id: r.id, receivedAt: r.receivedAt });
  }
  for (const r of rows) {
    if (r.action && !r.key) continue; // the operator's own plan: never touched
    const want = plannedAction({ stage: r.stage, status: r.status, verdict: r.verdict, drafts: drafts.get(r.id) ?? [], openReply: open.get(r.id) ?? null, lastReplyId: lastReply.get(r.id) ?? null }, settings, now);
    if (want && r.key === want.key && r.action) continue; // already planned (and possibly pushed back by the operator)
    if (want && want.key !== r.done) {
      await db.update(prospects).set({ nextAction: want.text, nextActionAt: want.at.toISOString(), nextActionKey: want.key }).where(and(eq(prospects.businessId, r.id), r.key ? eq(prospects.nextActionKey, r.key) : isNull(prospects.nextActionKey))).run();
      out.planned++;
    } else if (r.action && r.key) {
      // What was planned no longer applies (the email was sent, the reply answered, the stage moved on).
      await db.update(prospects).set({ nextAction: null, nextActionAt: null, nextActionKey: null }).where(and(eq(prospects.businessId, r.id), eq(prospects.nextActionKey, r.key))).run();
      out.cleared++;
    }
  }
  return out;
}

/** Marks the planned action of a business as done by the operator, so the same one is not planned again. */
export async function rememberDone(businessId: string): Promise<void> {
  const db = await getDb();
  await db.update(prospects).set({ nextActionDone: sql`${prospects.nextActionKey}`, nextActionKey: null }).where(and(eq(prospects.businessId, businessId), ne(prospects.nextActionKey, ""))).run();
}
