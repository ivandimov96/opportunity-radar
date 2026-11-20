/**
 * Answers to replies. When a reply has been read and an answer makes sense,
 * the answer becomes an email of its own in the open batch (step 9), in the
 * same thread, addressed to the person who wrote. From there it takes the same
 * road as every other email: review, approve, send, or the autopilot.
 *
 * Two kinds of answer never go out on their own, whatever the mode:
 *  - the ones only the operator can give ("yes, send it": the thing offered has
 *    to be made; a question: the app does not know prices, dates or past work);
 *  - the ones the app is not sure about (a doubtful reading, a reply matched by
 *    its sender address only, a third answer in the same conversation).
 * They are written all the same and wait under Outreach as "needs review".
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { inboundEmails, outreachDrafts, type DraftIssue, type DraftValidation } from "@/db/schema";
import type { ReplyCategory } from "@/lib/ai/schemas";
import { newId, nowIso } from "@/lib/ids";
import { logActivity } from "@/lib/pipeline/prospects";
import { getSettings } from "@/lib/settings";
import { openCampaign } from "./campaigns";
import { REVIEW_STATUSES } from "./drafts";
import { sendBlockers } from "./eligibility";
import { STEP } from "./steps";
import { checkAnswerText, hasBlock } from "./validate";

type Inbound = typeof inboundEmails.$inferSelect;

export const ANSWER_PROMPT_VERSION = "reply-2";
/** Below this the reading of the reply is not trusted enough to answer on its own. */
export const ANSWER_MIN_CONFIDENCE = 0.8;
/** Answers sent in one conversation before a person has to look. */
export const ANSWER_MAX_AUTOMATIC = 2;

/** Replies whose answer only the operator can give, with the reason shown beside the email. */
const ONLY_YOU: Partial<Record<ReplyCategory, string>> = {
  interested: "They said yes. Send what you offered, or say when it will come: only you can do that.",
  wants_info: "They asked a question. Check the answer before it goes: the app does not know your prices, dates or past work.",
  wrong_person: "They pointed to someone else. Decide whether to write to that person.",
};
const ANSWERABLE: ReplyCategory[] = ["wants_meeting", "interested", "wants_info", "not_now", "wrong_person"];

/** Why this answer waits for the operator although its text is fine; empty = it may go on its own. Pure. */
export function answerNeedsYou(input: { category: ReplyCategory; confidence: number | null; matchedBy: string; answersSent: number }): string[] {
  const reasons: string[] = [];
  const only = ONLY_YOU[input.category];
  if (only) reasons.push(only);
  if ((input.confidence ?? 0) < ANSWER_MIN_CONFIDENCE) reasons.push("The app is not sure it read this reply correctly.");
  if (input.matchedBy !== "thread") reasons.push("The reply was matched by its sender address only, not by the thread.");
  if (input.answersSent >= ANSWER_MAX_AUTOMATIC) reasons.push(`${input.answersSent} answers have already gone out in this conversation: have a look yourself.`);
  return reasons;
}

/** Writes the answer to one classified reply into the open batch. Returns the new email's id, or null when no answer is due. */
export async function draftAnswer(inbound: Inbound, category: ReplyCategory, suggestedReply: string | null, confidence: number | null, model: string | null): Promise<string | null> {
  const body = (suggestedReply ?? "").trim();
  if (!body || !ANSWERABLE.includes(category) || inbound.kind !== "reply" || !inbound.fromEmail) return null;
  const db = await getDb();
  const settings = await getSettings();
  const thread = await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.businessId, inbound.businessId), inArray(outreachDrafts.status, ["sent", "bounced"]))).orderBy(outreachDrafts.sentAt).all();
  const first = thread.find((d) => d.step === STEP.first) ?? thread[0];
  if (!first) return null;
  const answersSent = thread.filter((d) => d.step === STEP.answer).length;
  const issues: DraftIssue[] = [
    ...checkAnswerText(body, { bookingLink: settings.bookingLink }),
    ...(await sendBlockers({ step: STEP.answer, toEmail: inbound.fromEmail }, { id: inbound.businessId, email: null, emailStatus: null, country: null }, settings)).map((message) => ({ severity: "block" as const, code: "recipient", message })),
    ...answerNeedsYou({ category, confidence, matchedBy: inbound.matchedBy, answersSent }).map((message) => ({ severity: "warn" as const, code: "needs_you", message })),
  ];
  const validation: DraftValidation = { passed: !hasBlock(issues), issues, checkedBy: null, checkedAt: nowIso() };
  const status = validation.passed && !issues.some((i) => i.code === "needs_you") ? "ready" : "needs_review";
  const campaign = await openCampaign();
  const id = newId();
  await db.batch([
    // A newer reply makes an unsent answer to an older one stale.
    db.update(outreachDrafts).set({ status: "archived", updatedAt: nowIso() }).where(and(eq(outreachDrafts.businessId, inbound.businessId), eq(outreachDrafts.step, STEP.answer), inArray(outreachDrafts.status, REVIEW_STATUSES))),
    db.insert(outreachDrafts).values({ id, businessId: inbound.businessId, opportunityId: first.opportunityId, campaignId: campaign.id, step: STEP.answer, style: "personal", channel: "email", toEmail: inbound.fromEmail.toLowerCase(), subject: first.subject, body, claims: [], warnings: issues.map((i) => i.message), validation, status, model, costUsd: 0, promptVersion: ANSWER_PROMPT_VERSION, inReplyTo: inbound.messageId, inboundId: inbound.id }),
  ]);
  await logActivity(inbound.businessId, "system", `An answer to ${inbound.fromName || inbound.fromEmail} was written: ${status === "ready" ? "ready under Outreach" : `it waits for you (${issues.filter((i) => i.severity === "block" || i.code === "needs_you").map((i) => i.message).join(" ")})`}`, { draftId: id, inboundId: inbound.id });
  return id;
}

/** Takes back the unsent answers to a reply (it turned out to be a "no" or an opt-out). */
export async function withdrawAnswers(inboundId: string): Promise<void> {
  const db = await getDb();
  await db.update(outreachDrafts).set({ status: "archived", updatedAt: nowIso() }).where(and(eq(outreachDrafts.inboundId, inboundId), eq(outreachDrafts.step, STEP.answer), inArray(outreachDrafts.status, REVIEW_STATUSES))).run();
}
