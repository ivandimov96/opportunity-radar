/**
 * The automation the operator can switch on: sending without a click (with its
 * trust gate, waiting time, warm-up and safety pause), answers to replies as
 * emails of their own, the longer sequence, and searches the app starts itself.
 * Everything runs through the real queue with the in-memory mailbox; the model
 * is mocked at the client boundary and no search provider is ever called.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const callStructured = vi.fn();
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...orig, callStructured: (...args: unknown[]) => callStructured(...args) };
});

import { useTempDb, resetEnv } from "../helpers";
import { businesses, facts, inboundEmails, investigations, jobs, observations, opportunities, outreachDrafts, pages, prospects, searches } from "@/db/schema";
import { newId } from "@/lib/ids";
import { drainQueue } from "@/lib/jobs/worker";
import { runScheduler } from "@/lib/jobs/scheduler";
import { deliverToFakeInbox, fakeMail, resetFakeMail } from "@/lib/mail/fake";
import { syncMailbox } from "@/lib/mail/sync";
import { autopilotStatus, runAutopilot, TRUST_MIN_MANUAL } from "@/lib/outreach/autopilot";
import { autopilotPause, resumeAutopilot } from "@/lib/outreach/autopilot-state";
import { openCampaign } from "@/lib/outreach/campaigns";
import { saveDraftEdit } from "@/lib/outreach/drafts";
import { automaticSendHold } from "@/lib/outreach/eligibility";
import { dailyCapInForce } from "@/lib/outreach/limits";
import { cancelQueued, sendPreflight } from "@/lib/outreach/send";
import { ensureProspect, setStage } from "@/lib/pipeline/prospects";
import { getSettings, saveSettings } from "@/lib/settings";

const BODY = "Hi team,\n\nI noticed that every replacement starts with a free in-home estimate. Would a short mock-up of a booking page be useful?";
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

describe("autopilot", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  let campaignId: string;
  const env = { MAIL_PROVIDER: "fake", MAIL_USER: "ivan@dimov.example" };
  const seed = async (name: string, email: string, status = "ready", extra: Partial<typeof outreachDrafts.$inferInsert> = {}) => {
    const id = newId();
    await db.insert(businesses).values({ id, name, nameNormalized: name.toLowerCase(), industry: "home_services", firstProvider: "csv", country: "US", status: "profiled", verdict: "qualified", email, emailStatus: "valid", emailSource: "site" }).run();
    await ensureProspect(id, status === "sent" || status === "bounced" ? "contacted" : "ready_to_contact");
    const draftId = newId();
    await db.insert(outreachDrafts).values({ id: draftId, businessId: id, campaignId, step: 0, style: "personal", toEmail: email, subject: `Idea for ${name}`, body: BODY, claims: [], warnings: [], status, validation: { passed: true, issues: [], checkedAt: new Date().toISOString() }, ...(status === "sent" || status === "bounced" ? { messageId: `<${draftId}@dimov.example>`, sentAt: daysAgo(20) } : {}), ...extra }).run();
    return { id, draftId };
  };
  /** The operator's own track record: emails approved and sent by hand, long enough ago that the mailbox is warm. */
  const sentByHand = async (n: number, status = "sent") => {
    const out: { id: string; draftId: string }[] = [];
    for (let i = 0; i < n; i++) out.push(await seed(`Past ${status} ${i}`, `p${status}${i}@past${i}.example`, status));
    return out;
  };
  const draft = async (id: string) => (await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, id)).get())!;
  const due = async () => db.update(jobs).set({ scheduledAt: new Date(Date.now() - 1000).toISOString() }).where(and(eq(jobs.type, "send_email"), eq(jobs.status, "queued"))).run();
  const seedResearch = async (businessId: string) => {
    const inv = newId();
    await db.insert(investigations).values({ id: inv, businessId, status: "done" }).run();
    await db.insert(facts).values({ id: newId(), businessId, key: "maintenance_plans", status: "verified", value: "Comfort Club", evidenceQuote: "Join our Comfort Club", sourceUrl: "https://x.example/", method: "ai" }).run();
    await db.insert(observations).values({ id: newId(), businessId, ref: "o1", kind: "process", statement: "Replacements start with a free in-home estimate.", evidenceQuote: "free in-home estimate", sourceUrl: "https://x.example/" }).run();
    await db.insert(opportunities).values({ id: newId(), investigationId: inv, businessId, category: "online_booking", title: "Estimate visit scheduling", problemHypothesis: "h", proposedSolution: "s", supportingFactKeys: ["o1"], assumptions: [], validationQuestions: [], implementationEffort: "small", reusability: "high", risks: [], attractivenessScore: 80, confidenceScore: 75, scoreBreakdown: { attractiveness: [], confidence: [], notes: [] }, rank: 1, source: "ai", role: "primary" }).run();
  };

  beforeEach(async () => {
    resetEnv(env);
    db = await useTempDb();
    resetFakeMail();
    callStructured.mockReset();
    await saveSettings({ senderName: "Ivan Dimov", senderCompany: "Dimov Software", postalAddress: "1 Main St, Austin, TX 78701", sendWindowStart: 0, sendWindowEnd: 24, sendSpacingSeconds: 20, dailySendCap: 20 });
    campaignId = (await openCampaign()).id;
  });

  it("sends nothing on its own by default, and nothing before the operator has sent enough by hand", async () => {
    expect((await getSettings()).sendMode).toBe("manual");
    const a = await seed("Alpha Air", "office@alpha.example", "ready", { updatedAt: daysAgo(2) });
    expect((await runScheduler()).autopilot).toEqual({ approved: 0, queued: 0 });
    expect((await draft(a.draftId)).status).toBe("ready");

    await saveSettings({ sendMode: "auto" });
    await sentByHand(TRUST_MIN_MANUAL - 1);
    const status = await autopilotStatus();
    expect(status).toMatchObject({ mode: "auto", active: false, sentByHand: TRUST_MIN_MANUAL - 1 });
    expect(status.waitingFor).toMatch(/after you have sent 20 emails yourself \(19 so far\)/);
    expect(await runAutopilot()).toEqual({ approved: 0, queued: 0 });
    expect((await draft(a.draftId)).status).toBe("ready");
    expect(fakeMail().sent).toHaveLength(0);
  });

  it("holds a ready email for the waiting time, then sends it; an edit restarts the wait and a failed check always waits for a person", async () => {
    await saveSettings({ sendMode: "hold", holdHours: 4 });
    await sentByHand(TRUST_MIN_MANUAL);
    const fresh = await seed("Alpha Air", "office@alpha.example", "ready", { updatedAt: hoursAgo(1) });
    const ripe = await seed("Bravo Air", "hello@bravo.example", "ready", { updatedAt: hoursAgo(5) });
    const flagged = await seed("Charlie Air", "c@charlie.example", "needs_review", { updatedAt: daysAgo(3), validation: { passed: false, issues: [{ severity: "block", code: "placeholder", message: "x" }], checkedAt: new Date().toISOString() } });
    const excluded = await seed("Delta Air", "d@delta.example", "excluded", { updatedAt: daysAgo(3) });
    expect((await autopilotStatus()).active).toBe(true);

    expect(await runAutopilot()).toEqual({ approved: 1, queued: 1 });
    expect(await draft(ripe.draftId)).toMatchObject({ status: "queued", approvedBy: "autopilot" });
    expect([(await draft(fresh.draftId)).status, (await draft(flagged.draftId)).status, (await draft(excluded.draftId)).status]).toEqual(["ready", "needs_review", "excluded"]);
    await due();
    await drainQueue(["send_email"]);
    expect(fakeMail().sent.map((m) => m.to)).toEqual(["hello@bravo.example"]);
    // What the autopilot sent does not count as the operator's own track record.
    expect((await autopilotStatus()).sentByHand).toBe(TRUST_MIN_MANUAL);

    // The operator edits the waiting email after its time would have been up: the wait starts again from the edit.
    await db.update(outreachDrafts).set({ updatedAt: hoursAgo(5) }).where(eq(outreachDrafts.id, fresh.draftId)).run();
    expect((await saveDraftEdit(fresh.draftId, "Idea for Alpha Air", `${BODY} Happy to send it over.`)).ok).toBe(true);
    expect(await runAutopilot()).toEqual({ approved: 0, queued: 0 });
    // In "auto" mode there is no wait.
    await saveSettings({ sendMode: "auto" });
    expect(await runAutopilot()).toEqual({ approved: 1, queued: 1 });
    expect((await draft(flagged.draftId)).status).toBe("needs_review");
  });

  it("pauses itself when emails bounce, stays paused until the operator resumes, and stops when a batch is stopped", async () => {
    await saveSettings({ sendMode: "auto" });
    await sentByHand(TRUST_MIN_MANUAL);
    await sentByHand(2, "bounced");
    const a = await seed("Alpha Air", "office@alpha.example");
    const run = await runAutopilot();
    expect(run.paused).toMatch(/2 of the last 22 emails bounced/);
    expect((await draft(a.draftId)).status).toBe("ready");
    expect((await autopilotPause())!.reason).toMatch(/paused until you resume/);
    expect((await autopilotStatus()).active).toBe(false);
    expect(await runAutopilot()).toEqual({ approved: 0, queued: 0 });

    // Resuming starts the count again: the old bounces do not trip it a second time.
    await resumeAutopilot();
    expect(await autopilotPause()).toBeNull();
    expect(await runAutopilot()).toEqual({ approved: 1, queued: 1 });
    expect((await draft(a.draftId)).status).toBe("queued");

    // "Stop sending" takes the email back AND pauses the autopilot, or it would be queued again within the minute.
    expect(await cancelQueued((await draft(a.draftId)).campaignId!)).toBe(1);
    expect((await autopilotPause())!.reason).toMatch(/You stopped a batch/);
    expect(await runAutopilot()).toEqual({ approved: 0, queued: 0 });
    expect(fakeMail().sent).toHaveLength(0);
  });

  it("leaves a UK business that does not show it is a company to the operator", async () => {
    await saveSettings({ sendMode: "auto", allowedCountries: ["US", "GB"] });
    await sentByHand(TRUST_MIN_MANUAL);
    const trader = await seed("Dave's Signs", "dave@davesigns.example");
    const named = await seed("Harbour Signs Ltd", "hello@harboursigns.example");
    const footer = await seed("Northern Signs", "info@northernsigns.example");
    await db.update(businesses).set({ country: "GB" }).where(eq(businesses.status, "profiled")).run();
    const inv = newId();
    await db.insert(investigations).values({ id: inv, businessId: footer.id, status: "done" }).run();
    await db.insert(pages).values({ id: newId(), investigationId: inv, businessId: footer.id, url: "https://northernsigns.example/", kind: "home", text: "Northern Signs is registered in England and Wales. Company number 01234567." }).run();
    expect(await automaticSendHold({ id: trader.id, name: "Dave's Signs", country: "GB" })).toMatch(/sole trader/);
    expect(await automaticSendHold({ id: trader.id, name: "Dave's Signs", country: "US" })).toBeNull();
    expect(await runAutopilot()).toEqual({ approved: 2, queued: 2 });
    expect([(await draft(trader.draftId)).status, (await draft(named.draftId)).status, (await draft(footer.draftId)).status]).toEqual(["ready", "queued", "queued"]);
  });

  it("starts a new mailbox low and raises the daily limit week by week, only while it sends on its own", async () => {
    const s = await getSettings();
    const first = await seed("Past 0", "p0@past0.example", "sent", { sentAt: daysAgo(1) });
    expect(await dailyCapInForce({ ...s, sendMode: "manual" })).toEqual({ cap: 20, warmingUp: false });
    expect(await dailyCapInForce({ ...s, sendMode: "hold" })).toEqual({ cap: 10, warmingUp: true });
    await db.update(outreachDrafts).set({ sentAt: daysAgo(8) }).where(eq(outreachDrafts.id, first.draftId)).run();
    expect(await dailyCapInForce({ ...s, sendMode: "auto" })).toEqual({ cap: 15, warmingUp: true });
    await db.update(outreachDrafts).set({ sentAt: daysAgo(30) }).where(eq(outreachDrafts.id, first.draftId)).run();
    expect(await dailyCapInForce({ ...s, sendMode: "auto" })).toEqual({ cap: 20, warmingUp: false });
    // The pre-send summary plans with the limit in force.
    await saveSettings({ sendMode: "hold" });
    await db.update(outreachDrafts).set({ sentAt: daysAgo(1) }).where(eq(outreachDrafts.id, first.draftId)).run();
    for (let i = 0; i < 12; i++) await seed(`New ${i}`, `n${i}@new${i}.example`, "approved");
    const pre = (await sendPreflight(campaignId))!;
    expect(pre.dailyCap).toEqual({ cap: 10, warmingUp: true });
    expect(pre.plan!.perDay.map(([, n]) => n)).toEqual([10, 2]);
  });

  it("writes an answer to a reply as an email of its own and sends it to the person who wrote, when answers on autopilot are on", async () => {
    resetEnv({ ...env, ANTHROPIC_API_KEY: "test-key" });
    await saveSettings({ sendMode: "auto", bookingLink: "https://cal.example/ivan" });
    const past = await sentByHand(TRUST_MIN_MANUAL);
    const [a, b] = past;
    const msgId = async (x: { draftId: string }) => (await draft(x.draftId)).messageId!;
    deliverToFakeInbox({ from: { address: "maria@past0.example", name: "Maria" }, subject: "Re: Idea", inReplyTo: await msgId(a), text: "Sounds good, can we have a quick call?" });
    deliverToFakeInbox({ from: { address: "tom@past1.example", name: "Tom" }, subject: "Re: Idea", inReplyTo: await msgId(b), text: "Yes please, send the mock-up over." });
    await syncMailbox();
    callStructured.mockImplementation(async (call: { user: string }) => ({
      data: /quick call/.test(call.user)
        ? { category: "wants_meeting", confidence: 0.95, summary: "They would like a call.", suggested_reply: "Hi Maria,\n\nGlad to. Pick any slot that suits you here: https://cal.example/ivan" }
        : { category: "interested", confidence: 0.95, summary: "They want the mock-up.", suggested_reply: "Hi Tom,\n\nGreat, I'll put it together and send it over shortly." },
      model: "reply-model",
      usage,
    }));
    expect(await drainQueue(["process_reply"])).toBe(2);
    const answers = await db.select().from(outreachDrafts).where(eq(outreachDrafts.step, 9)).all();
    const meeting = answers.find((d) => d.businessId === a.id)!;
    const yes = answers.find((d) => d.businessId === b.id)!;
    expect(meeting).toMatchObject({ status: "ready", toEmail: "maria@past0.example", subject: "Idea for Past sent 0", inReplyTo: (await db.select().from(inboundEmails).where(eq(inboundEmails.businessId, a.id)).get())!.messageId });
    // "Yes, send it" can only be answered by the operator: the thing offered has to be made first.
    expect(yes.status).toBe("needs_review");
    expect(yes.validation).toMatchObject({ passed: true });
    expect(yes.validation!.issues).toEqual([{ severity: "warn", code: "needs_you", message: expect.stringMatching(/They said yes/) }]);

    // Answers stay with the operator until "answers on autopilot" is switched on.
    expect(await runAutopilot()).toEqual({ approved: 0, queued: 0 });
    await saveSettings({ autoAnswer: true });
    expect(await runAutopilot()).toEqual({ approved: 1, queued: 1 });
    await due();
    await drainQueue(["send_email"]);
    const out = fakeMail().sent.at(-1)!;
    expect(out).toMatchObject({ to: "maria@past0.example", subject: "Re: Idea for Past sent 0", inReplyTo: meeting.inReplyTo });
    expect(out.text).toContain("https://cal.example/ivan");
    expect(out.text).toContain("Ivan Dimov");
    expect(out.text.trim().endsWith("1 Main St, Austin, TX 78701")).toBe(true); // the answer ends with the signature
    expect((await db.select().from(inboundEmails).where(eq(inboundEmails.businessId, a.id)).get())!.handledAt).toBeTruthy();
    expect((await draft(yes.id)).status).toBe("needs_review");
  });

  it("writes a last note after an unanswered follow-up and one check-back after a \"not now\"", async () => {
    resetEnv({ ...env, ANTHROPIC_API_KEY: "test-key" });
    const a = await seed("Alpha Air", "office@alpha.example", "sent", { sentAt: daysAgo(30) });
    const b = await seed("Bravo Air", "hello@bravo.example", "sent", { sentAt: daysAgo(30) });
    await seedResearch(a.id);
    await seedResearch(b.id);
    // Alpha: the follow-up went out nine days ago and nobody answered.
    await db.insert(outreachDrafts).values({ id: newId(), businessId: a.id, campaignId, step: 1, style: "personal", toEmail: "office@alpha.example", subject: "Idea for Alpha Air", body: "Hi team,\n\nOne more thought.", claims: [], warnings: [], status: "sent", messageId: "<fu@dimov.example>", sentAt: daysAgo(9) }).run();
    // Bravo: said "not now" three months ago; the check-back is due today.
    await db.insert(inboundEmails).values({ id: newId(), businessId: b.id, draftId: b.draftId, messageId: "<in@bravo.example>", fromEmail: "hello@bravo.example", bodyText: "Not now, try us in the spring.", receivedAt: daysAgo(91), kind: "reply", classification: "not_now", classificationSummary: "Not now; suggested trying again in the spring." }).run();
    await setStage(b.id, "replied");
    await db.update(prospects).set({ recontactAt: daysAgo(1) }).where(eq(prospects.businessId, b.id)).run();

    const tick = await runScheduler();
    expect(tick).toMatchObject({ followUps: 1, checkBacks: 1 });
    const prompts: string[] = [];
    callStructured.mockImplementation(async (call: { stage: string; system: string; user: string }) => {
      if (call.stage !== "outreach") return { data: { statements: [], tone_problems: [] }, model: "checker", usage };
      prompts.push(`${call.system}\n${call.user}`);
      return /last short note/.test(call.system)
        ? { data: { subject: "x", body: "Hi team,\n\nThis is my last note on the booking idea. If the timing is ever right, just reply and I'll pick it up from there.", claims: [] }, model: "writer", usage }
        : { data: { subject: "x", body: "Hi team,\n\nYou mentioned the timing wasn't right back then. Is the booking idea worth a look now? Still not the time is a perfectly good answer, and I'm glad to send a short mock-up if it helps.", claims: [] }, model: "writer", usage };
    });
    expect(await drainQueue(["generate_outreach"])).toBe(2);
    const last = (await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.businessId, a.id), eq(outreachDrafts.step, 2))).get())!;
    const back = (await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.businessId, b.id), eq(outreachDrafts.step, 3))).get())!;
    expect(last).toMatchObject({ status: "ready", subject: "Idea for Alpha Air", inReplyTo: (await draft(a.draftId)).messageId });
    expect(back).toMatchObject({ status: "ready", subject: "Idea for Bravo Air", inReplyTo: (await draft(b.draftId)).messageId });
    expect(prompts.find((p) => /last short note/.test(p))).toContain("THE FOLLOW-UP (also unanswered");
    expect(prompts.find((p) => /check-back/.test(p))).toContain("suggested trying again in the spring");
    expect((await db.select().from(prospects).where(eq(prospects.businessId, b.id)).get())!.recontactAt).toBeNull();
    // Nothing is written twice, and the sequence ends with the last note.
    expect(await runScheduler()).toMatchObject({ followUps: 0, checkBacks: 0 });

    // With one follow-up configured, no last note is ever due.
    await db.update(outreachDrafts).set({ status: "archived" }).where(eq(outreachDrafts.id, last.id)).run();
    await saveSettings({ followUpCount: 1 });
    expect((await runScheduler()).followUps).toBe(0);
  });

  it("does not send a queued follow-up when the business answered in the meantime, and waits after an out-of-office reply", async () => {
    resetEnv({ ...env, ANTHROPIC_API_KEY: "test-key" });
    const a = await seed("Alpha Air", "office@alpha.example", "sent", { sentAt: daysAgo(9) });
    const b = await seed("Bravo Air", "hello@bravo.example", "sent", { sentAt: daysAgo(9) });
    await seedResearch(b.id);
    const followId = newId();
    await db.insert(outreachDrafts).values({ id: followId, businessId: a.id, campaignId, step: 1, style: "personal", toEmail: "office@alpha.example", subject: "Idea for Alpha Air", body: BODY, claims: [], warnings: [], status: "approved", validation: { passed: true, issues: [], checkedAt: new Date().toISOString() } }).run();
    const { sendCampaign } = await import("@/lib/outreach/send");
    await sendCampaign(campaignId);
    deliverToFakeInbox({ from: { address: "office@alpha.example" }, inReplyTo: (await draft(a.draftId)).messageId!, text: "Thanks, tell me more." });
    deliverToFakeInbox({ from: { address: "hello@bravo.example" }, subject: "Automatic reply", inReplyTo: (await draft(b.draftId)).messageId!, headers: { "auto-submitted": "auto-replied" }, text: "I am away until next week." });
    await syncMailbox();
    await due();
    await drainQueue(["send_email"]);
    expect(fakeMail().sent).toHaveLength(0);
    expect(await draft(followId)).toMatchObject({ status: "failed", lastError: expect.stringMatching(/They answered in the meantime/) });
    // Bravo's follow-up would be due, but the out-of-office reply holds it for a week.
    expect((await runScheduler()).followUps).toBe(0);
    await db.update(prospects).set({ holdUntil: daysAgo(1) }).where(eq(prospects.businessId, b.id)).run();
    expect((await runScheduler()).followUps).toBe(1);
  });

  it("starts a search from the targets when few businesses wait for research: one city at a time, largest first, within the day's allowance", async () => {
    resetEnv({ ...env, SERPER_API_KEY: "test-key" });
    expect((await runScheduler()).search).toBeNull(); // off by default
    await saveSettings({ autoSearch: true, searchTargets: "sign makers | GB\nnot a target\n", searchesPerDay: 2 });
    expect((await getSettings()).searchTargets).toEqual([{ what: "sign makers", country: "GB", region: "" }]);
    const first = await runScheduler();
    expect(first.search).toBe("sign makers · London, ENG");
    const row = (await db.select().from(searches).get())!;
    expect(row).toMatchObject({ industry: "generic", country: "GB", city: "London", maxResults: 20, requireWebsite: true, autoInvestigate: false, status: "queued" });
    expect(row.filters).toMatchObject({ customCategory: "sign makers", auto: true, skipKnown: true });
    expect(await db.select().from(jobs).where(eq(jobs.type, "discover_search")).all()).toHaveLength(1);
    // While that search is still running, no second one starts.
    expect((await runScheduler()).search).toBeNull();
    await db.update(jobs).set({ status: "done" }).where(eq(jobs.type, "discover_search")).run();
    // The next one takes the next city, never the same one again.
    const second = await runScheduler();
    expect(second.search).toMatch(/^sign makers · (?!London)/);
    await db.update(jobs).set({ status: "done" }).where(eq(jobs.type, "discover_search")).run();
    // Two a day were allowed.
    expect((await runScheduler()).search).toBeNull();
    expect(await db.select().from(searches).all()).toHaveLength(2);
  });

  it("does not search while enough businesses wait for research or the search credits are used up", async () => {
    resetEnv({ ...env, SERPER_API_KEY: "test-key", SERPER_CREDIT_BUDGET: "2" });
    await saveSettings({ autoSearch: true, searchTargets: "sign makers | GB", autoResearch: false });
    expect((await runScheduler()).search).toBeNull(); // 3 credits needed, 2 left
    resetEnv({ ...env, SERPER_API_KEY: "test-key" });
    for (let i = 0; i < 15; i++) await db.insert(businesses).values({ id: newId(), name: `Shop ${i}`, nameNormalized: `shop ${i}`, industry: "generic", firstProvider: "csv", country: "GB", status: "new", website: `https://shop${i}.example` }).run();
    expect((await runScheduler()).search).toBeNull();
  });
});
