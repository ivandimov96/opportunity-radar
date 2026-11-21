/**
 * The outreach engine through the real job queue: writer → fixed checks →
 * independent claim check → ready / needs review, then the operator's review
 * operations. The model is mocked at the client boundary; nothing is sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DISTINCT_BODIES } from "../fixtures/emails";
import { eq } from "drizzle-orm";

const callStructured = vi.fn();
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...orig, callStructured: (...args: unknown[]) => callStructured(...args) };
});

import { useTempDb, resetEnv } from "../helpers";
import { activities, businesses, campaigns, facts, observations, opportunities, outreachDrafts, prospects } from "@/db/schema";
import { newId } from "@/lib/ids";
import { drainQueue } from "@/lib/jobs/worker";
import { enqueueOutreach, maybeAutoDraft } from "@/lib/jobs/handlers";
import { approveAllReady, approveDraft, excludeDraft, restoreDraft, saveDraftEdit } from "@/lib/outreach/drafts";
import { addSuppression, isSuppressed } from "@/lib/email/suppression";
import { getSettings, missingSenderDetails, saveSettings } from "@/lib/settings";
import { ensureProspect } from "@/lib/pipeline/prospects";

const BODY = `Hi Northside Air team,

I was reading about your Comfort Club and noticed that every system replacement starts with a free in-home estimate.

I'm Ivan, and I build small software tools for service businesses. It made me wonder whether people could pick a visit time themselves, alongside the tools you already run.

Shall I send over a short mock-up of how that could look?`;
/** A second email that is its own: an email that reads almost like another one is refused (see the sameness test). */
const OTHER_BODY = `Hi Second Air team,

Every system replacement at yours begins with a free estimate at the customer's home.

Ivan here. I'd build a page where your customers choose the time of that visit on their own, next to what you run today, so the office spends less of the day on the phone.

Would a short mock-up of it be useful?`;
const CLAIMS = [{ text: "every system replacement starts with a free in-home estimate", fact_keys: ["o1"] }];
const usage = (cost: number) => ({ input: 10, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: cost });
const written = (subject: string, body = BODY) => ({ data: { subject, body, claims: CLAIMS }, model: "writer-model", usage: usage(0.02) });
const checked = (unsupported: string[] = [], tone: string[] = []) => ({ data: { statements: [{ text: "every system replacement starts with a free in-home estimate", verdict: "supported", evidence: ["o1"], note: "" }, ...unsupported.map((text) => ({ text, verdict: "unsupported", evidence: [], note: "not in the research" }))], tone_problems: tone }, model: "check-model", usage: usage(0.005) });

/** Routes the mocked model by stage and records the calls. */
function model(script: { outreach: unknown[]; check: unknown[] }) {
  const calls: { stage: string; user: string; system: string }[] = [];
  callStructured.mockImplementation(async (call: { stage: "outreach" | "check"; user: string; system: string }) => {
    calls.push({ stage: call.stage, user: call.user, system: call.system });
    const next = script[call.stage].shift();
    if (!next) throw new Error(`unexpected ${call.stage} call`);
    return next;
  });
  return calls;
}

