/**
 * Accounts and sessions. Passwords are hashed with scrypt and a random salt;
 * a session is a row in `sessions` and a signed, http-only cookie. Nothing
 * here ever returns or logs a password or a hash.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { SESSION_COOKIE, makeToken, readToken, type Role } from "./token";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
/** What a password must be: long enough to resist guessing, with a letter and a digit. Returns what is wrong, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 200) return "That password is too long.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use at least one letter and one number.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Creates an account. The very first account owns the workspace; later ones are members without one. */
export async function createUser(input: { email: string; password: string; name?: string; role?: Role }): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) return { ok: false, error: "That does not look like an email address." };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };
  const db = await getDb();
  if (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) return { ok: false, error: "An account with this email already exists. Sign in instead." };
  const first = !(await db.select({ id: users.id }).from(users).limit(1).get());
  const user: SessionUser = { id: newId(), email, name: (input.name ?? "").trim().slice(0, 80), role: input.role ?? (first ? "owner" : "member") };
  await db.insert(users).values({ ...user, passwordHash: await hashPassword(input.password), createdAt: nowIso() }).run();
  return { ok: true, user };
}

/** The user for an email and password, or null. Takes the same time whether or not the email exists. */
export async function checkLogin(emailRaw: string, password: string): Promise<SessionUser | null> {
  const db = await getDb();
  const row = await db.select().from(users).where(eq(users.email, normalizeEmail(emailRaw))).get();
  const ok = await verifyPassword(password, row?.passwordHash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==");
  if (!row || !ok) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role === "owner" ? "owner" : "member" };
}

export async function startSession(user: SessionUser): Promise<void> {
  const db = await getDb();
  const id = newId();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.batch([
    db.delete(sessions).where(lt(sessions.expiresAt, nowIso())),
    db.insert(sessions).values({ id, userId: user.id, createdAt: nowIso(), expiresAt: expires.toISOString() }),
    db.update(users).set({ lastLoginAt: nowIso() }).where(eq(users.id, user.id)),
  ]);
  (await cookies()).set(SESSION_COOKIE, await makeToken(id, user.role), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = await readToken(jar.get(SESSION_COOKIE)?.value);
  if (token) await (await getDb()).delete(sessions).where(eq(sessions.id, token.sessionId)).run();
  jar.delete(SESSION_COOKIE);
}

/** Who is signed in on this request, checked against the database; null when nobody is. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = await readToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!token) return null;
  const db = await getDb();
  const row = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, token.sessionId), gt(sessions.expiresAt, nowIso())))
    .get();
  return row ? { ...row, role: row.role === "owner" ? "owner" : "member" } : null;
}

/** For everything that touches the workspace: the signed-in owner, or a redirect to the sign-in page. */
export async function requireOwner(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "owner") redirect("/welcome");
  return user;
}
