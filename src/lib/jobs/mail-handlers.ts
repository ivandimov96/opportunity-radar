/**
 * Mail jobs: send one email, read the inbox, classify one reply.
 *
 * Sending is at-most-once by construction. An email is claimed queued → sending
 * in one statement before the mailbox is contacted, and leaves "sending" only
 * for a known outcome. If a run ends without one (crash, timeout, a connection
 * that broke mid-message), the next run looks for the Message-ID in the Sent
 * folder: found means it went out; not found, or no way to tell, means the
 * email is marked failed for the operator to decide. It is never re-sent on a guess.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, emailEvents, inboundEmails, outreachDrafts } from "@/db/schema";
import { AiRefusalError, AiSpendLimitError, AiUnavailableError, callStructured } from "@/lib/ai/client";
import { REPLY_SYSTEM } from "@/lib/ai/prompts";
import { ReplySchema, type ReplyCategory } from "@/lib/ai/schemas";
import { getConfig } from "@/lib/config";
import { addSuppression } from "@/lib/email/suppression";
import { newId, nowIso } from "@/lib/ids";
import { getMailProvider, MailSendError } from "@/lib/mail";
import { asksToUnsubscribe, stripQuoted } from "@/lib/mail/parse";
import { syncMailbox } from "@/lib/mail/sync";
import { composeEmailBody } from "@/lib/outreach/drafts";
import { contactBlockers } from "@/lib/outreach/eligibility";
import { closeCampaignIfDone, dayKey, planSendTimes, sentToday, usedByDay } from "@/lib/outreach/send";
import { advanceStageIfBehind, logActivity, setNextAction } from "@/lib/pipeline/prospects";
import { getSettings, missingSenderDetails } from "@/lib/settings";
import { NonRetryableError, RetryableError, type ProgressFn } from "./handlers";
import { enqueueJob, type JobRow } from "./queue";

const event = async (draftId: string, businessId: string, type: string, detail: Record<string, unknown> = {}) => {
  const db = await getDb();
  await db.insert(emailEvents).values({ id: newId(), draftId, businessId, type, detail }).run();
};

export async function handleSendEmail(job: JobRow, _progress: ProgressFn, signal: AbortSignal = new AbortController().signal) {
  const db = await getDb();
  const draftId = String(job.payload.draftId);
  let draft = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, draftId)).get();
  if (!draft) throw new NonRetryableError(`Email ${draftId} not found`);
  if (draft.status === "sent" || draft.status === "bounced") return; // already out: nothing to do
  const fail = async (message: string, type = "failed", extra: Record<string, unknown> = {}) => {
    await db.update(outreachDrafts).set({ status: "failed", lastError: message, updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
    await event(draftId, draft!.businessId, type, { message, ...extra });
    await closeCampaignIfDone(draft!.campaignId);
  };
  const provider = getMailProvider();
  if (!provider) {
    await fail(getConfig().mail.reason ?? "No mailbox is connected.");
    throw new NonRetryableError("No mailbox is connected");
  }

  if (draft.status === "sending") {
    // An earlier run ended without a known outcome. Ask the mailbox instead of guessing.
    const found = draft.messageId ? await provider.wasSent(draft.messageId) : null;
    if (found === true) {
      await markSent(draft, "Found in the Sent folder after an interrupted attempt", true);
      return;
    }
    await fail("The previous attempt was interrupted and the email was not found in your Sent folder. Check your mailbox; if it is not there, use Retry.", "unconfirmed", { sentFolder: found });
    throw new NonRetryableError("Send outcome unknown; left for the operator");
  }
  if (draft.status !== "queued") return; // cancelled, excluded or failed meanwhile

  const settings = await getSettings();
  // The daily cap is checked again at the moment of sending; an email over the cap moves to the next free slot.
  if ((await sentToday()) >= settings.dailySendCap) {
    const [next] = planSendTimes(new Date(), 1, { dailyCap: settings.dailySendCap, spacingSeconds: settings.sendSpacingSeconds, windowStart: settings.sendWindowStart, windowEnd: settings.sendWindowEnd, usedByDay: { ...(await usedByDay()), [dayKey(new Date())]: settings.dailySendCap } });
    await db.update(outreachDrafts).set({ scheduledAt: next.toISOString(), updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
    await enqueueJob("send_email", { draftId }, { idempotencyKey: `send:${draftId}:${next.getTime()}`, delayMs: Math.max(0, next.getTime() - Date.now()), maxAttempts: 4 });
    await event(draftId, draft.businessId, "rescheduled", { scheduledAt: next.toISOString(), reason: "daily cap reached" });
    return;
  }

  // Last look at the recipient: an opt-out or bounce may have arrived since the email was approved.
  const biz = await db.select().from(businesses).where(eq(businesses.id, draft.businessId)).get();
  if (!biz) throw new NonRetryableError("Business not found");
  const blockers = [...(await contactBlockers(biz, settings)), ...missingSenderDetails(settings).map((m) => `Settings are missing ${m}.`)];
  if (!draft.messageId) blockers.push("The email has no Message-ID.");
  if (blockers.length) {
    await fail(`Not sent: ${blockers.join(" ")}`, "cancelled");
    throw new NonRetryableError(`Not sent: ${blockers.join(" ")}`);
  }

  // Claim: only one run can take an email from queued to sending.
  const claimed = await db.update(outreachDrafts).set({ status: "sending", attempts: sql`${outreachDrafts.attempts} + 1`, updatedAt: nowIso() }).where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.status, "queued"))).returning().get();
  if (!claimed) return;
  draft = claimed;
  await event(draftId, draft.businessId, "attempt", { attempt: draft.attempts, to: biz.email });
  signal.throwIfAborted();

  const subject = draft.step > 0 && !/^re:/i.test(draft.subject ?? "") ? `Re: ${draft.subject ?? ""}` : (draft.subject ?? "");
  try {
    const res = await provider.send({
      from: { name: settings.senderName, address: provider.address },
      to: biz.email!,
      subject,
      text: composeEmailBody(draft.body, settings),
      messageId: draft.messageId!,
      inReplyTo: draft.inReplyTo,
      references: draft.inReplyTo ? [draft.inReplyTo] : undefined,
      headers: { "List-Unsubscribe": `<mailto:${provider.address}?subject=unsubscribe>` },
    });
    await markSent(draft, res.note ? `${res.response} · ${res.note}` : res.response, false);
  } catch (err) {
    if (!(err instanceof MailSendError)) throw err;
    if (err.kind === "temporary" || err.kind === "connection") {
      // Nothing was accepted: hand the email back to the queue and let the job retry with a pause.
      const last = job.attempts >= job.maxAttempts;
      await db.update(outreachDrafts).set({ status: last ? "failed" : "queued", lastError: err.message, updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
      await event(draftId, draft.businessId, "failed", { message: err.message, kind: err.kind, willRetry: !last });
      if (last) await closeCampaignIfDone(draft.campaignId);
      throw last ? new NonRetryableError(err.message) : new RetryableError(err.message);
    }
    if (err.kind === "rejected" && /user|mailbox|recipient|address|no such|does not exist|unknown|unavailable/i.test(err.message)) {
      // The receiving server says the address is not there: record the bounce and never write to it again.
      await db.update(outreachDrafts).set({ status: "bounced", lastError: `Rejected by the recipient's server: ${err.message}`, sentAt: nowIso(), updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
      await event(draftId, draft.businessId, "bounced", { message: err.message, responseCode: err.responseCode });
      await addSuppression(biz.email!, "bounced", "Rejected while sending");
      await db.update(businesses).set({ emailStatus: "invalid", updatedAt: nowIso() }).where(eq(businesses.id, biz.id)).run();
      await logActivity(biz.id, "email", `The email to ${biz.email} was rejected by the recipient's server (the address does not accept mail; it will not be written to again).`, { draftId });
      await closeCampaignIfDone(draft.campaignId);
      return;
    }
    if (err.kind === "unknown") {
      // The connection broke while the message was being handed over: it may or may not have gone out.
      const found = await provider.wasSent(draft.messageId!);
      if (found === true) {
        await markSent(draft, "Found in the Sent folder after the connection broke", true);
        return;
      }
      await fail(`The connection broke while sending and the email was not found in your Sent folder (${err.message}). Check your mailbox; if it is not there, use Retry.`, "unconfirmed", { sentFolder: found });
      throw new NonRetryableError(err.message);
    }
    await fail(err.kind === "auth" ? `${err.message} Check MAIL_USER and MAIL_PASSWORD, then use Retry.` : `The mail server refused the message: ${err.message}`);
    throw new NonRetryableError(err.message);
  }
}

async function markSent(draft: typeof outreachDrafts.$inferSelect, response: string, reconciled: boolean) {
  const db = await getDb();
  const at = nowIso();
  await db.update(outreachDrafts).set({ status: "sent", sentAt: draft.sentAt ?? at, lastError: null, updatedAt: at }).where(eq(outreachDrafts.id, draft.id)).run();
  await event(draft.id, draft.businessId, reconciled ? "reconciled" : "sent", { response });
  await logActivity(draft.businessId, "email", `${draft.step > 0 ? "Follow-up" : "Outreach email"} sent: "${draft.subject ?? ""}"${draft.toEmail ? ` to ${draft.toEmail}` : ""}`, { draftId: draft.id });
  if (draft.step === 0) await advanceStageIfBehind(draft.businessId, "contacted", "outreach email sent");
  await closeCampaignIfDone(draft.campaignId);
}

export async function handleSyncMailbox(_job: JobRow, progress: ProgressFn) {
  progress({ message: "Reading the inbox" });
  try {
    const r = await syncMailbox();
    progress({ message: `Inbox read: ${r.replies} repl${r.replies === 1 ? "y" : "ies"}, ${r.bounces} bounce(s), ${r.autoReplies} automatic` });
  } catch (err) {
    // A mailbox that cannot be reached is tried again at the next scheduled sync, not hammered now.
    throw new NonRetryableError(`Inbox could not be read: ${(err as Error).message.split("\n")[0]}`);
  }
}

const NEXT_ACTION: Record<ReplyCategory, string> = {
  wants_meeting: "Schedule the meeting they asked for",
  interested: "Answer: they are interested",
  wants_info: "Answer their question",
  not_now: "Answer briefly and note when to check back",
  declined: "They declined: close as lost",
  unsubscribe: "They asked not to be contacted: close as lost",
  wrong_person: "Follow up with the contact they named",
  other: "Read the reply",
};

/** Applies what a classification means for the business. The same function serves the model, the rules and the operator's correction. */
export async function applyReplyClassification(inboundId: string, category: ReplyCategory, by: string, extra: { confidence?: number | null; summary?: string | null; suggestedReply?: string | null } = {}) {
  const db = await getDb();
  const row = await db.select().from(inboundEmails).where(eq(inboundEmails.id, inboundId)).get();
  if (!row) return;
  await db
    .update(inboundEmails)
    .set({ classification: category, classifiedBy: by, classificationConfidence: extra.confidence ?? (by === "operator" ? 1 : null), ...(extra.summary !== undefined ? { classificationSummary: extra.summary } : {}), ...(extra.suggestedReply !== undefined ? { suggestedReply: extra.suggestedReply } : {}) })
    .where(eq(inboundEmails.id, inboundId))
    .run();
  if (category === "unsubscribe") {
    // Honoured at once and for good, whoever classified it: the address is never written to again.
    const draft = row.draftId ? await db.select({ toEmail: outreachDrafts.toEmail }).from(outreachDrafts).where(eq(outreachDrafts.id, row.draftId)).get() : null;
    for (const address of new Set([row.fromEmail, draft?.toEmail].filter((a): a is string => Boolean(a)))) await addSuppression(address, "unsubscribed", "Asked not to be contacted again");
    await logActivity(row.businessId, "system", "Asked not to be contacted again: the address is on the do-not-contact list.", { inboundId });
  }
  await setNextAction(row.businessId, NEXT_ACTION[category], nowIso());
}

