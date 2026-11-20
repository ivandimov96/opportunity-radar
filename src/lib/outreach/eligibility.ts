/**
 * Who may be emailed. The same checks run when an email is written, when it is
 * approved, in the pre-send summary and once more immediately before sending:
 * a valid address that was published by the business, a country the operator
 * allows, not on the do-not-contact list, and never the same address twice.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, outreachDrafts, pages } from "@/db/schema";
import { emailSyntaxOk, normalizeAddress } from "@/lib/email/address";
import { suppressionFor } from "@/lib/email/suppression";
import type { AppSettings } from "@/lib/settings";
import { workspaceId } from "@/lib/workspace";
import { STEP } from "./steps";

export type ContactBusiness = Pick<typeof businesses.$inferSelect, "id" | "email" | "emailStatus" | "country">;

/** Statuses that mean a message to this address is on its way or delivered. */
export const OUTBOUND_COMMITTED = ["queued", "sending", "sent", "bounced"];

/** Reasons this business cannot be emailed right now, in plain words. Empty = it can. */
export async function contactBlockers(biz: ContactBusiness, settings: Pick<AppSettings, "allowedCountries">): Promise<string[]> {
  const reasons: string[] = [];
  const email = normalizeAddress(biz.email);
  if (!email) return ["No email address on record."];
  if (!emailSyntaxOk(email)) reasons.push(`"${email}" is not a valid email address.`);
  else if (biz.emailStatus === "invalid") reasons.push(`${email} cannot receive mail (its domain has no mail servers).`);
  const sup = await suppressionFor(email);
  if (sup) reasons.push(`${sup.value} is on your do-not-contact list (${sup.reason}).`);
  const allowed = settings.allowedCountries;
  if (allowed.length && !allowed.includes((biz.country ?? "").toUpperCase())) reasons.push(`Country ${biz.country ?? "unknown"} is not in your allowed list (${allowed.join(", ")}).`);
  const db = await getDb();
  const other = await db
    .select({ name: businesses.name })
    .from(outreachDrafts)
    .innerJoin(businesses, eq(businesses.id, outreachDrafts.businessId))
    // "Never the same address twice" is a promise inside one workspace: what another workspace sent is not ours to know or to count.
    .where(and(eq(businesses.workspaceId, await workspaceId()), eq(outreachDrafts.toEmail, email), ne(outreachDrafts.businessId, biz.id), inArray(outreachDrafts.status, OUTBOUND_COMMITTED)))
    .limit(1)
    .get();
  if (other) reasons.push(`${email} was already emailed for ${other.name}.`);
  return reasons;
}

type RecipientDraft = Pick<typeof outreachDrafts.$inferSelect, "step" | "toEmail">;

/** Where an email goes: an answer goes to the person who wrote; everything else to the business's address on record. */
export function recipientOf(draft: RecipientDraft, biz: Pick<ContactBusiness, "email">): string | null {
  return normalizeAddress(draft.step === STEP.answer ? draft.toEmail : biz.email);
}

/**
 * Reasons this email cannot go out right now. For an answer only the person who wrote is checked (a valid
 * address that has not opted out since): they wrote to us, so the country and "already emailed" rules do not apply.
 */
export async function sendBlockers(draft: RecipientDraft, biz: ContactBusiness, settings: Pick<AppSettings, "allowedCountries">): Promise<string[]> {
  if (draft.step !== STEP.answer) return contactBlockers(biz, settings);
  const email = normalizeAddress(draft.toEmail);
  if (!email) return ["The reply has no sender address to answer."];
  if (!emailSyntaxOk(email)) return [`"${email}" is not a valid email address.`];
  const sup = await suppressionFor(email);
  return sup ? [`${sup.value} is on your do-not-contact list (${sup.reason}).`] : [];
}

/** "Ltd", "Limited", "LLP", "PLC", a company number or a registered-in line: the business says it is a company. */
const UK_COMPANY_RE = /\b(ltd|limited|llp|plc)\b|\bcompany\s+(number|no\.?|reg(istration)?)\b|\bregistered\s+(in|office)\b/i;

/**
 * Why an email that passed every check must still not go out without a person, or null.
 * UK rules allow unasked-for business email to companies and LLPs, but treat sole traders and
 * ordinary partnerships as individuals who must have agreed first. When neither the name nor
 * the pages read from the business's website show a legal form, the operator decides.
 */
export async function automaticSendHold(biz: Pick<typeof businesses.$inferSelect, "id" | "name" | "country">): Promise<string | null> {
  if ((biz.country ?? "").toUpperCase() !== "GB") return null;
  if (UK_COMPANY_RE.test(biz.name)) return null;
  const db = await getDb();
  const rows = await db.select({ text: pages.text }).from(pages).where(eq(pages.businessId, biz.id)).all();
  if (rows.some((r) => UK_COMPANY_RE.test(r.text ?? ""))) return null;
  return "Nothing on their website shows this is a company (Ltd, LLP, a company number). A UK sole trader may only be emailed with their agreement: check before you send.";
}
