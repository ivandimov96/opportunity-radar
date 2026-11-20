import { describe, expect, it } from "vitest";
import { dueInDays, dueTag } from "@/lib/due";
import { addWorkingDays, plannedAction, type FollowUpState } from "@/lib/pipeline/follow-up";
import { groupTodo, todoGroupOf, todoHref, todoKindOf, type TodoItem } from "@/lib/pipeline/todo";

const now = new Date(2026, 10, 20, 14, 30); // Friday 20 November 2026, 14:30
const settings = { followUpDays: 5, followUpCount: 2 };
const base: FollowUpState = { stage: "discovered", status: "profiled", verdict: "qualified", drafts: [], openReply: null, lastReplyId: null };
const plan = (over: Partial<FollowUpState>, s = settings) => plannedAction({ ...base, ...over }, s, now);
const sent = (step: number, daysAgo: number) => ({ id: `d${step}`, step, status: "sent", sentAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() });

describe("due dates in words", () => {
  it("counts whole days: today is today, never overdue by a few hours", () => {
    const at = (d: number, h = 9) => new Date(2026, 10, 20 + d, h).toISOString();
    expect(dueTag(at(0, 8), now)).toMatchObject({ label: "Today", tone: "accent", days: 0 }); // earlier today
    expect(dueTag(at(0, 23), now)!.label).toBe("Today");
    expect(dueTag(at(1), now)).toMatchObject({ label: "Tomorrow", tone: "info" });
    expect(dueTag(at(4), now)!.label).toBe("In 4 days");
    expect(dueTag(at(-1), now)).toMatchObject({ label: "Overdue 1 day", tone: "bad" });
    expect(dueTag(at(-9), now)!.label).toBe("Overdue 9 days");
    expect(dueTag(null, now)).toBeNull();
    expect(dueTag("not a date", now)).toBeNull();
  });
  it("turns a quick choice into a moment: today is now, a later day is nine in the morning", () => {
    expect(dueInDays(0, now)).toEqual(now);
    expect(dueInDays(3, now)).toEqual(new Date(2026, 10, 23, 9, 0));
  });
  it("skips weekends when counting working days", () => {
    expect(addWorkingDays(now, 1).getDate()).toBe(23); // Friday + 1 working day = Monday
    expect(addWorkingDays(now, 5).getDate()).toBe(27);
    expect(addWorkingDays(now, 0)).toEqual(now);
  });
});

