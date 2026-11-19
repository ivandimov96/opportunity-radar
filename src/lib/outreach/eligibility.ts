/**
 * Who may be emailed. The same checks run when an email is written, when it is
 * approved, in the pre-send summary and once more immediately before sending:
 * a valid address that was published by the business, a country the operator
 * allows, not on the do-not-contact list, and never the same address twice.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, outreachDrafts } from "@/db/schema";
import { emailSyntaxOk, normalizeAddress } from "@/lib/email/address";
import { suppressionFor } from "@/lib/email/suppression";
import type { AppSettings } from "@/lib/settings";
import { workspaceId } from "@/lib/workspace";

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
