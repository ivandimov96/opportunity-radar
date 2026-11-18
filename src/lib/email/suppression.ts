/**
 * The suppression list: addresses and domains that must never be emailed again
 * (opt-outs, hard bounces, manual entries). It is checked when an email is
 * written, when a campaign is prepared and again immediately before each send.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { suppressions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { emailDomain, emailSyntaxOk, isFreemail, normalizeAddress } from "./address";

export type SuppressionReason = "unsubscribed" | "bounced" | "declined" | "manual";

/** The suppression entry that blocks this address (its own, or its domain's), or null. */
export async function suppressionFor(email: string | null | undefined) {
  const e = normalizeAddress(email);
  if (!e || !e.includes("@")) return null;
  const db = await getDb();
  return (await db.select().from(suppressions).where(inArray(suppressions.value, [e, emailDomain(e)])).get()) ?? null;
}

export async function isSuppressed(email: string | null | undefined): Promise<boolean> {
  return (await suppressionFor(email)) !== null;
}

/**
 * Adds an address (or a bare domain) to the list. A freemail domain (gmail.com…)
 * is never suppressed as a whole: that would block unrelated businesses.
 */
export async function addSuppression(value: string, reason: SuppressionReason, note?: string | null): Promise<{ added: boolean; error?: string }> {
  const v = value.trim().toLowerCase().replace(/^@/, "");
  const isEmail = v.includes("@");
  if (isEmail ? !emailSyntaxOk(v) : !/^([a-z0-9-]+\.)+[a-z]{2,24}$/.test(v)) return { added: false, error: "Enter an email address or a domain" };
  if (!isEmail && isFreemail(`x@${v}`)) return { added: false, error: `${v} is a public mailbox provider; suppress the individual address instead` };
  const db = await getDb();
  const res = await db.insert(suppressions).values({ id: newId(), value: v, kind: isEmail ? "email" : "domain", reason, note: note?.trim() || null }).onConflictDoNothing().run();
  return { added: res.rowsAffected > 0 };
}

export async function removeSuppression(id: string) {
  const db = await getDb();
  await db.delete(suppressions).where(eq(suppressions.id, id)).run();
}

export async function listSuppressions(limit = 200) {
  const db = await getDb();
  return db.select().from(suppressions).orderBy(desc(suppressions.createdAt)).limit(limit).all();
}
