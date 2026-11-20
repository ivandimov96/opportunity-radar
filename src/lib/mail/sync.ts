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
import { holdUntil, logActivity, markNotReached, markReplied, setNextAction } from "@/lib/pipeline/prospects";
import { PENDING_ON_REPLY } from "@/lib/outreach/steps";
import { addSuppression } from "@/lib/email/suppression";
import { getSettings, getState, setState } from "@/lib/settings";
import { businessIdsOf, workspaceId } from "@/lib/workspace";
import { assertMailboxForWorkspace, getMailProviders } from "./index";
import { bouncedRecipients, isAutoReply, isBounce, isHardBounce, stripQuoted } from "./parse";
import type { InboundMessage, InboxCursor } from "./types";

/** How long an out-of-office reply postpones the next email. */
export const AUTO_REPLY_HOLD_DAYS = 7;

export interface SyncResult {
  fetched: number;
  replies: number;
  autoReplies: number;
  bounces: number;
  ignored: number;
}

type SentDraft = Pick<typeof outreachDrafts.$inferSelect, "id" | "businessId" | "messageId" | "toEmail" | "sentAt" | "step" | "subject" | "campaignId">;

/** Where reading stopped in one mailbox. */
const cursorKey = (address: string) => `mail.cursor:${address.toLowerCase()}`;

export async function syncMailbox(): Promise<SyncResult> {
  const result: SyncResult = { fetched: 0, replies: 0, autoReplies: 0, bounces: 0, ignored: 0 };
  await assertMailboxForWorkspace();
  const providers = await getMailProviders();
  if (!providers.length) return result;
  const db = await getDb();
  const mine = businessIdsOf(db, await workspaceId());
  const sent: SentDraft[] = await db
    .select({ id: outreachDrafts.id, businessId: outreachDrafts.businessId, messageId: outreachDrafts.messageId, toEmail: outreachDrafts.toEmail, sentAt: outreachDrafts.sentAt, step: outreachDrafts.step, subject: outreachDrafts.subject, campaignId: outreachDrafts.campaignId })
    .from(outreachDrafts)
    .where(and(inArray(outreachDrafts.businessId, mine), inArray(outreachDrafts.status, ["sent", "bounced"]), isNotNull(outreachDrafts.messageId), isNotNull(outreachDrafts.sentAt)))
    .all();
  if (!sent.length) return result; // nothing was sent, so nothing in the inbox can belong to outreach

  // Every mailbox of the workspace is read, each from where it was left. One that cannot be read does not stop the others.
  const earliest = sent.reduce((min, d) => (d.sentAt! < min ? d.sentAt! : min), sent[0].sentAt!);
  const own = new Set(providers.map((p) => p.address.toLowerCase()));
  const legacy = await getState<InboxCursor & { address: string }>("mail.cursor");
  const messages: InboundMessage[] = [];
  const cursors: [string, InboxCursor][] = [];
  const unreadable: string[] = [];
  for (const provider of providers) {
    const stored = (await getState<InboxCursor>(cursorKey(provider.address))) ?? (legacy && legacy.address === provider.address ? legacy : null);
    try {
      const fetched = await provider.fetchInbox({ cursor: stored ? { uid: stored.uid, uidValidity: stored.uidValidity } : null, since: new Date(new Date(earliest).getTime() - 86_400_000) });
      // The same reply can sit in two of our own inboxes (a forward, a shared address): it is taken once.
      for (const m of fetched.messages) if (!messages.some((x) => x.messageId === m.messageId)) messages.push(m);
      if (fetched.cursor) cursors.push([provider.address, fetched.cursor]);
    } catch (err) {
      if (providers.length === 1) throw err;
      unreadable.push(`${provider.address}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  result.fetched = messages.length;

  // How long the next email waits after an out-of-office reply: the operator's setting.
  const holdDays = (await getSettings()).outOfOfficeDays || AUTO_REPLY_HOLD_DAYS;
  const byMessageId = new Map(sent.map((d) => [d.messageId!, d]));
  const byAddress = new Map<string, SentDraft>();
  for (const d of [...sent].sort((a, b) => (a.sentAt! < b.sentAt! ? -1 : 1))) if (d.toEmail) byAddress.set(d.toEmail.toLowerCase(), d); // the latest email to an address wins

  for (const msg of messages.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.uid - b.uid))) {
    if (own.has(msg.from.address)) continue;
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
      // Nobody is reading: the next email of the sequence waits a week from the automatic reply instead of landing in an empty office.
      const until = new Date(new Date(msg.date).getTime() + holdDays * 86_400_000).toISOString();
      await holdUntil(draft.businessId, until);
      await logActivity(draft.businessId, "email", `Automatic reply received from ${msg.from.address}: "${msg.subject}". The next email waits until ${until.slice(0, 10)}.`, { inboundId: id, auto: true });
      continue;
    }
    result.replies++;
    const preview = stripQuoted(msg.text).replace(/\s+/g, " ").slice(0, 200);
    await logActivity(draft.businessId, "email", `Reply received from ${msg.from.name || msg.from.address}: ${preview}`, { inboundId: id, matchedBy: threadRef ? "thread" : "address" });
    await markReplied(draft.businessId);
    // A reply ends the sequence: what was written ahead but not sent is withdrawn.
    await db.update(outreachDrafts).set({ status: "archived", updatedAt: nowIso() }).where(and(eq(outreachDrafts.businessId, draft.businessId), inArray(outreachDrafts.step, [...PENDING_ON_REPLY]), inArray(outreachDrafts.status, ["needs_review", "ready", "approved", "excluded"]))).run();
    await setNextAction(draft.businessId, `Read and answer the reply from ${msg.from.name || msg.from.address}`, nowIso(), undefined, `reply:${id}`);
    await enqueueJob("process_reply", { inboundId: id }, { idempotencyKey: `reply:${id}` });
  }

  for (const [address, cursor] of cursors) await setState(cursorKey(address), cursor);
  await setState("mail.lastSync", { at: nowIso(), ...result });
  if (unreadable.length) throw new Error(unreadable.join(" · "));
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
