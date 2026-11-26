/**
 * Accounts and sessions. Passwords are hashed with scrypt and a random salt;
 * a session is a row in `sessions` and a signed, http-only cookie. Nothing
 * here ever returns or logs a password or a hash.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { FIRST_WORKSPACE_ID, sessions, users, workspaces, settings } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { SESSION_COOKIE, WELCOME_COOKIE, WELCOME_SECONDS, makeToken, readToken, type Role } from "./token";
import { accountEmailsOn } from "./account-emails";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** The workspace this user works in: every search, business and email they see belongs to it. */
  workspaceId: string;
  /** When the address was confirmed as theirs; null = not yet. Left out where it was not looked up. */
  emailVerifiedAt?: string | null;
}

/**
 * The workspace a new account gets. The first account ever takes the first
 * workspace (which holds whatever existed before accounts); every later
 * account gets a new, empty one of its own.
 */
export async function workspaceForNewUser(first: boolean, name: string): Promise<string> {
  const db = await getDb();
  const id = first ? FIRST_WORKSPACE_ID : newId();
  // The first workspace is the product's own (no plan limits); everyone after it starts on the trial.
  await db.insert(workspaces).values({ id, name: name ? `${name}'s workspace` : "", plan: first ? "owner" : "trial", createdAt: nowIso() }).onConflictDoNothing().run();
  return id;
}

/** Marks a workspace as new: its owner is taken through the first-run setup before the app opens (see src/app/setup). */
/**
 * Whether someone who signs up gets to work straight away. Open (the default): every new account owns a
 * workspace of its own, on the trial plan, and starts with the first-run setup. SIGNUP_MODE=waitlist keeps
 * new accounts on the welcome page until they are opened by hand.
 */
export const signupsOpen = () => process.env.SIGNUP_MODE?.trim().toLowerCase() !== "waitlist";
/** The role of an account someone creates for themselves. The very first account always owns the first workspace. */
export const roleForSignup = (first: boolean): Role => (first || signupsOpen() ? "owner" : "member");

/** Where someone goes right after signing in: the waiting page, the first-run setup still ahead of them, or `next`. */
/**
 * Whether the person still has to confirm their address before the app opens: asked only while the product
 * sends its own emails, and only of an account that was looked up and found unconfirmed.
 */
export const mustConfirmEmail = (user: SessionUser) => accountEmailsOn() && user.emailVerifiedAt === null;

export async function landingAfterSignIn(user: SessionUser, next = "/"): Promise<string> {
  if (user.role !== "owner") return "/welcome";
  if (mustConfirmEmail(user)) return "/verify-email";
  const db = await getDb();
  const row = await db.select({ value: settings.value }).from(settings).where(and(eq(settings.workspaceId, user.workspaceId), eq(settings.key, "state:onboarding"))).get();
  return row?.value === "pending" ? "/setup" : next;
}

export async function markOnboardingPending(workspaceId: string): Promise<void> {
  const db = await getDb();
  await db.insert(settings).values({ workspaceId, key: "state:onboarding", value: "pending", updatedAt: nowIso() }).onConflictDoNothing().run();
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

/** Creates an account. The very first account owns the first workspace; a later one owns a new workspace of its own (or waits for one, see `signupsOpen`). */
export async function createUser(input: { email: string; password: string; name?: string; role?: Role }): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) return { ok: false, error: "That does not look like an email address." };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };
  const db = await getDb();
  if (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) return { ok: false, error: "An account with this email already exists. Sign in instead." };
  const first = !(await db.select({ id: users.id }).from(users).limit(1).get());
  const name = (input.name ?? "").trim().slice(0, 80);
  const role = input.role ?? roleForSignup(first);
  // An owner made on purpose after the first account (from the command line) shares the first workspace;
  // someone who signed up themselves gets a workspace of their own.
  // The very first account and one made on purpose (from the command line) are trusted; someone who signs up confirms their address.
  const user: SessionUser = { id: newId(), email, name, role, workspaceId: await workspaceForNewUser(first || input.role === "owner", name), emailVerifiedAt: first || input.role ? nowIso() : null };
  await db.insert(users).values({ ...user, passwordHash: await hashPassword(input.password), createdAt: nowIso() }).run();
  // Someone who signed up themselves is new to the product: their workspace starts with the first-run setup.
  // (An account made from the command line or a test, with its role given, does not.)
  if (!input.role) await markOnboardingPending(user.workspaceId);
  return { ok: true, user };
}

/** The user for an email and password, or null. Takes the same time whether or not the email exists. */
export async function checkLogin(emailRaw: string, password: string): Promise<SessionUser | null> {
  const db = await getDb();
  const row = await db.select().from(users).where(eq(users.email, normalizeEmail(emailRaw))).get();
  const ok = await verifyPassword(password, row?.passwordHash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==");
  if (!row || !ok) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role === "owner" ? "owner" : "member", workspaceId: row.workspaceId, emailVerifiedAt: row.emailVerifiedAt };
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
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await makeToken(id, user.role), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires });
  // Just arrived: the page they land on shows the radar once (see src/app/loading.tsx). It says nothing about who they are.
  jar.set(WELCOME_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: WELCOME_SECONDS });
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
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, workspaceId: users.workspaceId, emailVerifiedAt: users.emailVerifiedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, token.sessionId), gt(sessions.expiresAt, nowIso())))
    .get();
  return row ? { ...row, role: row.role === "owner" ? "owner" : "member" } : null;
}

/** How an account signs in: with a password of its own, or through Google or Microsoft. */
export async function signInMethod(userId: string): Promise<"password" | "google" | "microsoft"> {
  const row = await (await getDb()).select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId)).get();
  return row?.hash === "google" ? "google" : row?.hash.startsWith("microsoft:") ? "microsoft" : "password";
}

/**
 * Changes the password of the signed-in account after checking the current one. Every other session of the
 * account ends; the one asking stays signed in.
 */
export async function changePassword(user: SessionUser, current: string, next: string): Promise<string | null> {
  if (!(await checkLogin(user.email, current))) return "The current password is not right.";
  const problem = passwordProblem(next);
  if (problem) return problem;
  if (current === next) return "Choose a password that is different from the current one.";
  const db = await getDb();
  const token = await readToken((await cookies()).get(SESSION_COOKIE)?.value);
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, user.id)).run();
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, token?.sessionId ?? ""))).run();
  return null;
}

/** For everything that touches the workspace: the signed-in owner, or a redirect to the sign-in page. */
export async function requireOwner(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "owner") redirect("/welcome");
  // Nothing of the workspace opens before the address is confirmed.
  if (mustConfirmEmail(user)) redirect("/verify-email");
  return user;
}
