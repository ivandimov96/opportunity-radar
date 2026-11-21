/**
 * Review operations on an outbound email before it is sent: edit, approve,
 * exclude, restore. Editing re-runs the fixed checks on the new text (no model
 * call). Approving an email whose checks failed is possible, because the
 * operator has the last word, and is recorded as an override; an email whose
 * recipient is blocked (invalid, suppressed, already contacted) cannot be approved.
 * Every operation looks the email up through `draftInWorkspace`: an email of
 * another workspace is "not found" and is never changed.
 */
import { suggestSubjects } from "@/lib/ai/outreach";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, facts, observations, opportunities, outreachDrafts, type DraftIssue, type DraftValidation } from "@/db/schema";
import { nowIso } from "@/lib/ids";
import { businessIdsOf, draftInWorkspace, workspaceId } from "@/lib/workspace";
import { logActivity } from "@/lib/pipeline/prospects";
import { getState, setState, getSettings, type AppSettings } from "@/lib/settings";
import { buildEvidencePack, type EvidencePack } from "./evidence";
import { campaignInWorkspace } from "./campaigns";
import { recipientOf, sendBlockers } from "./eligibility";
import { STEP, stepLabel } from "./steps";
import { checkAnswerText, checkEmailText, hasBlock } from "./validate";

export type Draft = typeof outreachDrafts.$inferSelect;
/** Not yet handed to the mailbox: these can still be edited, replaced or excluded. */
export const REVIEW_STATUSES = ["needs_review", "ready", "approved", "excluded"];

/** What the operator said about themselves in the profile: a figure from there may appear in an email. */
const senderSaysOf = (s: AppSettings) => [s.offer, s.offerResult, s.proofPoints].filter(Boolean).join(" ");

type SignatureSettings = Pick<AppSettings, "senderName" | "senderTitle" | "senderCompany" | "senderWebsite" | "postalAddress"> & Partial<Pick<AppSettings, "signature" | "optOutLine">>;

/** The signature lines without the opt-out sentence: the operator's own text when they wrote one, otherwise built from their details. */
export function signatureLines(s: SignatureSettings): string {
  const own = (s.signature ?? "").replace(/\r/g, "").trim();
  if (own) return own;
  return [s.senderName, [s.senderTitle, s.senderCompany].filter(Boolean).join(", "), s.senderWebsite, s.postalAddress].map((l) => l.trim()).filter(Boolean).join("\n");
}

/** The signature every email ends with: appended by code from Settings, never written by the model. */
export function signatureBlock(s: SignatureSettings, step = 0): string {
  const lines = signatureLines(s) ? signatureLines(s).split("\n") : [];
  // Nothing is added after the signature (decision D55). An opt-out sentence the operator set themselves
  // (`optOutLine`, no field for it at present) still follows it, except on an answer to someone who wrote to us.
  const optOut = step === STEP.answer ? "" : (s.optOutLine ?? "").trim();
  return [lines.join("\n"), optOut].filter(Boolean).join("\n\n");
}

