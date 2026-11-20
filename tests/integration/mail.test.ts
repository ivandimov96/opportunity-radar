/**
 * Sending, reply tracking and the scheduler, through the real job queue with
 * the in-memory mailbox. No real mailbox is ever contacted and the model is
 * mocked at the client boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const callStructured = vi.fn();
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...orig, callStructured: (...args: unknown[]) => callStructured(...args) };
});

import { useTempDb, resetEnv } from "../helpers";
import { activities, businesses, campaigns, emailEvents, facts, inboundEmails, investigations, jobs, observations, opportunities, outreachDrafts, prospects, suppressions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { drainQueue } from "@/lib/jobs/worker";
import { runScheduler, businessDaysBetween } from "@/lib/jobs/scheduler";
import { applyReplyClassification } from "@/lib/jobs/mail-handlers";
import { deliverToFakeInbox, fakeMail, resetFakeMail } from "@/lib/mail/fake";
import { MailSendError } from "@/lib/mail";
import { syncMailbox } from "@/lib/mail/sync";
import { asksToUnsubscribe, isAutoReply, isBounce, isHardBounce, parseRawEmail, stripQuoted } from "@/lib/mail/parse";
import { openCampaign } from "@/lib/outreach/campaigns";
import { cancelQueued, dayKey, planSendTimes, retryFailed, sendCampaign, sendPreflight, spacingLabel } from "@/lib/outreach/send";
import { addSuppression, isSuppressed } from "@/lib/email/suppression";
import { ensureProspect } from "@/lib/pipeline/prospects";
import { saveSettings } from "@/lib/settings";

const BODY = "Hi team,\n\nI noticed that every replacement starts with a free in-home estimate. Would a short call be useful?";

describe("planSendTimes", () => {
  it("names the pause between two emails exactly as it is set", () => {
    expect([50, 60, 90, 120].map(spacingLabel)).toEqual(["50 seconds", "1 minute", "1 min 30 s", "2 minutes"]);
  });
  const base = { dailyCap: 3, spacingSeconds: 120, windowStart: 9, windowEnd: 17, jitter: () => 1 };
  it("paces sends, stays inside the sending hours and never exceeds the daily cap", () => {
    const now = new Date(2026, 10, 12, 10, 0, 0);
    const t = planSendTimes(now, 5, base);
    expect(t.slice(0, 3).map((d) => [d.getDate(), d.getHours(), d.getMinutes()])).toEqual([[12, 10, 0], [12, 10, 2], [12, 10, 4]]);
    expect(t.slice(3).map((d) => [d.getDate(), d.getHours(), d.getMinutes()])).toEqual([[13, 9, 0], [13, 9, 2]]);
    // Before the window: wait for it. After it: tomorrow. What already went out today counts.
    expect(planSendTimes(new Date(2026, 10, 12, 6, 30), 1, base)[0].getHours()).toBe(9);
    expect(planSendTimes(new Date(2026, 10, 12, 19, 0), 1, base)[0].getDate()).toBe(13);
    const used = planSendTimes(now, 2, { ...base, usedByDay: { [dayKey(now)]: 2 } });
    expect(used.map((d) => d.getDate())).toEqual([12, 13]);
    expect(planSendTimes(now, 0, base)).toEqual([]);
  });
});

describe("reading mail", () => {
  it("parses a raw message, cuts the quoted original, and recognises bounces, automatic replies and opt-outs", async () => {
    const raw = ["From: Maria Lopez <Maria@Shop.example>", "To: me@me.example", "Subject: Re: Booking your estimates", "Message-ID: <reply-1@shop.example>", "In-Reply-To: <out-1@me.example>", "References: <x@a> <out-1@me.example>", "Date: Thu, 12 Nov 2026 10:00:00 +0000", "Content-Type: text/plain; charset=utf-8", "", "Sure, happy to talk. Thursday works.", "", "On Wed, Nov 11, 2026 at 9:00 AM Ivan <me@me.example> wrote:", "> Hi team,", "> I noticed..."].join("\r\n");
    const m = await parseRawEmail(raw, 7);
    expect(m).toMatchObject({ uid: 7, messageId: "<reply-1@shop.example>", inReplyTo: "<out-1@me.example>", references: ["<x@a>", "<out-1@me.example>"], subject: "Re: Booking your estimates" });
    expect(m.from).toEqual({ address: "maria@shop.example", name: "Maria Lopez" });
    expect(stripQuoted(m.text)).toBe("Sure, happy to talk. Thursday works.");
    expect(isBounce(m)).toBe(false);
    expect(isAutoReply(m)).toBe(false);
    const bounce = { from: { address: "mailer-daemon@googlemail.com", name: "" }, subject: "Delivery Status Notification (Failure)", headers: {}, text: "Address not found. Status: 5.1.1", rawHead: "" };
    expect(isBounce(bounce)).toBe(true);
    expect(isHardBounce(bounce)).toBe(true);
    expect(isHardBounce({ text: "Mailbox full, try again later. Status: 4.2.2", rawHead: "" })).toBe(false);
    expect(isAutoReply({ subject: "Out of office", headers: {} })).toBe(true);
    expect(isAutoReply({ subject: "Re: hello", headers: { "auto-submitted": "auto-replied" } })).toBe(true);
    expect(asksToUnsubscribe("Please remove me from your list.")).toBe(true);
    expect(asksToUnsubscribe("No thanks")).toBe(true);
    expect(asksToUnsubscribe("Thanks, tell me more.\n\nOn Wed someone wrote:\n> reply no thanks and I won't write again")).toBe(false);
  });
});

describe("sending and reply tracking", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  let campaignId: string;
  const env = { MAIL_PROVIDER: "fake", MAIL_USER: "ivan@dimov.example" };
  const seed = async (name: string, email: string | null, status = "approved", extra: Partial<typeof outreachDrafts.$inferInsert> = {}) => {
    const id = newId();
    await db.insert(businesses).values({ id, name, nameNormalized: name.toLowerCase(), industry: "home_services", firstProvider: "csv", country: "US", status: "profiled", verdict: "qualified", email, emailStatus: email ? "valid" : null, emailSource: email ? "site" : null }).run();
    await ensureProspect(id, "ready_to_contact");
    const draftId = newId();
    await db.insert(outreachDrafts).values({ id: draftId, businessId: id, campaignId, step: 0, style: "personal", toEmail: email, subject: `Idea for ${name}`, body: BODY, claims: [], warnings: [], status, validation: { passed: true, issues: [], checkedAt: new Date().toISOString() }, ...extra }).run();
    return { id, draftId };
  };
  const draft = async (id: string) => (await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, id)).get())!;
  const stage = async (businessId: string) => (await db.select().from(prospects).where(eq(prospects.businessId, businessId)).get())!.stage;
  /** Time passes: every queued send job becomes due. */
  const due = async () => db.update(jobs).set({ scheduledAt: new Date(Date.now() - 1000).toISOString() }).where(and(eq(jobs.type, "send_email"), eq(jobs.status, "queued"))).run();
  const events = async (draftId: string) => (await db.select().from(emailEvents).where(eq(emailEvents.draftId, draftId)).all()).map((e) => e.type);

  beforeEach(async () => {
    resetEnv(env);
    db = await useTempDb();
    resetFakeMail();
    callStructured.mockReset();
    await saveSettings({ senderName: "Ivan Dimov", senderCompany: "Dimov Software", postalAddress: "1 Main St, Austin, TX 78701", sendWindowStart: 0, sendWindowEnd: 24, sendSpacingSeconds: 20, dailySendCap: 20 });
    campaignId = (await openCampaign()).id;
  });

  it("shows exactly what will be sent, queues it once, sends each email once and closes the batch", async () => {
    const a = await seed("Alpha Air", "office@alpha.example");
    const b = await seed("Bravo Air", "hello@bravo.example");
    const dup = await seed("Alpha Air North", "office@alpha.example"); // same address as Alpha
    const ready = await seed("Charlie Air", "c@charlie.example", "ready");
    const excluded = await seed("Delta Air", "d@delta.example", "excluded");
    const pre = (await sendPreflight(campaignId))!;
    expect(pre.canSend).toBe(true);
    expect(pre.counts).toEqual({ approved: 3, ready: 1, needsReview: 0, excluded: 1 });
    expect(pre.sendable.map((s) => s.business.name)).toEqual(["Alpha Air", "Bravo Air"]);
    expect(pre.blocked.map((x) => [x.business.name, x.reasons.join(" ")])).toEqual([["Alpha Air North", "office@alpha.example is already a recipient in this batch (Alpha Air)."]]);
    expect(pre.plan?.perDay.reduce((s, [, n]) => s + n, 0)).toBe(2);

    const res = await sendCampaign(campaignId);
    expect(res).toMatchObject({ ok: true, queued: 2, skipped: 1 });
    expect((await sendCampaign(campaignId)).ok).toBe(false); // a second click finds the batch already sent
    expect((await db.select().from(jobs).where(eq(jobs.type, "send_email")).all())).toHaveLength(2);
    expect((await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get())!.status).toBe("sending");
    // What was not sent moved on to a new open batch.
    const open = await openCampaign();
    expect(open.id).not.toBe(campaignId);
    expect([(await draft(ready.draftId)).campaignId, (await draft(excluded.draftId)).campaignId, (await draft(dup.draftId)).campaignId]).toEqual([open.id, open.id, open.id]);

    await due();
    expect(await drainQueue(["send_email"])).toBe(2);
    const sent = fakeMail().sent;
    expect(sent.map((m) => m.to).sort()).toEqual(["hello@bravo.example", "office@alpha.example"]);
    expect(new Set(sent.map((m) => m.messageId)).size).toBe(2);
    expect(sent[0].messageId).toMatch(/^<[0-9a-f-]{36}@dimov\.example>$/);
    expect(sent[0].from).toEqual({ name: "Ivan Dimov", address: "ivan@dimov.example" });
    expect(sent[0].text).toContain(BODY);
    expect(sent[0].text).toMatch(/Ivan Dimov\nDimov Software\n1 Main St, Austin, TX 78701$/); // the signature ends the email: nothing is added after it
    expect(sent[0].headers?.["List-Unsubscribe"]).toBe("<mailto:ivan@dimov.example?subject=unsubscribe>");
    const da = await draft(a.draftId);
    expect(da).toMatchObject({ status: "sent", attempts: 1, lastError: null });
    expect(da.sentAt).toBeTruthy();
    expect(await events(a.draftId)).toEqual(["queued", "attempt", "sent"]);
    expect(await stage(a.id)).toBe("contacted");
    expect(await stage(b.id)).toBe("contacted");
    expect((await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get())!.status).toBe("sent");
    // Running the job again for an email that is out does nothing.
    await db.update(jobs).set({ status: "queued", attempts: 0 }).where(eq(jobs.type, "send_email")).run();
    await drainQueue(["send_email"]);
    expect(fakeMail().sent).toHaveLength(2);
  });

  it("refuses to send without a mailbox, sender details or approved emails, and respects the daily cap", async () => {
    await seed("Alpha Air", "office@alpha.example", "ready");
    expect((await sendPreflight(campaignId))!.problem).toBe("No email is approved yet.");
    await db.update(outreachDrafts).set({ status: "approved" }).run();
    await saveSettings({ postalAddress: "" });
    expect((await sendPreflight(campaignId))!.problem).toMatch(/add a postal address/);
    await saveSettings({ postalAddress: "1 Main St" });
    resetEnv({});
    const noBox = (await sendPreflight(campaignId))!;
    expect(noBox.canSend).toBe(false);
    expect(noBox.problem).toMatch(/No mailbox is connected/);
    expect((await sendCampaign(campaignId)).ok).toBe(false);
    expect(fakeMail().sent).toHaveLength(0);

    resetEnv(env);
    await saveSettings({ dailySendCap: 2 });
    await seed("Bravo Air", "b@bravo.example");
    await seed("Charlie Air", "c@charlie.example");
    const now = new Date(2026, 10, 12, 10, 0, 0);
    const pre = (await sendPreflight(campaignId, now))!;
    expect(pre.plan?.perDay).toEqual([["2026-11-12", 2], ["2026-11-13", 1]]);
    // Stopping returns what has not gone out to "approved" and cancels its jobs.
    await sendCampaign(campaignId);
    expect(await cancelQueued(campaignId)).toBe(3);
    expect((await db.select().from(outreachDrafts).all()).every((d) => d.status === "approved")).toBe(true);
    expect((await db.select().from(jobs).where(eq(jobs.type, "send_email")).all()).every((j) => j.status === "cancelled")).toBe(true);
    expect(await drainQueue(["send_email"])).toBe(0);
    expect(fakeMail().sent).toHaveLength(0);
  });

  it("handles failures without ever sending twice", async () => {
    // 1. The server asks to try later: the email goes back to the queue and is sent on the retry.
    const a = await seed("Alpha Air", "office@alpha.example");
    await sendCampaign(campaignId);
    fakeMail().failures.push(new MailSendError("451 try again later", "temporary", 451));
    await due();
    await drainQueue(["send_email"]);
    expect(await draft(a.draftId)).toMatchObject({ status: "queued", attempts: 1, lastError: "451 try again later" });
    expect(fakeMail().sent).toHaveLength(0);
    await due();
    await drainQueue(["send_email"]);
    expect(await draft(a.draftId)).toMatchObject({ status: "sent", attempts: 2 });
    expect(fakeMail().sent).toHaveLength(1);
    expect(await events(a.draftId)).toEqual(["queued", "attempt", "failed", "attempt", "sent"]);

    // 2. The address does not exist: recorded as a bounce, suppressed, never retried.
    campaignId = (await openCampaign()).id;
    const b = await seed("Bravo Air", "gone@bravo.example");
    await sendCampaign(campaignId);
    fakeMail().failures.push(new MailSendError("550 5.1.1 user unknown", "rejected", 550));
    await due();
    await drainQueue(["send_email"]);
    expect((await draft(b.draftId)).status).toBe("bounced");
    expect(await isSuppressed("gone@bravo.example")).toBe(true);
    expect((await db.select().from(businesses).where(eq(businesses.id, b.id)).get())!.emailStatus).toBe("invalid");

    // 3. The connection breaks after the mailbox accepted the message: found in Sent, so it counts as sent. Once.
    campaignId = (await openCampaign()).id;
    const c = await seed("Charlie Air", "c@charlie.example");
    await sendCampaign(campaignId);
    fakeMail().crashAfterAccept = true;
    await due();
    await drainQueue(["send_email"]);
    expect((await draft(c.draftId)).status).toBe("sent");
    expect(await events(c.draftId)).toEqual(["queued", "attempt", "reconciled"]);
    expect(fakeMail().sent.filter((m) => m.to === "c@charlie.example")).toHaveLength(1);

    // 4. A run died mid-send and the Sent folder does not have the email: not re-sent on a guess; the operator retries.
    campaignId = (await openCampaign()).id;
    const d = await seed("Delta Air", "d@delta.example");
    await sendCampaign(campaignId);
    await db.update(outreachDrafts).set({ status: "sending", attempts: 1 }).where(eq(outreachDrafts.id, d.draftId)).run();
    await due();
    await drainQueue(["send_email"]);
    expect(await draft(d.draftId)).toMatchObject({ status: "failed" });
    expect((await draft(d.draftId)).lastError).toMatch(/not found in your Sent folder/);
    expect(fakeMail().sent.filter((m) => m.to === "d@delta.example")).toHaveLength(0);
    expect(await retryFailed(d.draftId)).toBe(true);
    await drainQueue(["send_email"]);
    expect((await draft(d.draftId)).status).toBe("sent");
    expect(fakeMail().sent.filter((m) => m.to === "d@delta.example")).toHaveLength(1);

    // 5. A wrong password fails clearly and sends nothing.
    campaignId = (await openCampaign()).id;
    const e = await seed("Echo Air", "e@echo.example");
    await sendCampaign(campaignId);
    fakeMail().failures.push(new MailSendError("The mailbox refused the login: 535 bad credentials", "auth", 535));
    await due();
    await drainQueue(["send_email"]);
    expect((await draft(e.draftId)).lastError).toMatch(/refused the login.*Check MAIL_USER and MAIL_PASSWORD/);

    // 6. An opt-out that arrives after approval stops the email at the last moment.
    campaignId = (await openCampaign()).id;
    const f = await seed("Foxtrot Air", "f@foxtrot.example");
    await sendCampaign(campaignId);
    await addSuppression("f@foxtrot.example", "unsubscribed");
    await due();
    await drainQueue(["send_email"]);
    expect(await draft(f.draftId)).toMatchObject({ status: "failed" });
    expect((await draft(f.draftId)).lastError).toMatch(/do-not-contact list/);
    expect(fakeMail().sent.filter((m) => m.to === "f@foxtrot.example")).toHaveLength(0);
  });

  it("matches replies, bounces and automatic answers to the right business and ignores everything else", async () => {
    const a = await seed("Alpha Air", "office@alpha.example");
    const b = await seed("Bravo Air", "hello@bravo.example");
    const c = await seed("Charlie Air", "c@charlie.example");
    const d = await seed("Delta Air", "d@delta.example");
    const e = await seed("Echo Air", "e@echo.example");
    await sendCampaign(campaignId);
    await due();
    await drainQueue(["send_email"]);
    const id = async (x: { draftId: string }) => (await draft(x.draftId)).messageId!;

    deliverToFakeInbox({ from: { address: "newsletter@somewhere.example" }, subject: "Weekly news", text: "Unrelated mail." });
    deliverToFakeInbox({ from: { address: "maria@alpha.example", name: "Maria" }, subject: "Re: Idea for Alpha Air", inReplyTo: await id(a), text: "Sounds interesting, can we talk Thursday?\n\nOn Wed Ivan wrote:\n> Hi team" });
    deliverToFakeInbox({ from: { address: "hello@bravo.example" }, subject: "Re: Idea for Bravo Air", references: [await id(b)], text: "Please remove me from your list." });
    deliverToFakeInbox({ from: { address: "c@charlie.example" }, subject: "Automatic reply: Idea for Charlie Air", inReplyTo: await id(c), headers: { "auto-submitted": "auto-replied" }, text: "I am out of the office until Monday." });
    deliverToFakeInbox({ from: { address: "mailer-daemon@googlemail.com" }, subject: "Delivery Status Notification (Failure)", text: `Address not found. Your message to d@delta.example couldn't be delivered. Status: 5.1.1\nMessage-ID: ${await id(d)}` });
    deliverToFakeInbox({ from: { address: "e@echo.example" }, subject: "your email", text: "Got your note. Not now, maybe next year." }); // a new thread from an address we wrote to

    const r = await syncMailbox();
    expect(r).toEqual({ fetched: 6, replies: 3, autoReplies: 1, bounces: 1, ignored: 1 });
    const inbound = await db.select().from(inboundEmails).all();
    expect(inbound).toHaveLength(5); // the unrelated message was never stored
    const of = (bid: string) => inbound.find((x) => x.businessId === bid)!;
    expect(of(a.id)).toMatchObject({ kind: "reply", matchedBy: "thread", fromEmail: "maria@alpha.example", draftId: a.draftId });
    expect(of(e.id)).toMatchObject({ kind: "reply", matchedBy: "address" });
    expect(of(c.id).kind).toBe("auto_reply");
    expect(of(d.id).kind).toBe("bounce");
    expect([await stage(a.id), await stage(b.id), await stage(c.id), await stage(d.id), await stage(e.id)]).toEqual(["replied", "replied", "contacted", "qualified", "replied"]);
    expect((await draft(d.draftId)).status).toBe("bounced");
    expect(await isSuppressed("d@delta.example")).toBe(true);
    // A second sync finds nothing new and stores nothing twice.
    expect((await syncMailbox()).fetched).toBe(0);
    expect(await db.select().from(inboundEmails).all()).toHaveLength(5);

    // Classification: the opt-out is recognised without a model and honoured at once; the others go to the model.
    resetEnv({ ...env, ANTHROPIC_API_KEY: "test-key" });
    callStructured.mockImplementation(async (call: { user: string }) => ({ data: /Thursday/.test(call.user) ? { category: "wants_meeting", confidence: 0.93, summary: "They would like to talk on Thursday.", suggested_reply: "Thursday works. Would [time] suit you?" } : { category: "not_now", confidence: 0.8, summary: "Not now, maybe next year.", suggested_reply: "" }, model: "reply-model", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 } }));
    expect(await drainQueue(["process_reply"])).toBe(3);
    expect(callStructured).toHaveBeenCalledTimes(2);
    const after = Object.fromEntries((await db.select().from(inboundEmails).all()).map((x) => [x.businessId, x]));
    expect(after[a.id]).toMatchObject({ classification: "wants_meeting", classifiedBy: "reply-model", suggestedReply: "Thursday works. Would [time] suit you?" });
    expect(after[a.id].bodyText).toContain("On Wed Ivan wrote:"); // the original message is kept whole
    expect((callStructured.mock.calls.find((x) => /Thursday/.test((x[0] as { user: string }).user))![0] as { user: string }).user).not.toContain("> Hi team"); // the model reads the reply without the quoted original
    expect(after[b.id]).toMatchObject({ classification: "unsubscribe", classifiedBy: "rules" });
    expect(await isSuppressed("hello@bravo.example")).toBe(true);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, a.id)).get())!.nextAction).toBe("Schedule the meeting they asked for: an answer is written under Outreach");
    // The answer is an email of its own, in the thread, to the person who wrote; a gap left for a time holds it back.
    const answer = (await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.businessId, a.id), eq(outreachDrafts.step, 9))).get())!;
    expect(answer).toMatchObject({ status: "needs_review", toEmail: "maria@alpha.example", inReplyTo: after[a.id].messageId, inboundId: after[a.id].id, body: "Thursday works. Would [time] suit you?", subject: "Idea for Alpha Air" });
    expect(answer.validation!.issues.map((i) => i.code)).toEqual(["placeholder"]);
    // An automatic reply postpones the next email by a week; "not now" plans one check-back.
    expect((await db.select().from(prospects).where(eq(prospects.businessId, c.id)).get())!.holdUntil).toBeTruthy();
    expect((await db.select().from(prospects).where(eq(prospects.businessId, e.id)).get())!.recontactAt).toBeTruthy();
    // The operator can correct a classification; an opt-out set by hand is honoured the same way.
    await applyReplyClassification(after[e.id].id, "unsubscribe", "operator");
    expect((await db.select().from(inboundEmails).where(eq(inboundEmails.id, after[e.id].id)).get())!).toMatchObject({ classification: "unsubscribe", classifiedBy: "operator" });
    expect(await isSuppressed("e@echo.example")).toBe(true);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, e.id)).get())!.recontactAt).toBeNull(); // an opt-out cancels the check-back
    expect((await db.select().from(suppressions).all()).map((s) => s.reason).sort()).toEqual(["bounced", "unsubscribed", "unsubscribed"]);
  });

  it("drafts one follow-up for an unanswered email after the working days set, and sends it in the same thread", async () => {
    resetEnv({ ...env, ANTHROPIC_API_KEY: "test-key" });
    const a = await seed("Alpha Air", "office@alpha.example");
    const b = await seed("Bravo Air", "hello@bravo.example");
    const seedResearch = async (businessId: string) => {
      const inv = newId();
      await db.insert(investigations).values({ id: inv, businessId, status: "done" }).run();
      await db.insert(facts).values({ id: newId(), businessId, key: "maintenance_plans", status: "verified", value: "Comfort Club", evidenceQuote: "Join our Comfort Club", sourceUrl: "https://x.example/", method: "ai" }).run();
      await db.insert(observations).values({ id: newId(), businessId, ref: "o1", kind: "process", statement: "Replacements start with a free in-home estimate.", evidenceQuote: "free in-home estimate", sourceUrl: "https://x.example/" }).run();
      await db.insert(opportunities).values({ id: newId(), investigationId: inv, businessId, category: "online_booking", title: "Estimate visit scheduling", problemHypothesis: "h", proposedSolution: "s", supportingFactKeys: ["o1"], assumptions: [], validationQuestions: [], implementationEffort: "small", reusability: "high", risks: [], attractivenessScore: 80, confidenceScore: 75, scoreBreakdown: { attractiveness: [], confidence: [], notes: [] }, rank: 1, source: "ai", role: "primary" }).run();
    };
    await seedResearch(a.id);
    await seedResearch(b.id);
    await sendCampaign(campaignId);
    await due();
    await drainQueue(["send_email"]);
    expect((await runScheduler()).followUps).toBe(0); // too early
    const longAgo = new Date(Date.now() - 9 * 86_400_000).toISOString(); // nine days back always spans at least five working days
    await db.update(outreachDrafts).set({ sentAt: longAgo }).run();
    // Bravo answered in the meantime: no follow-up for them.
    deliverToFakeInbox({ from: { address: "hello@bravo.example" }, inReplyTo: (await draft(b.draftId)).messageId!, text: "Thanks, tell me more." });
    await syncMailbox();
    const tick = await runScheduler();
    expect(tick.followUps).toBe(1);
    expect((await runScheduler()).followUps).toBe(0); // not queued twice
    callStructured.mockImplementation(async (call: { stage: string }) =>
      call.stage === "outreach"
        ? { data: { subject: "ignored", body: "Hi team,\n\nOne more thought on the in-home estimates: would it help if customers could pick the visit slot themselves? If this isn't a priority, no worries at all, and I'm happy to talk whenever it suits.", claims: [] }, model: "writer", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 } }
        : { data: { statements: [], tone_problems: [] }, model: "checker", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.002 } },
    );
    expect(await drainQueue(["generate_outreach"])).toBe(1);
    const first = await draft(a.draftId);
    const follow = (await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.businessId, a.id), eq(outreachDrafts.step, 1))).get())!;
    expect(follow).toMatchObject({ status: "ready", subject: "Idea for Alpha Air", inReplyTo: first.messageId });
    expect(await stage(a.id)).toBe("contacted"); // a follow-up waiting for review does not move the business
    // It is sent only after approval, as a reply in the first email's thread.
    await db.update(outreachDrafts).set({ status: "approved" }).where(eq(outreachDrafts.id, follow.id)).run();
    await sendCampaign(follow.campaignId!);
    await due();
    await drainQueue(["send_email"]);
    const out = fakeMail().sent.at(-1)!;
    expect(out).toMatchObject({ to: "office@alpha.example", subject: "Re: Idea for Alpha Air", inReplyTo: first.messageId, references: [first.messageId] });
    expect(businessDaysBetween(new Date(2026, 10, 13), new Date(2026, 10, 16))).toBe(1); // Friday to Monday is one working day
    expect((await db.select().from(activities).where(eq(activities.businessId, a.id)).all()).map((x) => x.content).join(" ")).toMatch(/Follow-up sent/);
  });

  it("researches the best saved leads on its own while the review queue is short, within the daily allowance", async () => {
    resetEnv({ ...env, FIRECRAWL_API_KEY: "test" });
    const mk = async (name: string, leadScore: number, extra: Partial<typeof businesses.$inferInsert> = {}) => {
      const id = newId();
      await db.insert(businesses).values({ id, name, nameNormalized: name.toLowerCase(), industry: "home_services", firstProvider: "google_maps", website: `https://${name.toLowerCase().replace(/\W/g, "")}.example`, leadScore, kind: "independent", status: "new", ...extra }).run();
      return id;
    };
    const best = await mk("Best Lead", 96);
    await mk("Second Lead", 90);
    await mk("Third Lead", 80);
    await mk("Fourth Lead", 70);
    await mk("Chain Outlet", 99, { kind: "chain" });
    await mk("No Site", 99, { website: null });
    await saveSettings({ researchPerDay: 2 });
    const tick = await runScheduler();
    expect(tick.research).toBe(2);
    const queued = await db.select().from(jobs).where(eq(jobs.type, "investigate_business")).all();
    expect(queued.map((j) => j.payload.businessId)).toContain(best);
    expect((await db.select().from(businesses).where(eq(businesses.status, "queued")).all()).map((b) => b.name).sort()).toEqual(["Best Lead", "Second Lead"]);
    expect((await runScheduler()).research).toBe(0); // the allowance for today is taken by what is already queued
    // Switched off, or with enough emails already waiting, nothing is researched.
    await db.delete(jobs).run();
    await saveSettings({ autoResearch: "off", researchPerDay: 10 });
    expect((await runScheduler()).research).toBe(0);
    await saveSettings({ autoResearch: "on", readyBuffer: 1 });
    await seed("Waiting Co", "w@waiting.example", "ready");
    expect((await runScheduler()).research).toBe(0);
  });
});
