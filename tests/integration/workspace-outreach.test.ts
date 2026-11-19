/**
 * Emails, batches, sending, replies, the pipeline, job rows and model usage
 * belong to a workspace. Two workspaces share one database here: HOME is the
 * first workspace (the one the mailbox belongs to), AWAY is another one. What
 * HOME approves, sends, counts or lists never includes AWAY's, an id from the
 * other side is "not found", and AWAY is refused sending and inbox reading
 * until it has a mailbox of its own. The mailbox is the in-memory one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";

// The actions are called directly: there is no request, so "who is signed in" and the framework's cache are stubbed.
// Which workspace acts is still decided by `runInWorkspace`, exactly as for a job.
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), requireOwner: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/jobs/kick", () => ({ kickWorker: () => {} }));

import { resetEnv, useTempDb } from "../helpers";
import { cancelJobAction, retryJobAction, sendTestEmailAction, syncMailboxAction } from "@/app/actions";
import { FIRST_WORKSPACE_ID, activities, aiUsage, businesses, campaigns, inboundEmails, investigations, jobs, opportunities, outreachDrafts, prospects } from "@/db/schema";
import { callStructured } from "@/lib/ai/client";
import { _setOpenAiFetch } from "@/lib/ai/providers/openai";
import { newId, nowIso } from "@/lib/ids";
import { latestInvestigation } from "@/lib/jobs/handlers";
import { cancelQueuedJob, enqueueJob, getJob, jobCounts } from "@/lib/jobs/queue";
import { runScheduler } from "@/lib/jobs/scheduler";
import { drainQueue } from "@/lib/jobs/worker";
import { NO_WORKSPACE_MAILBOX, mailboxFor } from "@/lib/mail";
import { deliverToFakeInbox, fakeMail, resetFakeMail } from "@/lib/mail/fake";
import { syncMailbox } from "@/lib/mail/sync";
import { listCampaigns, openCampaign } from "@/lib/outreach/campaigns";
import { approveAllReady, approveDraft, excludeDraft, restoreDraft, saveDraftEdit, subjectIdeasFor, unapproveDraft } from "@/lib/outreach/drafts";
import { contactBlockers } from "@/lib/outreach/eligibility";
import { chooseIdea } from "@/lib/outreach/ideas";
import { campaignHistory, draftDetail, outreachOverview } from "@/lib/outreach/queries";
import { cancelQueued, dayKey, retryFailed, sendCampaign, sendPreflight, sentToday, usedByDay } from "@/lib/outreach/send";
import { ensureProspect, logActivity, markReplied, moveOnBoard, recentActivities, setNextAction, setStage } from "@/lib/pipeline/prospects";
import { recentJobs } from "@/lib/queries";
import { loadStoredPages } from "@/lib/research/stored";
import { getSettings, saveSettings } from "@/lib/settings";
import { runInWorkspace } from "@/lib/workspace";

const HOME = FIRST_WORKSPACE_ID;
const AWAY = "ws-meadow";
const BODY = "Hi team,\n\nI noticed that every replacement starts with a free in-home estimate. Would a short call be useful?";

describe("workspace isolation: emails, batches, sending and the pipeline", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;

  /** A qualified business with one email in its workspace's open batch. */
  const seed = (ws: string, name: string, email: string, status = "approved", extra: Partial<typeof outreachDrafts.$inferInsert> = {}) =>
    runInWorkspace(ws, async () => {
      const id = newId();
      await db.insert(businesses).values({ id, workspaceId: ws, name, nameNormalized: name.toLowerCase(), industry: "home_services", firstProvider: "csv", country: "GB", status: "profiled", verdict: "qualified", email, emailStatus: "valid", emailSource: "site" }).run();
      await ensureProspect(id, "ready_to_contact");
      const draftId = newId();
      const campaignId = (await openCampaign()).id;
      await db.insert(outreachDrafts).values({ id: draftId, businessId: id, campaignId, step: 0, style: "personal", toEmail: email, subject: `Idea for ${name}`, body: BODY, claims: [], warnings: [], status, validation: { passed: true, issues: [], checkedAt: nowIso() }, ...extra }).run();
      return { id, draftId, campaignId };
    });
  const draft = async (id: string) => (await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, id)).get())!;
  const due = () => db.update(jobs).set({ scheduledAt: new Date(Date.now() - 1000).toISOString() }).where(eq(jobs.status, "queued")).run();
  /** Everything of a workspace's business that this slice must not let the other side change. */
  const snapshot = async (businessId: string) =>
    JSON.stringify([
      await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, businessId)).all(),
      await db.select().from(prospects).where(eq(prospects.businessId, businessId)).all(),
      await db.select().from(activities).where(eq(activities.businessId, businessId)).all(),
      await db.select().from(opportunities).where(eq(opportunities.businessId, businessId)).all(),
    ]);

  beforeEach(async () => {
    resetEnv({ MAIL_PROVIDER: "fake", MAIL_USER: "owner@harbour-studio.example" });
    db = await useTempDb();
    resetFakeMail();
    _setOpenAiFetch(null);
    await saveSettings({ senderName: "Nell Harbour", senderCompany: "Harbour Studio", postalAddress: "1 Quay Street, Leeds LS1 1AA", sendWindowStart: 0, sendWindowEnd: 24, sendSpacingSeconds: 20, dailySendCap: 20, allowedCountries: "GB" });
  });

  it("gives each workspace its own open batch and shows batches and emails only to their workspace", async () => {
    const home = await seed(HOME, "Fernhill Joinery", "office@fernhill-joinery.example", "ready");
    const away = await seed(AWAY, "Oakbeck Plumbing", "hello@oakbeck-plumbing.example", "ready");
    expect(home.campaignId).not.toBe(away.campaignId);
    // The open batch is found again, not created again, and is the workspace's own.
    expect((await runInWorkspace(HOME, () => openCampaign())).id).toBe(home.campaignId);
    expect((await runInWorkspace(AWAY, () => openCampaign())).id).toBe(away.campaignId);
    expect(Object.fromEntries((await db.select().from(campaigns).all()).map((c) => [c.id, c.workspaceId]))).toEqual({ [home.campaignId]: HOME, [away.campaignId]: AWAY });

    for (const [ws, mine, theirs] of [[HOME, home, away], [AWAY, away, home]] as const) {
      await runInWorkspace(ws, async () => {
        expect((await listCampaigns()).map((c) => c.id)).toEqual([mine.campaignId]);
        const o = await outreachOverview();
        expect(o.campaign.id).toBe(mine.campaignId);
        expect(o.byTab.ready.map((r) => r.draft.id)).toEqual([mine.draftId]);
        expect(o.counts.ready).toBe(1);
        expect((await draftDetail(mine.draftId))?.draft.id).toBe(mine.draftId);
        expect(await draftDetail(theirs.draftId)).toBeNull();
        expect((await sendPreflight(mine.campaignId))?.counts.ready).toBe(1);
        expect(await sendPreflight(theirs.campaignId)).toBeNull();
      });
    }

    // A sent batch appears in the history of its workspace only.
    await runInWorkspace(HOME, async () => {
      expect(await approveAllReady(home.campaignId)).toBe(1);
      expect(await sendCampaign(home.campaignId)).toMatchObject({ ok: true, queued: 1 });
      expect((await campaignHistory()).map((c) => c.id)).toEqual([home.campaignId]);
    });
    expect(await runInWorkspace(AWAY, () => campaignHistory())).toEqual([]);
  });

  it("approves and sends only the acting workspace's emails, even if another workspace's email sits in the same batch", async () => {
    const h1 = await seed(HOME, "Fernhill Joinery", "office@fernhill-joinery.example", "ready");
    const h2 = await seed(HOME, "Larkmoor Roofing", "info@larkmoor-roofing.example", "ready");
    const a1 = await seed(AWAY, "Oakbeck Plumbing", "hello@oakbeck-plumbing.example", "ready");
    const a2 = await seed(AWAY, "Tarnside Electrics", "desk@tarnside-electrics.example", "approved");
    // As data written before batches had a workspace could look: AWAY's email filed under HOME's batch.
    const stray = await seed(AWAY, "Wrenfield Glazing", "team@wrenfield-glazing.example", "ready", { campaignId: h1.campaignId });
    const strayApproved = await seed(AWAY, "Yarrow Heating", "post@yarrow-heating.example", "approved", { campaignId: h1.campaignId });

    await runInWorkspace(HOME, async () => {
      expect(await approveAllReady(h1.campaignId)).toBe(2);
      expect(await approveAllReady(a1.campaignId)).toBe(0); // AWAY's batch id is not a batch here
      const pre = (await sendPreflight(h1.campaignId))!;
      expect(pre.sendable.map((s) => s.business.name).sort()).toEqual(["Fernhill Joinery", "Larkmoor Roofing"]);
      expect(pre.counts).toEqual({ approved: 2, ready: 0, needsReview: 0, excluded: 0 });
      expect(await sendCampaign(a1.campaignId)).toMatchObject({ ok: false, error: "Batch not found", queued: 0 });
      expect(await sendCampaign(h1.campaignId)).toMatchObject({ ok: true, queued: 2, skipped: 0 });
    });
    expect([(await draft(h1.draftId)).status, (await draft(h2.draftId)).status]).toEqual(["queued", "queued"]);
    // AWAY's emails are exactly as they were: not approved, not queued, not moved to another batch.
    expect([await draft(a1.draftId), await draft(a2.draftId), await draft(stray.draftId), await draft(strayApproved.draftId)].map((d) => [d.status, d.campaignId, d.messageId])).toEqual([
      ["ready", a1.campaignId, null],
      ["approved", a1.campaignId, null],
      ["ready", h1.campaignId, null],
      ["approved", h1.campaignId, null],
    ]);
    expect((await db.select().from(jobs).all()).map((j) => [j.type, j.workspaceId])).toEqual([["send_email", HOME], ["send_email", HOME]]);

    // "Stop" in AWAY, or with HOME's batch id from AWAY, stops nothing of HOME's.
    expect(await runInWorkspace(AWAY, () => cancelQueued(h1.campaignId))).toBe(0);
    expect(await runInWorkspace(AWAY, () => cancelQueued(a1.campaignId))).toBe(0);
    expect((await draft(h1.draftId)).status).toBe("queued");

    await due();
    expect(await drainQueue(["send_email"])).toBe(2);
    expect(fakeMail().sent.map((m) => m.to).sort()).toEqual(["info@larkmoor-roofing.example", "office@fernhill-joinery.example"]);
    expect((await draft(h1.draftId)).status).toBe("sent");
    expect((await db.select().from(campaigns).where(eq(campaigns.id, a1.campaignId)).get())!.status).toBe("open");
    expect((await draft(a2.draftId)).status).toBe("approved");
  });

  it("counts today's emails and checks \"already emailed this address\" inside one workspace", async () => {
    const today = nowIso();
    await seed(HOME, "Fernhill Joinery", "office@fernhill-joinery.example", "sent", { sentAt: today, messageId: "<h1@harbour-studio.example>" });
    await seed(AWAY, "Oakbeck Plumbing", "hello@oakbeck-plumbing.example", "sent", { sentAt: today, messageId: "<a1@meadow.example>" });
    await seed(AWAY, "Tarnside Electrics", "desk@tarnside-electrics.example", "sent", { sentAt: today, messageId: "<a2@meadow.example>" });
    await seed(AWAY, "Wrenfield Glazing", "team@wrenfield-glazing.example", "queued", { scheduledAt: today, messageId: "<a3@meadow.example>" });
    expect(await runInWorkspace(HOME, () => sentToday())).toBe(1);
    expect(await runInWorkspace(AWAY, () => sentToday())).toBe(2);
    expect(await runInWorkspace(HOME, () => usedByDay())).toEqual({ [dayKey(new Date(today))]: 1 });
    expect(await runInWorkspace(AWAY, () => usedByDay())).toEqual({ [dayKey(new Date(today))]: 3 });
    expect(await runInWorkspace("ws-nobody", () => sentToday())).toBe(0);

    // The same company saved by both: AWAY already wrote to its address, HOME did not.
    const settings = await getSettings();
    const homeCopy = await seed(HOME, "Oakbeck Plumbing (ours)", "hello@oakbeck-plumbing.example", "ready");
    const awayCopy = await seed(AWAY, "Oakbeck Plumbing North", "hello@oakbeck-plumbing.example", "ready");
    const biz = async (id: string) => (await db.select().from(businesses).where(eq(businesses.id, id)).get())!;
    expect(await runInWorkspace(HOME, async () => contactBlockers(await biz(homeCopy.id), settings))).toEqual([]);
    expect(await runInWorkspace(AWAY, async () => contactBlockers(await biz(awayCopy.id), settings))).toEqual(["hello@oakbeck-plumbing.example was already emailed for Oakbeck Plumbing."]);
    // So HOME may approve its email to that address; AWAY may not approve a second one.
    expect(await runInWorkspace(HOME, () => approveDraft(homeCopy.draftId))).toEqual({ ok: true });
    expect(await runInWorkspace(AWAY, () => approveDraft(awayCopy.draftId))).toMatchObject({ ok: false, error: expect.stringMatching(/already emailed/) });
  });

  it("refuses sending and inbox reading for a workspace that has no mailbox yet, in plain words", async () => {
    expect(NO_WORKSPACE_MAILBOX).toBe("This workspace has no mailbox connected yet.");
    const away = await seed(AWAY, "Oakbeck Plumbing", "hello@oakbeck-plumbing.example", "approved");
    expect(await runInWorkspace(HOME, () => mailboxFor())).toEqual({ enabled: true, address: "owner@harbour-studio.example", reason: null });
    expect(await runInWorkspace(AWAY, () => mailboxFor())).toEqual({ enabled: false, address: null, reason: NO_WORKSPACE_MAILBOX });

    await runInWorkspace(AWAY, async () => {
      const pre = (await sendPreflight(away.campaignId))!;
      expect(pre).toMatchObject({ canSend: false, problem: NO_WORKSPACE_MAILBOX, mailbox: { ok: false, address: null } });
      expect(pre.sendable).toHaveLength(1); // the email itself is fine; only the mailbox is missing
      expect(await sendCampaign(away.campaignId)).toMatchObject({ ok: false, error: NO_WORKSPACE_MAILBOX, queued: 0 });
      await expect(syncMailbox()).rejects.toThrow(NO_WORKSPACE_MAILBOX);
      // The buttons: the action sends the operator back with the same sentence and queues or sends nothing.
      const refused = { digest: expect.stringContaining(encodeURIComponent(NO_WORKSPACE_MAILBOX)) };
      await expect(sendTestEmailAction()).rejects.toMatchObject(refused);
      await expect(syncMailboxAction(new FormData())).rejects.toMatchObject(refused);
    });
    expect((await draft(away.draftId)).status).toBe("approved");
    expect(await db.select().from(jobs).all()).toHaveLength(0);

    // Even a send job that got into the queue for that workspace sends nothing and says why on the email.
    await db.update(outreachDrafts).set({ status: "queued", messageId: "<a1@meadow.example>", scheduledAt: nowIso() }).where(eq(outreachDrafts.id, away.draftId)).run();
    const send = await runInWorkspace(AWAY, () => enqueueJob("send_email", { draftId: away.draftId }));
    const sync = await runInWorkspace(AWAY, () => enqueueJob("sync_mailbox", {}, { maxAttempts: 1 }));
    expect(await drainQueue(["send_email", "sync_mailbox"])).toBe(2);
    expect(fakeMail().sent).toEqual([]);
    expect(await draft(away.draftId)).toMatchObject({ status: "failed", lastError: NO_WORKSPACE_MAILBOX, sentAt: null });
    const after = Object.fromEntries((await db.select().from(jobs).all()).map((j) => [j.id, j]));
    expect(after[send.id]).toMatchObject({ status: "failed", error: NO_WORKSPACE_MAILBOX });
    expect(after[sync.id]).toMatchObject({ status: "failed", error: `Inbox could not be read: ${NO_WORKSPACE_MAILBOX}` });
  });

  it("reads the inbox as the mailbox's workspace and matches replies only to that workspace's emails", async () => {
    const sentAt = new Date(Date.now() - 3600_000).toISOString();
    const home = await seed(HOME, "Fernhill Joinery", "office@fernhill-joinery.example", "sent", { sentAt, messageId: "<h1@harbour-studio.example>" });
    // AWAY has an email marked as sent by hand (it cannot send); a message from that address is not HOME's reply.
    const away = await seed(AWAY, "Oakbeck Plumbing", "hello@oakbeck-plumbing.example", "sent", { sentAt, messageId: "<a1@meadow.example>" });
    for (const x of [home, away]) await db.update(prospects).set({ stage: "contacted" }).where(eq(prospects.businessId, x.id)).run();
    deliverToFakeInbox({ from: { address: "office@fernhill-joinery.example" }, subject: "Re: Idea for Fernhill Joinery", inReplyTo: "<h1@harbour-studio.example>", text: "Yes, call me on Thursday." });
    deliverToFakeInbox({ from: { address: "hello@oakbeck-plumbing.example" }, subject: "Re: Idea for Oakbeck Plumbing", inReplyTo: "<a1@meadow.example>", text: "Tell me more." });

    // The scheduler queues the inbox read for the mailbox's workspace only, under a key that names it.
    expect((await runScheduler()).sync).toBe(true);
    expect((await db.select().from(jobs).where(eq(jobs.type, "sync_mailbox")).all()).map((j) => [j.workspaceId, j.idempotencyKey])).toEqual([[HOME, `sync_mailbox:${HOME}`]]);
    expect(await drainQueue(["sync_mailbox"])).toBe(1);
    const inbound = await db.select().from(inboundEmails).all();
    expect(inbound.map((r) => [r.businessId, r.draftId, r.kind])).toEqual([[home.id, home.draftId, "reply"]]);
    const stage = async (id: string) => (await db.select().from(prospects).where(eq(prospects.businessId, id)).get())!.stage;
    expect([await stage(home.id), await stage(away.id)]).toEqual(["replied", "contacted"]);
    // The reply's job runs where the reply lives.
    expect((await db.select().from(jobs).where(eq(jobs.type, "process_reply")).all()).map((j) => j.workspaceId)).toEqual([HOME]);
  });

  it("treats an email, batch or business id of another workspace as not found, and changes nothing", async () => {
    const away = await seed(AWAY, "Oakbeck Plumbing", "hello@oakbeck-plumbing.example", "ready");
    const awayApproved = await seed(AWAY, "Tarnside Electrics", "desk@tarnside-electrics.example", "approved");
    const awayExcluded = await seed(AWAY, "Wrenfield Glazing", "team@wrenfield-glazing.example", "excluded");
    const awayFailed = await seed(AWAY, "Yarrow Heating", "post@yarrow-heating.example", "failed", { messageId: "<a4@meadow.example>" });
    const ideaId = newId();
    const investigationId = newId();
    await db.insert(investigations).values({ id: investigationId, businessId: away.id, status: "done", startedAt: nowIso(), finishedAt: nowIso() }).run();
    const idea = { investigationId, businessId: away.id, problemHypothesis: "Visits may be booked by phone.", proposedSolution: "A booking flow.", supportingFactKeys: [], assumptions: [], validationQuestions: [], implementationEffort: "small", reusability: "high", risks: [], scoreBreakdown: { attractiveness: [], confidence: [], notes: [] }, source: "ai" };
    await db.insert(opportunities).values({ ...idea, id: newId(), rank: 1, role: "primary", title: "Book estimates online", category: "online_booking", attractivenessScore: 60, confidenceScore: 60 }).run();
    await db.insert(opportunities).values({ ...idea, id: ideaId, rank: 2, role: "secondary", title: "Answer enquiries faster", category: "intake", attractivenessScore: 50, confidenceScore: 50 }).run();
    const all = [away, awayApproved, awayExcluded, awayFailed];
    const before = await Promise.all(all.map((x) => snapshot(x.id)));

    await runInWorkspace(HOME, async () => {
      // Emails.
      expect(await approveDraft(away.draftId)).toEqual({ ok: false, error: "Email not found" });
      expect(await saveDraftEdit(away.draftId, "Changed", "Changed body")).toEqual({ ok: false, error: "Email not found" });
      await unapproveDraft(awayApproved.draftId);
      await excludeDraft(away.draftId);
      await restoreDraft(awayExcluded.draftId);
      expect(await retryFailed(awayFailed.draftId)).toBe(false);
      expect(await subjectIdeasFor(away.draftId)).toBeNull();
      expect(await draftDetail(away.draftId)).toBeNull();
      // Batches.
      expect(await sendPreflight(away.campaignId)).toBeNull();
      expect(await sendCampaign(away.campaignId)).toMatchObject({ ok: false, error: "Batch not found" });
      expect(await approveAllReady(away.campaignId)).toBe(0);
      expect(await cancelQueued(away.campaignId)).toBe(0);
      // The pipeline and the ideas.
      const gone = /no longer exists/;
      await expect(setStage(away.id, "won")).rejects.toThrow(gone);
      await expect(ensureProspect(away.id)).rejects.toThrow(gone);
      await expect(logActivity(away.id, "note", "Seen from elsewhere")).rejects.toThrow(gone);
      await expect(setNextAction(away.id, "Call them", nowIso())).rejects.toThrow(gone);
      await expect(markReplied(away.id)).rejects.toThrow(gone);
      await expect(moveOnBoard(away.id, "won", [away.id])).rejects.toThrow(gone);
      expect(await chooseIdea(away.id, ideaId)).toEqual({ ok: false, error: "That business no longer exists." });
      expect(await recentActivities(away.id)).toEqual([]);
      expect(await latestInvestigation(away.id)).toBeNull();
      expect(await loadStoredPages(away.id, "https://oakbeck-plumbing.example", Number.POSITIVE_INFINITY)).toBeNull();
    });
    expect(await Promise.all(all.map((x) => snapshot(x.id)))).toEqual(before);
    expect(await db.select().from(jobs).all()).toHaveLength(0);

    // The same calls from the workspace that owns them do work (a job runs its handler exactly like this).
    await runInWorkspace(AWAY, async () => {
      expect(await approveDraft(away.draftId)).toEqual({ ok: true });
      await setStage(away.id, "contacted", "called them");
      expect((await recentActivities(away.id)).length).toBeGreaterThan(0);
      expect(await latestInvestigation(away.id)).not.toBeNull();
      expect(await chooseIdea(away.id, ideaId)).toMatchObject({ ok: true, title: "Answer enquiries faster" });
    });
    expect((await db.select().from(prospects).where(eq(prospects.businessId, away.id)).get())!.stage).toBe("contacted");
  });

  it("records which workspace a model call was made for", async () => {
    resetEnv({ OPENAI_API_KEY: "sk-test" });
    _setOpenAiFetch(async () => new Response(JSON.stringify({ model: "gpt-5-2026-01-01", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ok: true }) }] }], usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200 }));
    const call = () => callStructured({ stage: "reply", effort: "low", system: "s", user: "u", schema: z.object({ ok: z.boolean() }) });
    await runInWorkspace(AWAY, call);
    await runInWorkspace(HOME, call);
    await call(); // no workspace set: the first one
    expect((await db.select().from(aiUsage).all()).map((r) => r.workspaceId).sort()).toEqual([AWAY, HOME, HOME].sort());
  });

  it("lists, counts, retries and cancels only the acting workspace's jobs", async () => {
    const mine = await runInWorkspace(HOME, () => enqueueJob("generate_outreach", { businessId: "b-home", step: 0 }));
    const theirs = await runInWorkspace(AWAY, () => enqueueJob("generate_outreach", { businessId: "b-away", step: 0 }));
    const theirFailed = await runInWorkspace(AWAY, () => enqueueJob("investigate_business", { businessId: "b-away" }));
    await db.update(jobs).set({ status: "failed", attempts: 3, error: "boom" }).where(eq(jobs.id, theirFailed.id)).run();
    const form = (jobId: string) => {
      const fd = new FormData();
      fd.set("jobId", jobId);
      return fd;
    };
    const row = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)).get())!;

    await runInWorkspace(HOME, async () => {
      expect((await recentJobs()).map((j) => j.id)).toEqual([mine.id]);
      expect((await jobCounts()).map((c) => [c.type, c.status, Number(c.n)])).toEqual([["generate_outreach", "queued", 1]]);
      expect((await getJob(mine.id))?.id).toBe(mine.id);
      expect(await getJob(theirs.id)).toBeNull();
      expect(await cancelQueuedJob(theirs.id)).toBe(false);
      await cancelJobAction(form(theirs.id));
      await retryJobAction(form(theirFailed.id));
    });
    expect(await row(theirs.id)).toMatchObject({ status: "queued", error: null });
    expect(await row(theirFailed.id)).toMatchObject({ status: "failed", attempts: 3, error: "boom" });
    // The whole queue is still countable by the system itself (the drain endpoint).
    expect((await jobCounts("all")).reduce((n, c) => n + Number(c.n), 0)).toBe(3);

    await runInWorkspace(AWAY, async () => {
      expect((await recentJobs()).map((j) => j.id).sort()).toEqual([theirs.id, theirFailed.id].sort());
      await retryJobAction(form(theirFailed.id));
      await cancelJobAction(form(theirs.id));
    });
    expect(await row(theirFailed.id)).toMatchObject({ status: "queued", attempts: 0, error: null });
    expect(await row(theirs.id)).toMatchObject({ status: "failed", error: "Cancelled by the operator" });
    expect((await row(mine.id)).status).toBe("queued");
  });
});