/** The exact text that is sent: the reviewed body plus the signature. */
export function composeEmailBody(body: string, s: Parameters<typeof signatureBlock>[0], step = 0): string {
  return `${body.trim()}\n\n${signatureBlock(s, step)}`.trim();
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

/** Other reviewable emails of the same batch and step (for "do not repeat" checks). Only emails to businesses of the acting workspace count. */
/**
 * The emails a new one must not resemble: the workspace's latest emails of the same step to other companies,
 * whichever batch they are in and whether or not they were sent. An email is written once, for one company.
 */
export async function batchPeers(_campaignId: string | null, businessId: string, step: number) {
  const db = await getDb();
  const rows = await db
    .select({ subject: outreachDrafts.subject, body: outreachDrafts.body, label: businesses.name })
    .from(outreachDrafts)
    .innerJoin(businesses, eq(businesses.id, outreachDrafts.businessId))
    .where(and(eq(businesses.workspaceId, await workspaceId()), eq(outreachDrafts.step, step), ne(outreachDrafts.businessId, businessId), inArray(outreachDrafts.status, ["needs_review", "ready", "approved", "queued", "sending", "sent"])))
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
  if (!(await draftInWorkspace(draftId))) return null;
  return getState<SubjectIdeas>(subjectKey(draftId));
}

/** Ask the model for other subjects for an email under review and keep them with the email until one is used. */
export async function suggestSubjectsFor(draftId: string): Promise<{ ok: boolean; error?: string; count?: number }> {
  const db = await getDb();
  const draft = await draftInWorkspace(draftId);
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
  const draft = await draftInWorkspace(draftId);
  if (!draft) return { ok: false, error: "Email not found" };
  if (!REVIEW_STATUSES.includes(draft.status)) return { ok: false, error: "This email was already handed to the mailbox and can no longer be edited" };
  // An answer stays in its thread: its subject is the thread's and is not edited.
  const cleanSubject = draft.step === STEP.answer ? (draft.subject ?? "") : subject.trim();
  const cleanBody = body.replace(/\r/g, "").trim();
  if (!cleanBody) return { ok: false, error: "The email body is empty" };
  const edited = cleanSubject !== (draft.subject ?? "") || cleanBody !== draft.body;
  if (!edited) return { ok: true };
  const biz = (await db.select().from(businesses).where(eq(businesses.id, draft.businessId)).get())!;
  const settings = await getSettings();
  const normalized = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const claims = draft.claims.filter((c) => normalized(cleanBody).includes(normalized(c.text)));
  let textIssues: DraftIssue[];
  if (draft.step === STEP.answer) textIssues = checkAnswerText(cleanBody, { bookingLink: settings.bookingLink });
  else {
    const { pack, others } = await draftEvidence(draft);
    textIssues = checkEmailText({ subject: cleanSubject, body: cleanBody, claims }, { pack, bookingLink: settings.bookingLink, step: draft.step, others, senderSays: senderSaysOf(settings) });
  }
  const issues = [...textIssues, ...recipientIssues(await sendBlockers(draft, biz, settings))];
  // The claim check ran on the old text: its statements no longer describe this email.
  const validation: DraftValidation = { passed: !hasBlock(issues), issues, checkedBy: null, checkedAt: nowIso() };
  const status = draft.status === "excluded" ? "excluded" : validation.passed ? (draft.status === "approved" ? "approved" : "ready") : "needs_review";
  await db.update(outreachDrafts).set({ subject: cleanSubject, body: cleanBody, claims, validation, warnings: issues.map((i) => i.message), status, editedByUser: true, updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
  await logActivity(draft.businessId, "note", "Outreach email edited.", { draftId });
  return { ok: true };
}

/** Approves an email for sending. Recipient problems cannot be overridden; text checks can. */
export async function approveDraft(draftId: string, by: "operator" | "autopilot" = "operator"): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  const draft = await draftInWorkspace(draftId);
  if (!draft) return { ok: false, error: "Email not found" };
  if (draft.status === "approved") return { ok: true };
  if (!["needs_review", "ready"].includes(draft.status)) return { ok: false, error: `This email is ${draft.status} and cannot be approved` };
  const biz = (await db.select().from(businesses).where(eq(businesses.id, draft.businessId)).get())!;
  const blockers = await sendBlockers(draft, biz, await getSettings());
  if (blockers.length) return { ok: false, error: blockers.join(" ") };
  // An email from before the checks existed has never been read by them: run the fixed checks now, so an approval of it is an informed one.
  let textIssues = (draft.validation?.issues ?? []).filter((i) => i.code !== "recipient");
  if (!draft.validation && draft.step !== STEP.answer) {
    const { pack, others } = await draftEvidence(draft);
    textIssues = checkEmailText({ subject: draft.subject ?? "", body: draft.body, claims: draft.claims }, { pack, bookingLink: (await getSettings()).bookingLink, step: draft.step, others, senderSays: senderSaysOf(await getSettings()) });
  }
  const overridden = hasBlock(textIssues);
  const validation: DraftValidation = { ...(draft.validation ?? { checkedAt: nowIso() }), passed: !overridden, issues: textIssues, overridden: overridden || undefined, checkedAt: draft.validation?.checkedAt ?? nowIso() };
  // The autopilot only ever passes on an email whose checks all passed: it has no last word to override them with.
  if (by === "autopilot" && (overridden || draft.status !== "ready")) return { ok: false, error: "Only an email whose checks all passed goes out on its own" };
  const claimed = await db.update(outreachDrafts).set({ status: "approved", approvedBy: by, toEmail: recipientOf(draft, biz), validation, updatedAt: nowIso() }).where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.status, draft.status))).run();
  if (!claimed.rowsAffected) return { ok: false, error: "This email changed meanwhile" };
  await logActivity(draft.businessId, "system", by === "autopilot" ? `${stepLabel(draft.step)} passed on for sending by the autopilot (all checks passed, the waiting time is over).` : overridden ? "Outreach email approved by the operator although a check had failed." : "Outreach email approved for sending.", { draftId, by });
  return { ok: true };
}

/** Approves every email of the open batch whose checks passed. Returns how many. */
export async function approveAllReady(campaignId: string): Promise<number> {
  if (!(await campaignInWorkspace(campaignId))) return 0;
  const db = await getDb();
  const ready = await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.campaignId, campaignId), eq(outreachDrafts.status, "ready"), inArray(outreachDrafts.businessId, businessIdsOf(db, await workspaceId())))).all();
  let n = 0;
  for (const d of ready) if ((await approveDraft(d.id)).ok) n++;
  return n;
}

export async function unapproveDraft(draftId: string) {
  const db = await getDb();
  await db.update(outreachDrafts).set({ status: "ready", approvedBy: null, updatedAt: nowIso() }).where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.status, "approved"), inArray(outreachDrafts.businessId, businessIdsOf(db, await workspaceId())))).run();
}

/** Takes a recipient out of the batch without deleting the email. */
export async function excludeDraft(draftId: string) {
  const db = await getDb();
  const draft = await draftInWorkspace(draftId);
  if (!draft || !["needs_review", "ready", "approved"].includes(draft.status)) return;
  await db.update(outreachDrafts).set({ status: "excluded", updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
  await logActivity(draft.businessId, "system", "Excluded from the outreach batch by the operator.", { draftId });
}

export async function restoreDraft(draftId: string) {
  const db = await getDb();
  const draft = await draftInWorkspace(draftId);
  if (!draft || draft.status !== "excluded") return;
  await db.update(outreachDrafts).set({ status: draft.validation?.passed ? "ready" : "needs_review", updatedAt: nowIso() }).where(eq(outreachDrafts.id, draftId)).run();
}