describe("outreach engine", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  const seed = async (name: string, email: string | null, extra: Partial<typeof businesses.$inferInsert> = {}) => {
    const id = newId();
    await db.insert(businesses).values({ id, name, nameNormalized: name.toLowerCase(), industry: "home_services", firstProvider: "csv", country: "US", city: "Houston", region: "TX", website: `https://${id}.example`, status: "profiled", verdict: "qualified", email, emailSource: email ? "site" : null, emailStatus: email ? "valid" : null, ...extra }).run();
    await ensureProspect(id);
    await db.insert(facts).values([
      { id: newId(), businessId: id, key: "maintenance_plans", status: "verified", value: "Comfort Club membership", evidenceQuote: "Join our Comfort Club", sourceUrl: "https://x.example/", method: "ai" },
      { id: newId(), businessId: id, key: "booking_tool", status: "not_found", value: null, evidenceQuote: null, sourceUrl: null, method: "detected" },
    ]).run();
    await db.insert(observations).values({ id: newId(), businessId: id, ref: "o1", kind: "process", statement: "Replacements start with a free in-home estimate.", evidenceQuote: "We schedule a free in-home estimate for every system replacement", sourceUrl: "https://x.example/services" }).run();
    const inv = newId();
    const { investigations } = await import("@/db/schema");
    await db.insert(investigations).values({ id: inv, businessId: id, status: "done" }).run();
    await db.insert(opportunities).values({ id: newId(), investigationId: inv, businessId: id, category: "online_booking", title: "Estimate visit scheduling", problemHypothesis: "Visits may be booked by phone.", proposedSolution: "A scheduling flow for estimate visits.", supportingFactKeys: ["o1", "booking_tool"], assumptions: [], validationQuestions: ["How are estimate visits booked today?"], implementationEffort: "small", reusability: "high", risks: [], attractivenessScore: 80, confidenceScore: 75, scoreBreakdown: { attractiveness: [], confidence: [], notes: [] }, rank: 1, source: "ai", role: "primary", components: [{ name: "Slot picker", description: "Customers choose a visit slot.", evidence: ["o1"] }], whyRelevant: "Every replacement starts with a visit.", salesAngle: "Every replacement starts with a home visit; people could pick the time themselves.", expectedValue: "Fewer calls to arrange visits." }).run();
    return id;
  };
  const draftOf = async (id: string) => (await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, id)).all()).filter((d) => d.status !== "archived");

  beforeEach(async () => {
    resetEnv({ ANTHROPIC_API_KEY: "test-key" });
    db = await useTempDb();
    callStructured.mockReset();
  });

  it("writes a checked email into the open batch and moves the business to ready to contact", async () => {
    const id = await seed("Northside Air", "office@northside.example");
    await saveSettings({ senderName: "Ivan Dimov", senderCompany: "Dimov Software", offer: "Small custom tools for service businesses.", voiceSamples: "Hey, quick one from me.", bookingLink: "" });
    const calls = model({ outreach: [written("Booking your in-home estimates")], check: [checked([], ["slightly formal"])] });
    await enqueueOutreach(id);
    expect(await drainQueue(["generate_outreach"])).toBe(1);
    const [d] = await draftOf(id);
    expect(d).toMatchObject({ status: "ready", step: 0, toEmail: "office@northside.example", subject: "Booking your in-home estimates", model: "writer-model", promptVersion: "outreach-14" });
    expect(d.costUsd).toBeCloseTo(0.025);
    expect(d.validation).toMatchObject({ passed: true, checkedBy: "check-model" });
    expect(d.validation?.issues).toEqual([{ severity: "warn", code: "tone", message: "Tone: slightly formal" }]);
    expect(d.validation?.statements?.[0]).toMatchObject({ verdict: "supported", evidence: ["o1"] });
    expect(d.claims).toEqual([{ text: CLAIMS[0].text, factKeys: ["o1"] }]);
    const camp = await db.select().from(campaigns).all();
    expect(camp).toHaveLength(1);
    expect(camp[0].status).toBe("open");
    expect(d.campaignId).toBe(camp[0].id);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, id)).get())!.stage).toBe("ready_to_contact");
    // The writer saw the evidence with the business's own words, the sender, the greeting, and nothing measured.
    const w = calls.find((c) => c.stage === "outreach")!;
    expect(w.user).toContain('their words: "We schedule a free in-home estimate for every system replacement"');
    expect(w.user).toContain("Greeting to use as the first line: Hi Northside Air team,");
    expect(w.user).toContain("Ivan Dimov of Dimov Software");
    expect(w.user).toMatch(/NOT SEEN ON THEIR SITE[\s\S]*\[booking_tool\]/);
    expect(w.user).toContain("Hey, quick one from me.");
    // The idea reaches the writer in plain words; its parts are background, not a list to recite.
    expect(w.user).toContain("In plain words: Every replacement starts with a home visit; people could pick the time themselves.");
    expect(w.user).toMatch(/Background for you only, not for the email[\s\S]*Slot picker/);
    expect(w.system).toMatch(/45 to 70 words/);
    // Four short parts: what was seen as a plain fact (no praise), the offer said exactly, what it means for them, one small ask.
    expect(w.system).toMatch(/ONE sentence \(20 words at most\)[\s\S]*do not praise it[\s\S]*the offer itself, said exactly[\s\S]*Do not wrap the offer in a question[\s\S]*End with exactly ONE question[\s\S]*Do not propose a call or a meeting unless that is the ask given[\s\S]*One idea only/);
    // The writer is told to be the kind of seller the profile describes: a consultant is not made into a supplier.
    expect(w.system).toMatch(/an adviser or consultant says what they help companies like this one with/);
    expect(w.user).toContain("Booking link: (not used in a first email: include no links)");
    expect(w.user).not.toContain("A question worth asking them");
    expect(w.system).toMatch(/The subject decides whether the email is opened/);
    expect(w.user).not.toContain("A SECOND IDEA"); // this business has no alternative idea
    // The checker saw the email and the same evidence, not the writer's claims.
    const c = calls.find((x) => x.stage === "check")!;
    expect(c.user).toContain("EMAIL TO VERIFY");
    expect(c.user).not.toContain("fact_keys");
  });

  it("rewrites once when the claim check finds an unsupported statement, and gives up into needs review when it still fails", async () => {
    const a = await seed("Alpha Air", "a@alpha.example");
    const callsA = model({ outreach: [written("Subject one", BODY.replace("I was reading", "You have 12 technicians. I was reading")), written("Subject one")], check: [checked()] });
    await enqueueOutreach(a);
    await drainQueue(["generate_outreach"]);
    const [da] = await draftOf(a);
    expect(da.status).toBe("ready");
    expect(da.body).not.toContain("12 technicians");
    expect(da.costUsd).toBeCloseTo(0.045); // two writer calls, one check: the first version failed a fixed check, so no check call was spent on it
    expect(callsA.map((c) => c.stage)).toEqual(["outreach", "outreach", "check"]);
    expect(callsA[1].user).toMatch(/Your previous version was rejected[\s\S]*number that is not in the research or in your own details \(12\)/);

    const b = await seed("Bravo Air", "b@bravo.example");
    model({ outreach: [written("Subject two", OTHER_BODY.replace("Second Air", "Bravo Air")), written("Subject two", OTHER_BODY.replace("Second Air", "Bravo Air"))], check: [checked(["they answer every call within a minute"]), checked(["they answer every call within a minute"])] });
    await enqueueOutreach(b);
    await drainQueue(["generate_outreach"]);
    const [dbr] = await draftOf(b);
    expect(dbr.status).toBe("needs_review");
    expect(dbr.validation?.passed).toBe(false);
    expect(dbr.validation?.issues.map((i) => i.code)).toContain("unsupported_statement");
    expect((await db.select().from(prospects).where(eq(prospects.businessId, b)).get())!.stage).toBe("discovered");
    const log = (await db.select().from(activities).where(eq(activities.businessId, b)).all()).map((x) => x.content).join(" ");
    expect(log).toMatch(/needs review: Not supported by the research/);
  });

  it("keeps a good email out of the ready queue when the recipient cannot be emailed, and refuses to approve it", async () => {
    // By default every country may be emailed; the operator can limit that, and here does.
    expect((await getSettings()).allowedCountries).toEqual([]);
    await saveSettings({ allowedCountries: ["US"] });
    const noEmail = await seed("No Mail Co", null);
    const suppressed = await seed("Opted Out Co", "owner@optedout.example");
    const abroad = await seed("Berlin Co", "info@berlin.example", { country: "DE" });
    await addSuppression("owner@optedout.example", "unsubscribed");
    expect(await isSuppressed("OWNER@optedout.example")).toBe(true);
    // Each company gets an email of its own: one text for all three would be refused as a template.
    for (const [n, id] of [noEmail, suppressed, abroad].entries()) {
      model({ outreach: [written(`Subject for ${id}`, DISTINCT_BODIES[n])], check: [checked()] });
      await enqueueOutreach(id);
      await drainQueue(["generate_outreach"]);
    }
    const reasons = async (id: string) => (await draftOf(id))[0].validation!.issues.filter((i) => i.code === "recipient").map((i) => i.message).join(" ");
    expect((await draftOf(noEmail))[0].status).toBe("needs_review");
    expect(await reasons(noEmail)).toMatch(/No email address on record/);
    expect(await reasons(suppressed)).toMatch(/do-not-contact list \(unsubscribed\)/);
    expect(await reasons(abroad)).toMatch(/Country DE is not in your allowed list \(US\)/);
    const res = await approveDraft((await draftOf(suppressed))[0].id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do-not-contact/);
    // A domain entry blocks every address on it; a public mailbox provider cannot be suppressed as a whole.
    await addSuppression("berlin.example", "manual");
    expect(await isSuppressed("anyone@berlin.example")).toBe(true);
    expect((await addSuppression("gmail.com", "manual")).added).toBe(false);
    // Automatic drafting skips businesses that cannot be emailed.
    expect(await maybeAutoDraft(suppressed)).toBe(false);
  });

  it("lets the operator edit, approve (also against a failed check), exclude and restore", async () => {
    const id = await seed("Northside Air", "office@northside.example");
    const other = await seed("Second Air", "hi@second.example");
    model({ outreach: [written("First subject"), written("Second subject", OTHER_BODY)], check: [checked(), checked()] });
    await enqueueOutreach(id);
    await enqueueOutreach(other);
    await drainQueue(["generate_outreach"]);
    const [d] = await draftOf(id);
    expect(d.status).toBe("ready");

    // An edit that states an absence fails the fixed check without any model call.
    callStructured.mockReset();
    expect((await saveDraftEdit(d.id, "First subject", `${d.body}\n\nYou don't have online booking.`)).ok).toBe(true);
    let cur = (await draftOf(id))[0];
    expect(cur).toMatchObject({ status: "needs_review", editedByUser: true });
    expect(cur.validation?.issues.map((i) => i.code)).toContain("absence_stated");
    expect(cur.validation?.statements).toBeUndefined(); // the earlier claim check described the old text
    expect(callStructured).not.toHaveBeenCalled();
    // The operator has the last word: approving anyway is recorded as an override.
    expect((await approveDraft(d.id)).ok).toBe(true);
    cur = (await draftOf(id))[0];
    expect(cur.status).toBe("approved");
    expect(cur.validation?.overridden).toBe(true);
    // An edited or approved email is never silently replaced by automatic drafting.
    expect(await maybeAutoDraft(id)).toBe(false);
    // Fixing the text clears the problem and keeps the approval.
    await saveDraftEdit(d.id, "First subject", d.body);
    cur = (await draftOf(id))[0];
    expect(cur).toMatchObject({ status: "approved" });
    expect(cur.validation?.passed).toBe(true);

    await excludeDraft(d.id);
    expect((await draftOf(id))[0].status).toBe("excluded");
    await restoreDraft(d.id);
    expect((await draftOf(id))[0].status).toBe("ready");

    const camp = (await db.select().from(campaigns).get())!;
    expect(await approveAllReady(camp.id)).toBe(2);
    expect((await db.select().from(outreachDrafts).all()).filter((x) => x.status === "approved")).toHaveLength(2);

    // Regenerating with a note replaces the unsent email and passes the note to the writer.
    const calls = model({ outreach: [written("A warmer subject")], check: [checked()] });
    await enqueueOutreach(id, { feedback: "Make it warmer and mention the Comfort Club first." });
    await drainQueue(["generate_outreach"]);
    expect(calls[0].user).toContain("The sender asked for this change: Make it warmer");
    const all = await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, id)).all();
    expect(all.map((x) => x.status).sort()).toEqual(["archived", "ready"]);
    expect(calls[0].user).toMatch(/Other emails in this batch[\s\S]*Subject: Second subject/);
  });

  it("needs a model key to write, and reports what the sender still has to fill in", async () => {
    const id = await seed("Northside Air", "office@northside.example");
    resetEnv({});
    await enqueueOutreach(id);
    await drainQueue(["generate_outreach"]);
    expect(await draftOf(id)).toHaveLength(0);
    expect(await maybeAutoDraft(id)).toBe(false);
    expect(missingSenderDetails(await getSettings())).toEqual(["your name", "a postal address (required in commercial email)"]);
    const s = await saveSettings({ senderName: "Ivan", senderCompany: "Dimov Software", postalAddress: "1 Main St", dailySendCap: "9999", allowedCountries: "us, ca; xx1", autoDraft: "off", monthlyAiBudgetUsd: "40" });
    expect(missingSenderDetails(s)).toEqual([]);
    expect(s).toMatchObject({ dailySendCap: 200, allowedCountries: ["US", "CA"], autoDraft: false, monthlyAiBudgetUsd: 40, followUpDays: 5 });
  });

  it("lets the operator raise a different idea: roles swap, the unsent email is withdrawn, a sent one locks the choice", async () => {
    const { chooseIdea } = await import("@/lib/outreach/ideas");
    const id = await seed("Idea Air", "office@idea.example", { verdict: "qualified" });
    const primary = (await db.select().from(opportunities).where(eq(opportunities.businessId, id)).get())!;
    const altId = newId();
    await db.insert(opportunities).values({ ...primary, id: altId, category: "job_tracking", scope: "internal", title: "Every job on one board", role: "secondary", rank: 2, attractivenessScore: 70, confidenceScore: 66 }).run();
    const draftId = newId();
    await db.insert(outreachDrafts).values({ id: draftId, businessId: id, step: 0, style: "personal", toEmail: "office@idea.example", subject: "S", body: BODY, claims: [], warnings: [], status: "ready" }).run();

    // A first email raises one idea only: the alternative is kept for the follow-up.
    const calls = model({ outreach: [written("Idea for your estimate visits")], check: [checked()] });
    await enqueueOutreach(id);
    await drainQueue();
    const w2 = calls.find((c) => c.stage === "outreach")!;
    expect(w2.user).not.toContain("A SECOND IDEA");
    const { buildOutreachInput } = await import("@/lib/ai/outreach");
    const followUpInput = buildOutreachInput({ business: { id, name: "Idea Air" }, greeting: "Hi Idea Air team,", sender: { name: "Ivan", company: "", offer: "", bookingLink: "", voiceSamples: "" }, opportunity: { title: "T", problemHypothesis: "P", proposedSolution: "S", whyRelevant: null, components: [], validationQuestions: [] }, also: { inPlainWords: "Every job on one board." }, pack: { verified: [], notSeen: [], haystack: "" } as never, step: 1, firstEmail: { subject: "S", body: BODY }, others: [] });
    expect(followUpInput).toMatch(/A SECOND IDEA \(it can be the new angle of this follow-up[\s\S]*Every job on one board/);

    expect(await chooseIdea(id, altId)).toEqual({ ok: true, title: "Every job on one board", withdrawn: 1 });
    const roles = Object.fromEntries((await db.select().from(opportunities).where(eq(opportunities.businessId, id)).all()).map((o) => [o.title, o.role]));
    expect(roles).toEqual({ "Estimate visit scheduling": "secondary", "Every job on one board": "primary" });
    expect(await draftOf(id)).toHaveLength(0); // the email written about the previous idea is withdrawn
    const biz = (await db.select().from(businesses).where(eq(businesses.id, id)).get())!;
    expect(biz).toMatchObject({ bestAttractiveness: 70, bestConfidence: 66, statusMessage: "Qualified: Every job on one board" });

    // Once a first email is out, the idea it raised stays.
    await db.insert(outreachDrafts).values({ id: newId(), businessId: id, step: 0, style: "personal", toEmail: "office@idea.example", subject: "S", body: BODY, claims: [], warnings: [], status: "sent", sentAt: new Date().toISOString() }).run();
    expect(await chooseIdea(id, primary.id)).toMatchObject({ ok: false, error: expect.stringMatching(/already emailed/) });
    expect(await chooseIdea(id, "missing")).toMatchObject({ ok: false });
  });

  it("counts the funnel for a period by the date each step happened", async () => {
    const { funnelForPeriod } = await import("@/lib/outreach/queries");
    const old = await seed("Old Air", "o@old.example", { verdict: "qualified" });
    const fresh = await seed("Fresh Air", "f@fresh.example", { verdict: "qualified" });
    await db.update(businesses).set({ createdAt: "2026-10-01T10:00:00.000Z", investigatedAt: "2026-10-02T10:00:00.000Z" }).where(eq(businesses.id, old)).run();
    await db.update(businesses).set({ createdAt: "2026-11-10T10:00:00.000Z", investigatedAt: "2026-11-11T10:00:00.000Z" }).where(eq(businesses.id, fresh)).run();
    await db.insert(outreachDrafts).values({ id: newId(), businessId: fresh, step: 0, style: "personal", toEmail: "f@fresh.example", subject: "S", body: BODY, claims: [], warnings: [], status: "sent", sentAt: "2026-11-12T09:00:00.000Z" }).run();

    expect(await funnelForPeriod({ fromIso: null, toIso: null })).toMatchObject({ found: 2, researched: 2, qualified: 2, contacted: 1, replied: 0 });
    expect(await funnelForPeriod({ fromIso: "2026-11-01T00:00:00.000Z", toIso: "2026-11-30T23:59:59.999Z" })).toMatchObject({ found: 1, researched: 1, qualified: 1, contacted: 1 });
    expect(await funnelForPeriod({ fromIso: "2026-10-01T00:00:00.000Z", toIso: "2026-10-31T23:59:59.999Z" })).toMatchObject({ found: 1, researched: 1, qualified: 1, contacted: 0 });
    expect(await funnelForPeriod({ fromIso: "2026-12-01T00:00:00.000Z", toIso: null })).toMatchObject({ found: 0, researched: 0, contacted: 0 });
  });

  it("shows the board for a period and the history of the whole process across businesses", async () => {
    const { boardTotals, pipelineBoard, pipelineHistory } = await import("@/lib/queries");
    const { logActivity, moveOnBoard } = await import("@/lib/pipeline/prospects");
    const { inboundEmails } = await import("@/db/schema");
    const old = await seed("Old Air", "o@old.example", { verdict: "qualified" });
    const fresh = await seed("Fresh Air", "f@fresh.example", { verdict: "qualified" });
    await db.update(prospects).set({ stage: "contacted", updatedAt: "2026-10-01T10:00:00.000Z" }).where(eq(prospects.businessId, old)).run();
    await db.update(prospects).set({ stage: "replied", updatedAt: "2026-11-15T10:00:00.000Z" }).where(eq(prospects.businessId, fresh)).run();
    await db.insert(inboundEmails).values({ id: newId(), businessId: fresh, kind: "reply", fromEmail: "f@fresh.example", subject: "Re: idea", bodyText: "Sounds interesting", receivedAt: "2026-11-15T11:00:00.000Z", messageId: "<r1@fresh.example>" }).run();

    // The whole board, then only what moved in November.
    const names = (b: Awaited<ReturnType<typeof pipelineBoard>>) => Object.values(b).flat().map((r) => r.business.name).sort();
    expect(names(await pipelineBoard())).toEqual(["Fresh Air", "Old Air"]);
    expect(names(await pipelineBoard({ fromIso: "2026-11-01T00:00:00.000Z", toIso: "2026-11-30T23:59:59.999Z" }))).toEqual(["Fresh Air"]);
    expect(await boardTotals()).toEqual({ onBoard: 2, openReplies: { [fresh]: 1 } });

    // History: every kind of event, newest first, with the business each belongs to; narrowed by kind and by period.
    await db.delete(activities).run();
    await logActivity(old, "system", "Investigated in 40s: 5 pages.");
    await logActivity(fresh, "email", "Outreach email sent to f@fresh.example.");
    await logActivity(fresh, "stage_change", "Stage changed to replied: they answered", { from: "contacted", to: "replied", automatic: true });
    await logActivity(fresh, "note", "Called back, wants a demo.");
    const all = await pipelineHistory({});
    expect(all.total).toBe(4);
    expect(all.counts).toEqual({ all: 4, stage: 1, contact: 2, system: 1 });
    expect(all.items.map((i) => i.business.name)).toContain("Old Air");
    const stage = await pipelineHistory({ kind: "stage" });
    expect(stage.items.map((i) => [i.business.name, i.type])).toEqual([["Fresh Air", "stage_change"]]);
    expect((await pipelineHistory({ q: "old" })).items.map((i) => i.content)).toEqual(["Investigated in 40s: 5 pages."]);
    expect((await pipelineHistory({ toIso: "2000-01-01T00:00:00.000Z" })).total).toBe(0);
    void moveOnBoard;
  });

  it("suggests other subjects for an email under review: only clean, new ones are offered", async () => {
    const { subjectIdeasFor, suggestSubjectsFor } = await import("@/lib/outreach/drafts");
    const id = await seed("Subject Air", "office@subject.example", { verdict: "qualified" });
    const draftId = newId();
    await db.insert(outreachDrafts).values({ id: draftId, businessId: id, step: 0, style: "personal", toEmail: "office@subject.example", subject: "Booking your in-home estimates", body: BODY, claims: [], warnings: [], status: "ready" }).run();
    const calls: { system: string; user: string }[] = [];
    callStructured.mockImplementation(async (call: { system: string; user: string }) => {
      calls.push(call);
      // One repeats the current subject, one reads like an advert, one fakes a reply, one is far too long: none of those may be offered.
      return { data: { subjects: ["a thought on your estimates", "Booking your in-home estimates", "Free estimate booking offer", "Re: your estimates", "an idea about how your customers could book their in-home estimate visits online", "estimate visits, booked faster?"] }, model: "m", usage: usage(0.01) };
    });

    expect(await suggestSubjectsFor(draftId)).toEqual({ ok: true, count: 2 });
    // Offered with a capital first letter, whatever the model returned.
    expect((await subjectIdeasFor(draftId))!.options).toEqual(["A thought on your estimates", "Estimate visits, booked faster?"]);
    expect(calls[0].system).toMatch(/alternative subject lines/);
    expect(calls[0].user).toContain("- Booking your in-home estimates"); // the current subject is named as already tried
    expect(calls[0].user).toContain("I was reading about your Comfort Club"); // the email itself is given

    // Picking one is an ordinary edit of the subject: the body stays, the fixed checks run again.
    expect(await saveDraftEdit(draftId, "Estimate visits, booked faster?", BODY)).toEqual({ ok: true });
    const after = (await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, draftId)).get())!;
    expect(after).toMatchObject({ subject: "Estimate visits, booked faster?", body: BODY, status: "ready", editedByUser: true });

    // A second request is told what was already suggested, so it brings new ones.
    await suggestSubjectsFor(draftId);
    expect(calls[1].user).toContain("- A thought on your estimates");
  });
});
