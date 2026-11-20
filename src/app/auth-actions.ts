"use server";
/**
 * Signing up, in and out. These are the only actions a visitor can use.
 * Attempts are limited per email address so a password cannot be guessed by
 * trying many; the answer to a wrong email and to a wrong password is the same.
 */
import { redirect } from "next/navigation";
import { checkLogin, createUser, endSession, normalizeEmail, startSession } from "@/lib/auth";
import { getState } from "@/lib/settings";
import { runInWorkspace } from "@/lib/workspace";

const attempts = new Map<string, { n: number; at: number }>();
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 8;
function tooMany(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.at > WINDOW_MS) {
    attempts.set(key, { n: 1, at: now });
    return false;
  }
  a.n++;
  return a.n > MAX_ATTEMPTS;
}
/**
 * Whether the account's first-run setup is still ahead of it. Asked here, at the moment of signing in, so the
 * person is sent to the setup directly: a page must not send them there while it is already being drawn.
 */
const setupAhead = async (workspaceId: string) => (await runInWorkspace(workspaceId, () => getState<string>("onboarding"))) === "pending";
const text = (fd: FormData, k: string) => (fd.get(k)?.toString() ?? "").slice(0, 300);
/** Only a path inside this app may be returned to after signing in. */
const safeNext = (next: string) => (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") && !next.startsWith("/signup") ? next : "/");
const back = (page: string, error: string, email: string, next = "") => `${page}?error=${encodeURIComponent(error)}&email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

export async function loginAction(fd: FormData) {
  const email = normalizeEmail(text(fd, "email"));
  const next = text(fd, "next");
  if (tooMany(`login:${email}`)) redirect(back("/login", "Too many attempts. Wait ten minutes and try again.", email, next));
  const user = await checkLogin(email, text(fd, "password"));
  if (!user) redirect(back("/login", "The email or the password is not right.", email, next));
  attempts.delete(`login:${email}`);
  await startSession(user);
  redirect(user.role !== "owner" ? "/welcome" : (await setupAhead(user.workspaceId)) ? "/setup" : safeNext(next));
}

export async function signupAction(fd: FormData) {
  const email = normalizeEmail(text(fd, "email"));
  if (tooMany(`signup:${email}`)) redirect(back("/signup", "Too many attempts. Wait ten minutes and try again.", email));
  const res = await createUser({ email, password: text(fd, "password"), name: text(fd, "name") });
  if (!res.ok) redirect(back("/signup", res.error, email));
  await startSession(res.user);
  redirect(res.user.role !== "owner" ? "/welcome" : (await setupAhead(res.user.workspaceId)) ? "/setup" : "/");
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}
