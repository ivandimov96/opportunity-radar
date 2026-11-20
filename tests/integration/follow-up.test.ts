/**
 * Follow-up planning on real rows: every business in play gets its next action,
 * the operator's own plan is never touched, a ticked-off action does not come
 * back, a pushed-back date stays, and a plan that no longer applies is removed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb, resetEnv } from "../helpers";
import { businesses, inboundEmails, outreachDrafts, prospects } from "@/db/schema";
import { newId } from "@/lib/ids";
import { planFollowUps, rememberDone } from "@/lib/pipeline/follow-up";
import { ensureProspect, setNextAction, setStage } from "@/lib/pipeline/prospects";
import { groupTodo, listTodo } from "@/lib/pipeline/todo";
import { runScheduler } from "@/lib/jobs/scheduler";

describe("follow-up planning", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  const add = async (name: string, over: Partial<typeof businesses.$inferInsert> = {}, stage: Parameters<typeof ensureProspect>[1] = "discovered") => {
    const id = newId();
    await db.insert(businesses).values({ id, name, nameNormalized: name.toLowerCase(), industry: "generic", firstProvider: "csv", country: "GB", status: "profiled", verdict: "qualified", email: `hi@${name.toLowerCase().replace(/\W+/g, "")}.example`, ...over }).run();
    await ensureProspect(id, stage);
    return id;
  };
  const draft = async (businessId: string, status: string, step = 0, sentDaysAgo: number | null = null) => {
    const id = newId();
    await db.insert(outreachDrafts).values({ id, businessId, step, style: "personal", subject: "s", body: "b", claims: [], warnings: [], status, sentAt: sentDaysAgo == null ? null : new Date(Date.now() - sentDaysAgo * 86_400_000).toISOString(), messageId: sentDaysAgo == null ? null : `<${id}@x.example>` }).run();
    return id;
  };
  const p = async (id: string) => (await db.select().from(prospects).where(eq(prospects.businessId, id)).get())!;

  beforeEach(async () => {
    resetEnv();
    db = await useTempDb();
  });

  it("plans the next action for every business in play and leaves the untouched ones alone", async () => {
    const fresh = await add("Fresh", { status: "new", verdict: null });
    const review = await add("Review", {}, "ready_to_contact");
    const reviewDraft = await draft(review, "ready");
    const waiting = await add("Waiting", {}, "contacted");
    await draft(waiting, "sent", 0, 1);
    const decide = await add("Decide", { verdict: "needs_review" });
    const replied = await add("Replied", {}, "replied");
    await draft(replied, "sent", 0, 3);
    const replyId = newId();
    await db.insert(inboundEmails).values({ id: replyId, businessId: replied, messageId: "<r@x.example>", bodyText: "Tell me more", receivedAt: new Date().toISOString(), kind: "reply" }).run();
    const proposal = await add("Proposal", {}, "proposal_sent");
    await draft(proposal, "sent", 0, 12);

    expect(await planFollowUps()).toEqual({ planned: 5, cleared: 0 });
    expect(await p(fresh)).toMatchObject({ nextAction: null, nextActionKey: null });
    expect(await p(review)).toMatchObject({ nextAction: "Review and approve the email", nextActionKey: `review:${reviewDraft}` });
    expect(await p(waiting)).toMatchObject({ nextActionKey: "wait:0" });
    expect(new Date((await p(waiting)).nextActionAt!).getTime()).toBeGreaterThan(Date.now()); // the follow-up is still days away
    expect(await p(decide)).toMatchObject({ nextActionKey: "decide:needs_review" });
    expect(await p(replied)).toMatchObject({ nextAction: "Read and answer their reply", nextActionKey: `reply:${replyId}` });
    expect(await p(proposal)).toMatchObject({ nextAction: "Follow up on the proposal", nextActionKey: "stage:proposal_sent" });
    // Running it again changes nothing; the scheduler runs it every minute.
    expect(await planFollowUps()).toEqual({ planned: 0, cleared: 0 });
    await runScheduler();
    expect((await p(review)).nextActionKey).toBe(`review:${reviewDraft}`);

    // The list groups what is due: two today (review, decide, reply), the rest later; soonest first.
    const groups = groupTodo(await listTodo());
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([["today", 3], ["week", 2]]);
  });

  it("never replaces the operator's own plan, never plans again what was ticked off, and keeps a pushed-back date", async () => {
    const own = await add("Own", {}, "ready_to_contact");
    await draft(own, "ready");
    await setNextAction(own, "Call Maria first", "2026-12-01T09:00:00.000Z", "high", null);
    const done = await add("Done", {}, "ready_to_contact");
    const doneDraft = await draft(done, "ready");
    const later = await add("Later", {}, "proposal_sent");
    await draft(later, "sent", 0, 9);

    await planFollowUps();
    expect(await p(own)).toMatchObject({ nextAction: "Call Maria first", nextActionKey: null, priority: "high" });

    // The operator ticks the planned action off: it does not come back while nothing changed.
    await rememberDone(done);
    await setNextAction(done, null, null, undefined, null);
    expect(await planFollowUps()).toEqual({ planned: 0, cleared: 0 });
    expect(await p(done)).toMatchObject({ nextAction: null, nextActionDone: `review:${doneDraft}` });
    // Something new to do (the email was approved) is planned as usual.
    await db.update(outreachDrafts).set({ status: "approved" }).where(eq(outreachDrafts.id, doneDraft)).run();
    await planFollowUps();
    expect(await p(done)).toMatchObject({ nextAction: "Send the approved email", nextActionKey: `send:${doneDraft}` });

    // The operator pushes the proposal follow-up back a week: planning leaves the date alone.
    await setNextAction(later, (await p(later)).nextAction, "2026-12-24T09:00:00.000Z");
    await planFollowUps();
    expect(await p(later)).toMatchObject({ nextActionAt: "2026-12-24T09:00:00.000Z", nextActionKey: "stage:proposal_sent" });
  });

  it("removes a plan that no longer applies and stops when the business is won or lost", async () => {
    const a = await add("Alpha", {}, "ready_to_contact");
    const d = await draft(a, "ready");
    await planFollowUps();
    expect((await p(a)).nextActionKey).toBe(`review:${d}`);
    // The email goes out: reviewing it is no longer the thing to do; waiting for the reply is.
    await db.update(outreachDrafts).set({ status: "sent", sentAt: new Date().toISOString(), messageId: "<a@x.example>" }).where(eq(outreachDrafts.id, d)).run();
    await setStage(a, "contacted");
    await planFollowUps();
    expect((await p(a)).nextActionKey).toBe("wait:0");
    // Closed: nothing is planned any more, and what was planned is taken away.
    await setStage(a, "lost");
    expect(await planFollowUps()).toEqual({ planned: 0, cleared: 1 });
    expect(await p(a)).toMatchObject({ nextAction: null, nextActionKey: null });
    expect(await listTodo()).toEqual([]);
  });
});
