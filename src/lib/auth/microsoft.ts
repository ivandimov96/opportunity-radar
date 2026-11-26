/**
 * "Continue with Microsoft": signing in to the product with a Microsoft account
 * (Outlook.com, Hotmail, Microsoft 365), the standard OAuth 2.0 authorization-
 * code flow without any library. It uses the same app registration as the
 * Microsoft mailbox connection (MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET)
 * and needs one more redirect address registered there:
 * <site>/auth/microsoft/callback. It asks only who the person is (User.Read);
 * it does not touch their mail.
 *
 * An account is tied to the Microsoft identity it was created with, not just
 * to its email address: the address a work account reports is set by that
 * organisation's administrator, so it must never open an account that was
 * created another way.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { isEmail, markOnboardingPending, normalizeEmail, roleForSignup, workspaceForNewUser, type SessionUser } from "./index";

export const MICROSOFT_SIGNIN_COOKIE = "radar_ms_signin_state";
export const MICROSOFT_SIGNIN_CALLBACK = "/auth/microsoft/callback";
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const SCOPE = "openid email profile User.Read";

export const microsoftSignInConfigured = () => Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);

export function microsoftSignInUrl(origin: string, state: string): string {
  const p = new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID ?? "", response_type: "code", response_mode: "query", redirect_uri: `${origin}${MICROSOFT_SIGNIN_CALLBACK}`, scope: SCOPE, state, prompt: "select_account" });
  return `${AUTHORITY}/authorize?${p}`;
}

export interface MicrosoftIdentity {
  /** Microsoft's own id of the account: what the product's account is tied to. */
  id: string;
  email: string;
  name: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** Test hook. */
export function _setMicrosoftSignInFetch(fn: FetchLike | null) {
  fetchImpl = fn ?? ((url, init) => fetch(url, init));
}

/** Exchanges the code Microsoft sent back for who signed in. Throws with a plain reason when anything does not check out. */
export async function microsoftIdentity(origin: string, code: string): Promise<MicrosoftIdentity> {
  const tokenRes = await fetchImpl(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID ?? "", client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "", grant_type: "authorization_code", code, redirect_uri: `${origin}${MICROSOFT_SIGNIN_CALLBACK}`, scope: SCOPE }),
    signal: AbortSignal.timeout(15_000),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenRes.ok || !token.access_token) throw new Error("Microsoft did not confirm the sign-in.");
  // Asked of Microsoft itself with the token it just issued to us: the answer is the account that signed in.
  const meRes = await fetchImpl("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) });
  const me = (await meRes.json().catch(() => ({}))) as { id?: string; displayName?: string; mail?: string | null; userPrincipalName?: string };
  if (!meRes.ok || !me.id) throw new Error("Microsoft did not say who signed in.");
  const email = normalizeEmail(me.mail || me.userPrincipalName || "");
  if (!isEmail(email)) throw new Error("That Microsoft account has no email address.");
  return { id: me.id, email, name: (me.displayName ?? "").slice(0, 80) };
}

const marker = (id: string) => `microsoft:${id}`;

/** The account for a Microsoft identity: the one created with it, or a new one. An account made another way is never opened by it. */
export async function userForMicrosoft(who: MicrosoftIdentity): Promise<SessionUser> {
  const db = await getDb();
  const row = await db.select().from(users).where(eq(users.email, who.email)).get();
  if (row) {
    if (row.passwordHash !== marker(who.id)) throw new Error("An account with this email already exists. Sign in the way you created it.");
    return { id: row.id, email: row.email, name: row.name, role: row.role === "owner" ? "owner" : "member", workspaceId: row.workspaceId, emailVerifiedAt: row.emailVerifiedAt };
  }
  const first = !(await db.select({ id: users.id }).from(users).limit(1).get());
  const user: SessionUser = { id: newId(), email: who.email, name: who.name, role: roleForSignup(first), workspaceId: await workspaceForNewUser(first, who.name), emailVerifiedAt: nowIso() };
  // No password: this account signs in with Microsoft only (the marker can never match a typed password).
  await db.insert(users).values({ ...user, passwordHash: marker(who.id), createdAt: nowIso() }).run();
  await markOnboardingPending(user.workspaceId);
  return user;
}
