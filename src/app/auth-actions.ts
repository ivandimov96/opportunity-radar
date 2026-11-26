"use server";
/**
 * Signing up, in and out. These are the only actions a visitor can use.
 * Attempts are limited per email address so a password cannot be guessed by
 * trying many; the answer to a wrong email and to a wrong password is the same.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestPasswordReset, resetPassword } from "@/lib/auth/reset";
import { siteOrigin } from "@/lib/mail/microsoft";
import { changePassword, checkLogin, createUser, currentUser, endSession, landingAfterSignIn, mustConfirmEmail, normalizeEmail, startSession } from "@/lib/auth";
import { sendVerification } from "@/lib/auth/verify";

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
// Where someone lands is decided here, at the moment of signing in (`landingAfterSignIn`), so a new account
// goes to its first-run setup directly: a page must not send them there while it is already being drawn.
const text = (fd: FormData, k: string) => (fd.get(k)?.toString() ?? "").slice(0, 300);
/** Only a path inside this app may be returned to after signing in. */
const safeNext = (next: string) => (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") && !next.startsWith("/signup") ? next : "/");
const back = (page: string, error: string, email: string, next = "", name = "") => `${page}?error=${encodeURIComponent(error)}&email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}${name ? `&name=${encodeURIComponent(name)}` : ""}`;

/** The site's own address, for the links put into emails. */
const origin = async () => siteOrigin({ headers: await headers(), nextUrl: { protocol: "http:", origin: "http://localhost:3000" } });

export async function loginAction(fd: FormData) {
  const email = normalizeEmail(text(fd, "email"));
  const next = text(fd, "next");
  if (tooMany(`login:${email}`)) redirect(back("/login", "Too many attempts. Wait ten minutes and try again.", email, next));
  const user = await checkLogin(email, text(fd, "password"));
  if (!user) redirect(back("/login", "The email or the password is not right.", email, next));
  attempts.delete(`login:${email}`);
  await startSession(user);
  redirect(await landingAfterSignIn(user, safeNext(next)));
}

export async function signupAction(fd: FormData) {
  const email = normalizeEmail(text(fd, "email"));
  const name = text(fd, "name").slice(0, 80);
  if (tooMany(`signup:${email}`)) redirect(back("/signup", "Too many attempts. Wait ten minutes and try again.", email, "", name));
  const res = await createUser({ email, password: text(fd, "password"), name });
  // What was typed comes back with the reason, so only the password is typed again.
  if (!res.ok) redirect(back("/signup", res.error, email, "", name));
  await startSession(res.user);
  // The link that confirms the address goes out at once; the page they land on says so.
  if (mustConfirmEmail(res.user)) await sendVerification(res.user.id, await origin()).catch((err) => console.warn("[auth] the confirmation email could not be sent", err instanceof Error ? err.message : err));
  redirect(await landingAfterSignIn(res.user));
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}

/** "Forgot your password?": sends the link when the address has an account. The page that follows says the same either way. */
export async function requestResetAction(fd: FormData) {
  const email = normalizeEmail(text(fd, "email"));
  if (tooMany(`reset:${email}`)) redirect(back("/forgot-password", "Too many attempts. Wait ten minutes and try again.", email));
  await requestPasswordReset(email, await origin()).catch((err) => console.warn("[auth] the password email could not be sent", err instanceof Error ? err.message : err));
  redirect(`/forgot-password?sent=1&email=${encodeURIComponent(email)}`);
}

/** The link from the email: sets the new password, signs the account out everywhere else and in here. */
export async function resetPasswordAction(fd: FormData) {
  const token = text(fd, "token");
  const res = await resetPassword(token, text(fd, "password"));
  if (!res.ok) redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(res.error)}`);
  const user = await checkLogin(res.email, text(fd, "password"));
  if (!user) redirect("/login");
  attempts.delete(`login:${res.email}`);
  await startSession(user);
  redirect(await landingAfterSignIn(user));
}

/** "Send the link again", on the page a not yet confirmed account waits on. */
export async function resendVerificationAction() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!mustConfirmEmail(user)) redirect(await landingAfterSignIn(user));
  if (tooMany(`verify:${user.id}`)) redirect(`/verify-email?error=${encodeURIComponent("Too many attempts. Wait ten minutes and try again.")}`);
  const sent = await sendVerification(user.id, await origin()).catch(() => false);
  redirect(sent ? "/verify-email?sent=1" : `/verify-email?error=${encodeURIComponent("The email could not be sent just now. Try again in a few minutes.")}`);
}

/** A new password, from inside the account. */
export async function changePasswordAction(fd: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (tooMany(`password:${user.id}`)) redirect(`/account?error=${encodeURIComponent("Too many attempts. Wait ten minutes and try again.")}#change-password`);
  const problem = await changePassword(user, text(fd, "currentPassword"), text(fd, "password"));
  redirect(problem ? `/account?error=${encodeURIComponent(problem)}#change-password` : `/account?ok=${encodeURIComponent("Your password is changed. Other devices were signed out.")}`);
}
