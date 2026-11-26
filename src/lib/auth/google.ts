/**
 * "Continue with Google": the standard sign-in with Google (OAuth 2.0, the
 * authorization-code flow), without any library. It needs a client id and
 * secret from the Google Cloud console in .env (GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET) and the redirect address
 * <site>/auth/google/callback registered there.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { markOnboardingPending, normalizeEmail, roleForSignup, workspaceForNewUser, type SessionUser } from "./index";

export const GOOGLE_STATE_COOKIE = "radar_google_state";
export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const randomToken = () => randomBytes(24).toString("base64url");

export function googleAuthUrl(origin: string, state: string, nonce: string): string {
  const p = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", redirect_uri: `${origin}/auth/google/callback`, response_type: "code", scope: "openid email profile", state, nonce, prompt: "select_account" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Exchanges the code Google sent back for the person's verified email and name. Throws with a plain reason when anything does not check out. */
export async function googleProfile(origin: string, code: string, nonce: string): Promise<{ email: string; name: string }> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: `${origin}/auth/google/callback`, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { id_token?: string };
  if (!tokenRes.ok || !token.id_token) throw new Error("Google did not confirm the sign-in.");
  // Google checks the token's signature and expiry for us and returns what it says.
  const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token.id_token)}`, { signal: AbortSignal.timeout(15_000) });
  const info = (await infoRes.json().catch(() => ({}))) as { aud?: string; email?: string; email_verified?: string | boolean; name?: string; nonce?: string };
  if (!infoRes.ok || info.aud !== process.env.GOOGLE_CLIENT_ID || info.nonce !== nonce) throw new Error("Google's answer could not be verified.");
  if (!info.email || String(info.email_verified) !== "true") throw new Error("That Google account has no verified email address.");
  return { email: normalizeEmail(info.email), name: (info.name ?? "").slice(0, 80) };
}

/** The account for a Google email: the existing one, or a new one with a workspace of its own. */
export async function userForGoogle(profile: { email: string; name: string }): Promise<SessionUser> {
  const db = await getDb();
  const row = await db.select().from(users).where(eq(users.email, profile.email)).get();
  if (row) {
    // Google vouches for the address: signing in with it confirms an account that had not confirmed yet.
    const verified = row.emailVerifiedAt ?? nowIso();
    if (!row.emailVerifiedAt) await db.update(users).set({ emailVerifiedAt: verified }).where(eq(users.id, row.id)).run();
    return { id: row.id, email: row.email, name: row.name, role: row.role === "owner" ? "owner" : "member", workspaceId: row.workspaceId, emailVerifiedAt: verified };
  }
  const first = !(await db.select({ id: users.id }).from(users).limit(1).get());
  const user: SessionUser = { id: newId(), email: profile.email, name: profile.name, role: roleForSignup(first), workspaceId: await workspaceForNewUser(first, profile.name), emailVerifiedAt: nowIso() };
  // No password: this account signs in with Google only (the marker can never match a typed password).
  await db.insert(users).values({ ...user, passwordHash: "google", createdAt: nowIso() }).run();
  await markOnboardingPending(user.workspaceId);
  return user;
}