export async function handleProcessReply(job: JobRow, progress: ProgressFn) {
  const db = await getDb();
  const inboundId = String(job.payload.inboundId);
  const row = await db.select().from(inboundEmails).where(eq(inboundEmails.id, inboundId)).get();
  if (!row || row.kind !== "reply" || row.classification) return;
  const text = stripQuoted(row.bodyText);
  if (asksToUnsubscribe(row.bodyText, row.subject ?? "")) {
    await applyReplyClassification(inboundId, "unsubscribe", "rules", { confidence: 1, summary: "Asked not to be contacted again.", suggestedReply: null });
    return;
  }
  if (!getConfig().ai.enabled) return; // stays unclassified; the reply itself is shown as it is
  const draft = row.draftId ? await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, row.draftId)).get() : null;
  const settings = await getSettings();
  progress({ message: "Reading the reply" });
  try {
    const res = await callStructured({
      stage: "reply",
      effort: "low",
      system: REPLY_SYSTEM,
      user: `The email we sent${draft ? `:\nSubject: ${draft.subject ?? ""}\n${draft.body}` : " is not available."}\n\nSender's name: ${settings.senderName || "the owner"}${settings.bookingLink ? `\nSender's booking link (may be offered for scheduling): ${settings.bookingLink}` : ""}\n\n<reply>\nFrom: ${row.fromName ?? ""} <${row.fromEmail ?? ""}>\nSubject: ${row.subject ?? ""}\n\n${text.slice(0, 6000)}\n</reply>\n\nClassify the reply.`,
      schema: ReplySchema,
      businessId: row.businessId,
      maxTokens: 6000,
    });
    await applyReplyClassification(inboundId, res.data.category, res.model, { confidence: Math.max(0, Math.min(1, Number.isFinite(res.data.confidence) ? res.data.confidence : 0)), summary: res.data.summary.trim().slice(0, 400), suggestedReply: res.data.suggested_reply.trim() || null });
  } catch (err) {
    if (err instanceof AiSpendLimitError || err instanceof AiRefusalError || err instanceof AiUnavailableError) return; // the reply stays unclassified and fully readable
    throw err;
  }
}
