/**
 * Review operations on an outbound email before it is sent: edit, approve,
 * exclude, restore. Editing re-runs the fixed checks on the new text (no model
 * call). Approving an email whose checks failed is possible, because the
 * operator has the last word, and is recorded as an override; an email whose
 * recipient is blocked (invalid, suppressed, already contacted) cannot be approved.
 */
import { suggestSubjects } from "@/lib/ai/outreach";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, facts, observations, opportunities, outreachDrafts, type DraftIssue, type DraftValidation } from "@/db/schema";
import { nowIso } from "@/lib/ids";
import { logActivity } from "@/lib/pipeline/prospects";
import { getState, setState, getSettings, type AppSettings } from "@/lib/settings";
import { buildEvidencePack, type EvidencePack } from "./evidence";
import { contactBlockers } from "./eligibility";
import { checkEmailText, hasBlock } from "./validate";

export type Draft = typeof outreachDrafts.$inferSelect;
/** Not yet handed to the mailbox: these can still be edited, replaced or excluded. */
export const REVIEW_STATUSES = ["needs_review", "ready", "approved", "excluded"];

/** The signature every email ends with. Written by code from Settings, never by the model. */
export function signatureBlock(s: Pick<AppSettings, "senderName" | "senderTitle" | "senderCompany" | "senderWebsite" | "postalAddress">): string {
  const lines = [s.senderName, [s.senderTitle, s.senderCompany].filter(Boolean).join(", "), s.senderWebsite, s.postalAddress].map((l) => l.trim()).filter(Boolean);
  const optOut = `If this isn't relevant, just reply "no thanks" and I won't write again.`;
  return lines.length ? `${lines.join("\n")}\n\n${optOut}` : optOut;
}

/** The exact text that is sent: the reviewed body plus the signature. */
export function composeEmailBody(body: string, s: Parameters<typeof signatureBlock>[0]): string {
  return `${body.trim()}\n\n${signatureBlock(s)}`;
}

/** The research an email rests on, and the other emails of its batch. */
export async function draftEvidence(draft: Pick<Draft, "id" | "businessId" | "campaignId" | "step">): Promise<{ pack: EvidencePack; others: { subject: string; body: string; label: string }[] }> {
  const db = await getDb();
  const [factRows, obsRows, opp] = await Promise.all([
    db.select().from(facts).where(eq(facts.businessId, draft.businessId)).all(),
    db.select().from(observations).where(eq(observations.businessId, draft.businessId)).all(),
    db.select().from(opportunities).where(eq(opportunities.businessId, draft.businessId)).orderBy(opportunities.rank).limit(1).get(),
  ]);
  return { pack: buildEvidencePack(factRows, obsRows, opp ?? null), others: await batchPeers(draft.campaignId, draft.businessId, draft.step) };
}

/** Other reviewable emails of the same batch and step (for "do not repeat" checks). */
export async function batchPeers(campaignId: string | null, businessId: string, step: number) {
  if (!campaignId) return [];
  const db = await getDb();
  const rows = await db
    .select({ subject: outreachDrafts.subject, body: outreachDrafts.body, label: businesses.name })
    .from(outreachDrafts)
    .innerJoin(businesses, eq(businesses.id, outreachDrafts.businessId))
    .where(and(eq(outreachDrafts.campaignId, campaignId), eq(outreachDrafts.step, step), ne(outreachDrafts.businessId, businessId), inArray(outreachDrafts.status, ["needs_review", "ready", "approved"])))
    .orderBy(desc(outreachDrafts.createdAt))
    .limit(12)
    .all();
  return rows.map((r) => ({ subject: r.subject ?? "", body: r.body, label: r.label }));
}

const recipientIssues = (reasons: string[]): DraftIssue[] => reasons.map((message) => ({ severity: "block" as const, code: "recipient", message }));

/** Saves the operator's edit and re-runs the fixed checks on the new text. */
export interface SubjectIdeas {
  /** The subjects offered by the latest request. */
  options: string[];
  /** Everything suggested so far, so the next request brings new ones. */
  tried: string[];
  at: string;
}
const subjectKey = (draftId: string) => `subjects:${draftId}`;

export async function subjectIdeasFor(draftId: string): Promise<SubjectIdeas | null> {
  return getState<SubjectIdeas>(subjectKey(draftId));
}

/** Ask the model for other subjects for an email under review and keep them with the email until one is used. */
export async function suggestSubjectsFor(draftId: string): Promise<{ ok: boolean; error?: string; count?: number }> {
  const db = await getDb();
  const draft = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, draftId)).get();
  if (!draft) return { ok: false, error: "Email not found" };
  if (!REVIEW_STATUSES.includes(draft.status)) return { ok: false, error: "This email can no longer be edited" };
  if (draft.step !== 0) return { ok: false, error: "A follow-up keeps the subject of the first email" };
  const biz = (await db.select().from(businesses).where(eq(businesses.id, draft.businessId)).get())!;
  const previous = await subjectIdeasFor(draftId);
  const others = await batchPeers(draft.campaignId, draft.businessId, draft.step);
  const res = await suggestSubjects({ businessId: biz.id, businessName: biz.name, subject: draft.subject ?? "", body: draft.body, tried: previous?.tried ?? [], others: others.map((o) => ({ subject: o.subject ?? "" })) });
  if (!res.subjects.length) return { ok: false, error: "No usable subject came back this time. Try once more, or write your own." };
  await setState(subjectKey(draftId), { options: res.subjects, tried: [...(previous?.tried ?? []), ...res.subjects].slice(-40), at: nowIso() } satisfies SubjectIdeas);
  return { ok: true, count: res.subjects.length };
}

