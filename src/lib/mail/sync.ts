/**
 * Reading the inbox for answers to outreach. Only messages that belong to an
 * email this app sent are stored: a reply in the same thread (reply headers
 * point at our Message-ID), a message from an address we wrote to, or a bounce
 * that names our email. Everything else in the mailbox is skipped and never kept.
 * The inbox is read as the workspace the mailbox belongs to, and a message is
 * only ever matched to an email of that workspace; the reply then belongs to
 * that email's business.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, emailEvents, inboundEmails, outreachDrafts } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { logActivity, markNotReached, markReplied, setNextAction } from "@/lib/pipeline/prospects";
import { addSuppression } from "@/lib/email/suppression";
import { getState, setState } from "@/lib/settings";
import { businessIdsOf, workspaceId } from "@/lib/workspace";
import { assertMailboxForWorkspace, getMailProvider } from "./index";
import { bouncedRecipients, isAutoReply, isBounce, isHardBounce, stripQuoted } from "./parse";
import type { InboundMessage, InboxCursor } from "./types";

export interface SyncResult {
  fetched: number;
  replies: number;
  autoReplies: number;
  bounces: number;
  ignored: number;
}

type SentDraft = Pick<typeof outreachDrafts.$inferSelect, "id" | "businessId" | "messageId" | "toEmail" | "sentAt" | "step" | "subject" | "campaignId">;

export async function syncMailbox(): Promise<SyncResult> {
  const result: SyncResult = { fetched: 0, replies: 0, autoReplies: 0, bounces: 0, ignored: 0 };
  await assertMailboxForWorkspace();
  const provider = getMailProvider();
  if (!provider) return result;
  const db = await getDb();
  const mine = businessIdsOf(db, await workspaceId());
  const sent: SentDraft[] = await db
    .select({ id: outreachDrafts.id, businessId: outreachDrafts.businessId, messageId: outreachDrafts.messageId, toEmail: outreachDrafts.toEmail, sentAt: outreachDrafts.sentAt, step: outreachDrafts.step, subject: outreachDrafts.subject, campaignId: outreachDrafts.campaignId })
    .from(outreachDrafts)
    .where(and(inArray(outreachDrafts.businessId, mine), inArray(outreachDrafts.status, ["sent", "bounced"]), isNotNull(outreachDrafts.messageId), isNotNull(outreachDrafts.sentAt)))
    .all();
  if (!sent.length) return result; // nothing was sent, so nothing in the inbox can belong to outreach

  const stored = await getState<InboxCursor & { address: string }>("mail.cursor");
  const cursor = stored && stored.address === provider.address ? { uid: stored.uid, uidValidity: stored.uidValidity } : null;
  const earliest = sent.reduce((min, d) => (d.sentAt! < min ? d.sentAt! : min), sent[0].sentAt!);
  const fetched = await provider.fetchInbox({ cursor, since: new Date(new Date(earliest).getTime() - 86_400_000) });
  result.fetched = fetched.messages.length;

  const byMessageId = new Map(sent.map((d) => [d.messageId!, d]));
  const byAddress = new Map<string, SentDraft>();
  for (const d of [...sent].sort((a, b) => (a.sentAt! < b.sentAt! ? -1 : 1))) if (d.toEmail) byAddress.set(d.toEmail.toLowerCase(), d); // the latest email to an address wins

  for (const msg of [...fetched.messages].sort((a, b) => a.uid - b.uid)) {
    if (msg.from.address === provider.address.toLowerCase()) continue;
    if (await db.select({ id: inboundEmails.id }).from(inboundEmails).where(eq(inboundEmails.messageId, msg.messageId)).get()) continue;

    if (isBounce(msg)) {
      const hay = `${msg.rawHead}\n${msg.text}`;
      const draft = sent.find((d) => hay.includes(d.messageId!)) ?? bouncedRecipients(msg).map((a) => byAddress.get(a)).find(Boolean) ?? null;
      if (!draft) {
        result.ignored++;
        continue;
      }
      await recordBounce(draft, msg);
      result.bounces++;
      continue;
    }

    const threadRef = [msg.inReplyTo, ...msg.references].find((r) => r && byMessageId.has(r));
    const draft = threadRef ? byMessageId.get(threadRef)! : (byAddress.get(msg.from.address) ?? null);
    if (!draft) {
      result.ignored++;
      continue;
    }
    // A message from an address we wrote to that arrived before our email cannot be an answer to it.
    if (!threadRef && draft.sentAt && msg.date < draft.sentAt) {
      result.ignored++;
      continue;
    }
    const auto = isAutoReply(msg);
    const id = newId();
    await db
      .insert(inboundEmails)
      .values({ id, businessId: draft.businessId, draftId: draft.id, messageId: msg.messageId, inReplyTo: msg.inReplyTo, fromEmail: msg.from.address, fromName: msg.from.name || null, subject: msg.subject, bodyText: msg.text, receivedAt: msg.date, kind: auto ? "auto_reply" : "reply", matchedBy: threadRef ? "thread" : "address" })
      .onConflictDoNothing()
      .run();
    if (auto) {
      result.autoReplies++;
      await logActivity(draft.businessId, "email", `Automatic reply received from ${msg.from.address}: "${msg.subject}"`, { inboundId: id, auto: true });
      continue;
    }
    result.replies++;
    const preview = stripQuoted(msg.text).replace(/\s+/g, " ").slice(0, 200);
    await logActivity(draft.businessId, "email", `Reply received from ${msg.from.name || msg.from.address}: ${preview}`, { inboundId: id, matchedBy: threadRef ? "thread" : "address" });
    await markReplied(draft.businessId);
    // A reply ends the sequence: a follow-up that was written but not sent is withdrawn.
    await db.update(outreachDrafts).set({ status: "archived", updatedAt: nowIso() }).where(and(eq(outreachDrafts.businessId, draft.businessId), eq(outreachDrafts.step, 1), inArray(outreachDrafts.status, ["needs_review", "ready", "approved", "excluded"]))).run();
    await setNextAction(draft.businessId, `Read and answer the reply from ${msg.from.name || msg.from.address}`, nowIso());
    await enqueueJob("process_reply", { inboundId: id }, { idempotencyKey: `reply:${id}` });
  }

  if (fetched.cursor) await setState("mail.cursor", { ...fetched.cursor, address: provider.address });
  await setState("mail.lastSync", { at: nowIso(), ...result });
  return result;
}

async function recordBounce(draft: SentDraft, msg: InboundMessage) {
  const db = await getDb();
  const hard = isHardBounce(msg);
  const reason = stripQuoted(msg.text).replace(/\s+/g, " ").slice(0, 300) || msg.subject;
  await db.insert(inboundEmails).values({ id: newId(), businessId: draft.businessId, draftId: draft.id, messageId: msg.messageId, inReplyTo: msg.inReplyTo, fromEmail: msg.from.address, fromName: msg.from.name || null, subject: msg.subject, bodyText: msg.text, receivedAt: msg.date, kind: "bounce", matchedBy: "thread", handledAt: nowIso() }).onConflictDoNothing().run();
  await db.update(outreachDrafts).set({ status: "bounced", lastError: `${hard ? "Bounced" : "Bounced (temporary)"}: ${reason}`, updatedAt: nowIso() }).where(eq(outreachDrafts.id, draft.id)).run();
  await db.insert(emailEvents).values({ id: newId(), draftId: draft.id, businessId: draft.businessId, type: "bounced", detail: { hard, from: msg.from.address, subject: msg.subject } }).run();
  if (hard && draft.toEmail) {
    await addSuppression(draft.toEmail, "bounced", "The address rejected an outreach email");
    await db.update(businesses).set({ emailStatus: "invalid", updatedAt: nowIso() }).where(eq(businesses.id, draft.businessId)).run();
  }
  await logActivity(draft.businessId, "email", `The email to ${draft.toEmail} bounced${hard ? " (the address does not accept mail; it will not be written to again)" : " (temporary problem at the recipient)"}.`, { draftId: draft.id, hard });
  if (hard && draft.step === 0) await markNotReached(draft.businessId);
}
