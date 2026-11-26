/**
 * The product's own emails to its users: confirming an address at sign-up, the product's own sender, and a
 * new password from inside the account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetEnv, useTempDb } from "../helpers";
import { emailVerifications, sessions, users } from "@/db/schema";
import { changePassword, checkLogin, createUser, landingAfterSignIn, mustConfirmEmail, signInMethod } from "@/lib/auth";
import { _setAccountTransport, sendAccountEmail } from "@/lib/auth/account-mail";
import { accountEmailsOn } from "@/lib/auth/account-emails";
import { userForGoogle } from "@/lib/auth/google";
import { requestPasswordReset, resetPassword } from "@/lib/auth/reset";
import { sendVerification, verifyEmail } from "@/lib/auth/verify";
import { newId, nowIso } from "@/lib/ids";
import { fakeMail, resetFakeMail } from "@/lib/mail/fake";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));

const ORIGIN = "https://app.radar.example";
const env = { MAIL_PROVIDER: "fake", MAIL_USER: "hello@radar.example", ACCOUNT_EMAILS: "on" };
const tokenIn = (text: string) => new URL(text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!;

describe("the product's own emails", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    resetEnv(env);
    db = await useTempDb();
    resetFakeMail();
    await createUser({ email: "owner@radar.example", password: "Password-1", name: "Olga Owner" });
  });
  afterEach(() => _setAccountTransport(null));

  it("someone who signs up confirms their address before the app opens; the first account and Google sign-ups do not have to", async () => {
    const owner = (await checkLogin("owner@radar.example", "Password-1"))!;
    expect(mustConfirmEmail(owner)).toBe(false);
    const made = await createUser({ email: "nell@harbour.example", password: "Password-2", name: "Nell Harbour" });
    if (!made.ok) throw new Error("not created");
    expect(mustConfirmEmail(made.user)).toBe(true);
    expect(await landingAfterSignIn(made.user)).toBe("/verify-email");

    expect(await sendVerification(made.user.id, ORIGIN)).toBe(true);
    const mail = fakeMail().sent;
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: "nell@harbour.example", subject: "Confirm your email address" });
    const token = tokenIn(mail[0].text);
    expect(mail[0].text).toContain(`${ORIGIN}/verify-email?token=${token}`);
    expect((await db.select().from(emailVerifications).all()).some((r) => r.id === token)).toBe(false); // only a hash is kept

    expect(await verifyEmail("made-up")).toBeNull();
    expect(await verifyEmail(token)).toBe("nell@harbour.example");
    expect(await verifyEmail(token)).toBeNull(); // once
    const nell = (await checkLogin("nell@harbour.example", "Password-2"))!;
    expect(mustConfirmEmail(nell)).toBe(false);
    expect(await landingAfterSignIn(nell)).toBe("/setup");
    expect(await sendVerification(nell.id, ORIGIN)).toBe(false); // nothing more to confirm

    const google = await userForGoogle({ email: "gina@gmail.example", name: "Gina Google" });
    expect(mustConfirmEmail(google)).toBe(false);
  });

  it("a link is good for a day, five an hour is the most, and Google or a password link to the mailbox also confirm the address", async () => {
    const made = await createUser({ email: "nell@harbour.example", password: "Password-2" });
    if (!made.ok) throw new Error("not created");
    for (let i = 0; i < 5; i++) expect(await sendVerification(made.user.id, ORIGIN)).toBe(true);
    expect(await sendVerification(made.user.id, ORIGIN)).toBe(false);
    await db.update(emailVerifications).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).run();
    expect(await verifyEmail(tokenIn(fakeMail().sent[0].text))).toBeNull();
    // Choosing a new password through a link sent to the mailbox shows the address is theirs.
    resetFakeMail();
    await requestPasswordReset("nell@harbour.example", ORIGIN);
    expect(await resetPassword(tokenIn(fakeMail().sent[0].text), "New-password-3")).toMatchObject({ ok: true });
    expect(mustConfirmEmail((await checkLogin("nell@harbour.example", "New-password-3"))!)).toBe(false);
    // Signing in with Google confirms an account made with a password and the same address.
    const other = await createUser({ email: "gina@gmail.example", password: "Password-4" });
    if (!other.ok) throw new Error("not created");
    expect(mustConfirmEmail(await userForGoogle({ email: "gina@gmail.example", name: "Gina" }))).toBe(false);
  });

  it("asks nobody to confirm while the product sends no emails of its own", async () => {
    resetEnv({ ...env, ACCOUNT_EMAILS: undefined });
    expect(accountEmailsOn()).toBe(false);
    const made = await createUser({ email: "nell@harbour.example", password: "Password-2" });
    if (!made.ok) throw new Error("not created");
    expect(mustConfirmEmail(made.user)).toBe(false);
    expect(await landingAfterSignIn(made.user)).toBe("/setup");
    expect(await sendVerification(made.user.id, ORIGIN)).toBe(false);
    expect(fakeMail().sent).toHaveLength(0);
  });

  it("uses the product's own sender when one is set up, and never the first workspace's mailbox then", async () => {
    resetEnv({ MAIL_PROVIDER: "fake", MAIL_USER: "hello@radar.example", ACCOUNT_SMTP_HOST: "smtp.mail.example", ACCOUNT_SMTP_USER: "postmaster@radar.example", ACCOUNT_SMTP_PASSWORD: "secret", ACCOUNT_MAIL_FROM: "accounts@radar.example" });
    expect(accountEmailsOn()).toBe(true); // on by having a sender, without the switch
    const out: { from: string; to: string; subject: string; text: string }[] = [];
    _setAccountTransport({ sendMail: async (m) => void out.push(m) });
    expect(await sendAccountEmail({ to: "nell@harbour.example", subject: "Hello", text: "Body" })).toBe(true);
    expect(out).toEqual([{ from: '"Opportunity Radar" <accounts@radar.example>', to: "nell@harbour.example", subject: "Hello", text: "Body" }]);
    expect(fakeMail().sent).toHaveLength(0);
  });

  it("changes the password from inside the account: the current one is asked for, and every other device is signed out", async () => {
    const owner = (await checkLogin("owner@radar.example", "Password-1"))!;
    expect(await signInMethod(owner.id)).toBe("password");
    await db.insert(sessions).values({ id: newId(), userId: owner.id, createdAt: nowIso(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }).run();
    expect(await changePassword(owner, "wrong-password-9", "New-password-2")).toBe("The current password is not right.");
    expect(await changePassword(owner, "Password-1", "short")).toBe("Use at least 8 characters.");
    expect(await changePassword(owner, "Password-1", "Password-1")).toMatch(/different/);
    expect(await db.select().from(sessions).where(eq(sessions.userId, owner.id)).all()).toHaveLength(1); // nothing changed yet
    expect(await changePassword(owner, "Password-1", "New-password-2")).toBeNull();
    expect(await checkLogin("owner@radar.example", "Password-1")).toBeNull();
    expect((await checkLogin("owner@radar.example", "New-password-2"))?.id).toBe(owner.id);
    expect(await db.select().from(sessions).where(eq(sessions.userId, owner.id)).all()).toHaveLength(0);
    await db.update(users).set({ passwordHash: "google" }).where(eq(users.id, owner.id)).run();
    expect(await signInMethod(owner.id)).toBe("google");
  });
});
