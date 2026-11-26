/**
 * Confirming that an account's email address belongs to the person: a link sent to it, valid once and for a
 * day. Asked for only while the product sends its own emails (account-emails.ts); an account made with
 * Google or Microsoft is confirmed from the start, because they vouch for the address.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { emailVerifications, users } from "@/db/schema";
import { nowIso } from "@/lib/ids";
import { sendAccountEmail } from "./account-mail";

const LINK_HOURS = 24;
/** Links one account may be sent within an hour: more are quietly not sent. */
const LINKS_PER_HOUR = 5;
const hashOf = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** Sends the confirmation link to an account that has not confirmed yet. Returns whether an email went out. */
export async function sendVerification(userId: string, origin: string): Promise<boolean> {
  const db = await getDb();
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || user.emailVerifiedAt) return false;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const recent = Number((await db.select({ n: sql<number>`count(*)` }).from(emailVerifications).where(and(eq(emailVerifications.userId, user.id), gte(emailVerifications.createdAt, hourAgo))).get())?.n ?? 0);
  if (recent >= LINKS_PER_HOUR) return false;
  const secret = randomBytes(32).toString("base64url");
  const link = `${origin.replace(/\/+$/, "")}/verify-email?token=${secret}`;
  const first = user.name.split(/\s+/)[0];
  const sent = await sendAccountEmail({
    to: user.email,
    subject: "Confirm your email address",
    text: `${first ? `Hi ${first},` : "Hello,"}\n\nWelcome to Opportunity Radar. Open this link to confirm that this address is yours:\n\n${link}\n\nIt works for one day. If you did not create an account, ignore this email and nothing happens.\n\nOpportunity Radar`,
  });
  // Kept only for an email that really left: a link nobody received must not count against the hourly allowance.
  if (sent) await db.insert(emailVerifications).values({ id: hashOf(secret), userId: user.id, createdAt: nowIso(), expiresAt: new Date(Date.now() + LINK_HOURS * 3_600_000).toISOString() }).run();
  return sent;
}

/** Uses a link: the account it was sent to is confirmed. Returns that account's email, or null when the link does not work (unknown, used, too old). */
export async function verifyEmail(secret: string): Promise<string | null> {
  if (!secret) return null;
  const db = await getDb();
  const now = nowIso();
  const claimed = await db.update(emailVerifications).set({ usedAt: now }).where(and(eq(emailVerifications.id, hashOf(secret)), isNull(emailVerifications.usedAt), gt(emailVerifications.expiresAt, now))).returning({ userId: emailVerifications.userId }).get();
  if (!claimed) return null;
  const user = await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, claimed.userId)).returning({ email: users.email }).get();
  return user?.email ?? null;
}