describe("what the app plans next for a business", () => {
  it("plans nothing for a business that was only found, is being handled, or is closed", () => {
    expect(plan({ status: "new", verdict: null })).toBeNull();
    expect(plan({ stage: "qualified" })).toBeNull(); // qualified, the email is being written
    expect(plan({ stage: "won", openReply: { id: "r1", receivedAt: now.toISOString() } })).toBeNull();
    expect(plan({ stage: "lost", drafts: [{ id: "d", step: 0, status: "ready", sentAt: null }] })).toBeNull();
    expect(plan({ stage: "ready_to_contact", drafts: [{ id: "d", step: 0, status: "queued", sentAt: null }] })).toBeNull(); // on its way
  });
  it("puts a reply before everything else", () => {
    const p = plan({ stage: "replied", openReply: { id: "r7", receivedAt: "2026-11-19T10:00:00.000Z" }, drafts: [{ id: "d", step: 9, status: "ready", sentAt: null }] })!;
    expect(p).toMatchObject({ key: "reply:r7", text: "Read and answer their reply" });
    expect(p.at.toISOString()).toBe("2026-11-19T10:00:00.000Z");
  });
  it("names the email that waits for a decision, the most pressing kind first", () => {
    const d = (status: string, step = 0, id = status) => ({ id, step, status, sentAt: null });
    expect(plan({ drafts: [d("ready")] })).toMatchObject({ key: "review:ready", text: "Review and approve the email" });
    expect(plan({ drafts: [d("ready", 1)] })!.text).toBe("Review and approve the follow-up");
    expect(plan({ drafts: [d("ready", 2)] })!.text).toBe("Review and approve the last note");
    expect(plan({ drafts: [d("needs_review")] })).toMatchObject({ key: "fix:needs_review" });
    expect(plan({ drafts: [d("needs_review", 9)] })!.text).toBe("Check the answer to their reply and send it");
    expect(plan({ drafts: [d("approved")] })).toMatchObject({ key: "send:approved", text: "Send the approved email" });
    expect(plan({ drafts: [d("ready"), d("failed")] })!.key).toBe("send_failed:failed"); // a failed send first
    expect(plan({ drafts: [d("approved"), d("needs_review")] })!.key).toBe("fix:needs_review");
    // A first email that bounced, with nothing else out: the business was never reached.
    expect(plan({ stage: "qualified", drafts: [d("bounced")] })).toMatchObject({ key: "bounced:bounced", text: "The email bounced: find another address or set the business aside" });
  });
  it("says when the next email of the sequence is due, and what is left after the last one", () => {
    const first = plan({ stage: "contacted", drafts: [sent(0, 1)] })!;
    expect(first).toMatchObject({ key: "wait:0", text: "No reply yet: the follow-up is written on this day" });
    expect(first.at.getDate()).toBe(26); // sent Thursday 19th + 5 working days
    expect(plan({ stage: "contacted", drafts: [sent(0, 9), sent(1, 2)] })).toMatchObject({ key: "wait:1", text: "No reply yet: the last note is written on this day" });
    expect(plan({ stage: "contacted", drafts: [sent(0, 20), sent(1, 12), sent(2, 3)] })).toMatchObject({ key: "closeout:2", text: "No answer to the last email: call them or close as lost" });
    // With one follow-up configured the sequence ends earlier; with none, right after the first email.
    expect(plan({ stage: "contacted", drafts: [sent(0, 9), sent(1, 2)] }, { followUpDays: 5, followUpCount: 1 })!.key).toBe("closeout:1");
    expect(plan({ stage: "contacted", drafts: [sent(0, 2)] }, { followUpDays: 0, followUpCount: 2 })!.key).toBe("closeout:0");
  });
  it("keeps a conversation from going quiet in the stages the operator sets by hand", () => {
    expect(plan({ stage: "meeting_scheduled", drafts: [sent(0, 9)] })).toMatchObject({ key: "stage:meeting_scheduled" });
    const proposal = plan({ stage: "proposal_sent", drafts: [sent(0, 9)] })!;
    expect(proposal).toMatchObject({ key: "stage:proposal_sent", text: "Follow up on the proposal" });
    expect(proposal.at).toEqual(new Date(2026, 10, 23, 9, 0));
    expect(plan({ stage: "replied", lastReplyId: "r3", drafts: [sent(0, 9)] })!.key).toBe("stage:replied:r3");
  });
  it("asks for a decision when research could not finish the job", () => {
    expect(plan({ status: "failed", verdict: null })!.key).toBe("research_failed");
    expect(plan({ status: "no_website", verdict: null })!.key).toBe("no_website");
    expect(plan({ verdict: "needs_review" })!.text).toBe("Decide: qualify it yourself or set it aside");
    expect(plan({ verdict: "insufficient_evidence" })!.key).toBe("decide:insufficient_evidence");
    expect(plan({ verdict: "no_contact" })!.key).toBe("no_contact");
    expect(plan({ verdict: "not_a_fit" })).toBeNull();
  });
});

describe("the to-do list in groups", () => {
  it("sorts actions into overdue, today, tomorrow, this week, later and no date, and leaves empty groups out", () => {
    const item = (action: string, days: number | null): TodoItem => {
      const at = days == null ? null : new Date(2026, 10, 20 + days, 9).toISOString();
      return { businessId: action, businessName: action, city: null, stage: "contacted", priority: "normal", action, at, due: dueTag(at, now), kind: "own", href: "/businesses/x" };
    };
    const items = [item("a", -3), item("b", 0), item("c", 0), item("d", 1), item("e", 6), item("f", 30), item("g", null)];
    expect(items.map((i) => todoGroupOf(i.due))).toEqual(["overdue", "today", "today", "tomorrow", "week", "later", "undated"]);
    expect(groupTodo(items).map((g) => [g.label, g.items.length])).toEqual([["Overdue", 1], ["Today", 2], ["Tomorrow", 1], ["This week", 1], ["Later", 1], ["No date", 1]]);
    expect(groupTodo([item("b", 0)]).map((g) => g.key)).toEqual(["today"]);
    // Inside a day the kind of work decides the order: a reply before the operator's own plan, before a routine review, before waiting.
    const today = [{ ...item("wait", 0), kind: "waiting" as const }, { ...item("review", 0), kind: "email" as const }, { ...item("mine", 0), kind: "own" as const }, { ...item("reply", 0), kind: "reply" as const }, { ...item("urgent review", 0), kind: "email" as const, priority: "high" }];
    expect(groupTodo(today)[0].items.map((i) => i.action)).toEqual(["reply", "mine", "urgent review", "review", "wait"]);
  });
  it("knows what kind of work an action is and where a click should lead", () => {
    expect([null, "reply:r1", "review:d1", "fix:d1", "send:d1", "send_failed:d1", "wait:0", "closeout:2", "stage:proposal_sent", "decide:needs_review", "no_contact", "research_failed"].map(todoKindOf)).toEqual(["own", "reply", "email", "email", "email", "email", "waiting", "followup", "followup", "decision", "decision", "decision"]);
    expect(todoHref("b1", "review:d9")).toBe("/outreach/d9");
    expect(todoHref("b1", "reply:r1")).toBe("/businesses/b1");
    expect(todoHref("b1", null)).toBe("/businesses/b1");
  });
});