export async function saveDraftEdit(draftId: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  const draft = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, draftId)).get();
  if (!draft) return { ok: false, error: "Email not found" };
  if (!REVIEW_STATUSES.includes(draft.status)) return { ok: false, error: "This email was already handed to the mailbox and can no longer be edited" };
  const cleanSubject = subject.trim();
  const cleanBody = body.replace(/\r/g, "").trim();
  if (!cleanBody) return { ok: false, error: "The email body is empty" };
  const edited = cleanSubject !== (draft.subject ?? "") || cleanBody !== draft.body;
  if (!edited) return { ok: true };
  const biz = (await db.select().from(businesses).where(eq(businesses.id, draft.businessId)).get())!;
  const settings = await getSettings();
  const { pack, others } = await draftEvidence(draft);
  const normalized = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const claims = draft.claims.filter((c) => normalized(cleanBody).includes(normalized(c.text)));
  const issues = [...checkEmailText({ subject: cleanSubject, body: cleanBody, claims }, { pack, bookingLink: settings.bookingLink, step: draft.step, others }), ...recipientIssues(await contactBlockers(biz, settings))];
  // The claim check ran on the old text: its statements no longer describe this email.
  const validation: DraftValidation = { passed: !hasBlock(issues), issues, checkedBy: null, checkedAt: nowIso() };
  const status = draft.status === "excluded" ? "excluded" : validation.passed ? (draft.status === "approved" ? "approved" : "ready") : "needs_review";
  await db.update(outreachDrafts).set({ subject: cleanSubject, body: cleanBody, claims, validation, warnings: issues.map((i) => i.message), status, editedByUser: true, updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
  await logActivity(draft.businessId, "note", "Outreach email edited.", { draftId });
  return { ok: true };
}

/** Approves an email for sending. Recipient problems cannot be overridden; text checks can. */
export async function approveDraft(draftId: string): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  const draft = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, draftId)).get();
  if (!draft) return { ok: false, error: "Email not found" };
  if (draft.status === "approved") return { ok: true };
  if (!["needs_review", "ready"].includes(draft.status)) return { ok: false, error: `This email is ${draft.status} and cannot be approved` };
  const biz = (await db.select().from(businesses).where(eq(businesses.id, draft.businessId)).get())!;
  const blockers = await contactBlockers(biz, await getSettings());
  if (blockers.length) return { ok: false, error: blockers.join(" ") };
  // An email from before the checks existed has never been read by them: run the fixed checks now, so an approval of it is an informed one.
  let textIssues = (draft.validation?.issues ?? []).filter((i) => i.code !== "recipient");
  if (!draft.validation) {
    const { pack, others } = await draftEvidence(draft);
    textIssues = checkEmailText({ subject: draft.subject ?? "", body: draft.body, claims: draft.claims }, { pack, bookingLink: (await getSettings()).bookingLink, step: draft.step, others });
  }
  const overridden = hasBlock(textIssues);
  const validation: DraftValidation = { ...(draft.validation ?? { checkedAt: nowIso() }), passed: !overridden, issues: textIssues, overridden: overridden || undefined, checkedAt: draft.validation?.checkedAt ?? nowIso() };
  await db.update(outreachDrafts).set({ status: "approved", toEmail: biz.email, validation, updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
  await logActivity(draft.businessId, "system", overridden ? "Outreach email approved by the operator although a check had failed." : "Outreach email approved for sending.", { draftId });
  return { ok: true };
}

/** Approves every email of the open batch whose checks passed. Returns how many. */
export async function approveAllReady(campaignId: string): Promise<number> {
  const db = await getDb();
  const ready = await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.campaignId, campaignId), eq(outreachDrafts.status, "ready"))).all();
  let n = 0;
  for (const d of ready) if ((await approveDraft(d.id)).ok) n++;
  return n;
}

export async function unapproveDraft(draftId: string) {
  const db = await getDb();
  await db.update(outreachDrafts).set({ status: "ready", updatedAt: nowIso() }).where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.status, "approved"))).run();
}

/** Takes a recipient out of the batch without deleting the email. */
export async function excludeDraft(draftId: string) {
  const db = await getDb();
  const draft = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, draftId)).get();
  if (!draft || !["needs_review", "ready", "approved"].includes(draft.status)) return;
  await db.update(outreachDrafts).set({ status: "excluded", updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
  await logActivity(draft.businessId, "system", "Excluded from the outreach batch by the operator.", { draftId });
}

export async function restoreDraft(draftId: string) {
  const db = await getDb();
  const draft = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, draftId)).get();
  if (!draft || draft.status !== "excluded") return;
  await db.update(outreachDrafts).set({ status: draft.validation?.passed ? "ready" : "needs_review", updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
}
