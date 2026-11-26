/**
 * Choosing a new password when the old one is forgotten. A link is sent to the account's own address; it
 * carries a secret of which only a hash is kept, works once and for an hour, and using it signs the account
 * out everywhere. Whether an address has an account is never said: the answer is the same either way.
 *
 * The email is sent from the product's own mailbox (the first workspace's default one), and only when the
 * operator switched account emails on (ACCOUNT_EMAILS=on): until then nothing is sent and the page says
 * whom to write to instead.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { passwordResets, sessions, users } from "@/db/schema";
import { nowIso } from "@/lib/ids";
import { accountEmailsOn } from "./account-emails";
import { sendAccountEmail } from "./account-mail";
import { hashPassword, normalizeEmail, passwordProblem } from "./index";

const LINK_MINUTES = 60;
/** Links one account may ask for within an hour: more are quietly not sent. */
const LINKS_PER_HOUR = 3;

export { accountEmailsOn };
const hashOf = (secret: string) => createHash("sha256").update(secret).digest("hex");

/**
 * Sends a reset link to the address when it has an account with a password. Returns whether an email went
 * out, for tests and logs only: the page must say the same thing whatever this returns.
 */
export async function requestPasswordReset(emailRaw: string, origin: string): Promise<boolean> {
  if (!accountEmailsOn()) return false;
  const db = await getDb();
  const user = await db.select().from(users).where(eq(users.email, normalizeEmail(emailRaw))).get();
  // An account that signs in with Google or Microsoft has no password to reset.
  if (!user || !user.passwordHash.startsWith("scrypt$")) return false;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const recent = Number((await db.select({ n: sql<number>`count(*)` }).from(passwordResets).where(and(eq(passwordResets.userId, user.id), gte(passwordResets.createdAt, hourAgo))).get())?.n ?? 0);
  if (recent >= LINKS_PER_HOUR) return false;
  const secret = randomBytes(32).toString("base64url");
  await db.insert(passwordResets).values({ id: hashOf(secret), userId: user.id, createdAt: nowIso(), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000).toISOString() }).run();
  const link = `${origin.replace(/\/+$/, "")}/reset-password?token=${secret}`;
  const first = user.name.split(/\s+/)[0];
  return sendAccountEmail({
    to: user.email,
    subject: "Choose a new password",
    text: `${first ? `Hi ${first},` : "Hello,"}\n\nSomeone asked to choose a new password for your Opportunity Radar account. If that was you, open this link within the next hour:\n\n${link}\n\nIf it was not you, ignore this email: your password stays as it is.\n\nOpportunity Radar`,
  });
}

/** Whether a link's secret still opens the page: known, unused and not older than an hour. */
export async function resetLinkValid(secret: string): Promise<boolean> {
  if (!secret) return false;
  const db = await getDb();
  return Boolean(await db.select({ id: passwordResets.id }).from(passwordResets).where(and(eq(passwordResets.id, hashOf(secret)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, nowIso()))).get());
}

/** Sets the new password with a valid link. The link is used up first, in one statement, so it cannot be used twice. */
export async function resetPassword(secret: string, password: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  const db = await getDb();
  const now = nowIso();
  const claimed = await db.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.id, hashOf(secret)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now))).returning({ userId: passwordResets.userId }).get();
  if (!claimed) return { ok: false, error: "This link no longer works. Ask for a new one." };
  const hash = await hashPassword(password);
  // The link reached them in that mailbox, so the address is theirs: it counts as confirmed too.
  const user = await db.update(users).set({ passwordHash: hash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now})` }).where(eq(users.id, claimed.userId)).returning({ email: users.email }).get();
  if (!user) return { ok: false, error: "This link no longer works. Ask for a new one." };
  // Whoever had the old password is signed out, and any other link still on its way stops working.
  await db.delete(sessions).where(eq(sessions.userId, claimed.userId)).run();
  await db.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.userId, claimed.userId), isNull(passwordResets.usedAt))).run();
  return { ok: true, email: user.email };
}
