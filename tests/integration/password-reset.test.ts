/**
 * "Forgot your password?": a link to the account's own address, once, for an hour; nothing is said about
 * whether an address has an account; using the link signs the account out everywhere.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetEnv, useTempDb } from "../helpers";
import { passwordResets, sessions, users } from "@/db/schema";
import { checkLogin, createUser } from "@/lib/auth";
import { requestPasswordReset, resetLinkValid, resetPassword } from "@/lib/auth/reset";
import { newId, nowIso } from "@/lib/ids";
import { fakeMail, resetFakeMail } from "@/lib/mail/fake";

const ORIGIN = "https://app.radar.example";
const env = { MAIL_PROVIDER: "fake", MAIL_USER: "hello@radar.example", ACCOUNT_EMAILS: "on" };
const linkIn = (text: string) => new URL(text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!;

describe("password reset", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    resetEnv(env);
    db = await useTempDb();
    resetFakeMail();
    await createUser({ email: "owner@radar.example", password: "Password-1", name: "Olga Owner" });
    await createUser({ email: "nell@harbour.example", password: "Old-password-1", name: "Nell Harbour" });
  });

  it("sends a link to the account's own address, and the new password works while the old one stops", async () => {
    expect(await requestPasswordReset("  Nell@Harbour.example ", ORIGIN)).toBe(true);
    const mail = fakeMail().sent;
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: "nell@harbour.example", subject: "Choose a new password", from: { name: "Opportunity Radar", address: "hello@radar.example" } });
    expect(mail[0].text).toMatch(/^Hi Nell,/);
    const token = linkIn(mail[0].text);
    expect(mail[0].text).toContain(`${ORIGIN}/reset-password?token=${token}`);
    // Only a hash of the secret is kept.
    expect((await db.select().from(passwordResets).all()).some((r) => r.id === token)).toBe(false);
    expect(await resetLinkValid(token)).toBe(true);

    // A session from before: gone once the password is changed.
    const nell = (await db.select().from(users).where(eq(users.email, "nell@harbour.example")).get())!;
    await db.insert(sessions).values({ id: newId(), userId: nell.id, createdAt: nowIso(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }).run();

    expect(await resetPassword(token, "short")).toEqual({ ok: false, error: "Use at least 8 characters." });
    expect(await resetLinkValid(token)).toBe(true); // a refused password does not use the link up
    expect(await resetPassword(token, "New-password-2")).toEqual({ ok: true, email: "nell@harbour.example" });
    expect(await checkLogin("nell@harbour.example", "Old-password-1")).toBeNull();
    expect((await checkLogin("nell@harbour.example", "New-password-2"))?.email).toBe("nell@harbour.example");
    expect(await db.select().from(sessions).where(eq(sessions.userId, nell.id)).all()).toHaveLength(0);
    // Once only.
    expect(await resetLinkValid(token)).toBe(false);
    expect(await resetPassword(token, "Another-password-3")).toMatchObject({ ok: false, error: expect.stringMatching(/no longer works/) });
    // Nobody else's password moved.
    expect((await checkLogin("owner@radar.example", "Password-1"))?.email).toBe("owner@radar.example");
  });

  it("says and sends nothing for an address without an account, an account that signs in with Google, or a made-up link", async () => {
    expect(await requestPasswordReset("nobody@nowhere.example", ORIGIN)).toBe(false);
    await db.update(users).set({ passwordHash: "google" }).where(eq(users.email, "nell@harbour.example")).run();
    expect(await requestPasswordReset("nell@harbour.example", ORIGIN)).toBe(false);
    expect(fakeMail().sent).toHaveLength(0);
    expect(await resetLinkValid("")).toBe(false);
    expect(await resetLinkValid("made-up")).toBe(false);
    expect(await resetPassword("made-up", "New-password-2")).toMatchObject({ ok: false });
  });

  it("a link stops working after an hour, a newer link replaces nothing until used, and three an hour is the most", async () => {
    await requestPasswordReset("nell@harbour.example", ORIGIN);
    const first = linkIn(fakeMail().sent[0].text);
    await db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).run();
    expect(await resetLinkValid(first)).toBe(false);
    expect(await resetPassword(first, "New-password-2")).toMatchObject({ ok: false });
    await requestPasswordReset("nell@harbour.example", ORIGIN);
    await requestPasswordReset("nell@harbour.example", ORIGIN);
    expect(await requestPasswordReset("nell@harbour.example", ORIGIN)).toBe(false); // the fourth within the hour
    expect(fakeMail().sent).toHaveLength(3);
    // Using one link ends the others.
    const [second, third] = [linkIn(fakeMail().sent[1].text), linkIn(fakeMail().sent[2].text)];
    expect(await resetPassword(third, "New-password-2")).toMatchObject({ ok: true });
    expect(await resetLinkValid(second)).toBe(false);
  });

  it("sends nothing at all until the operator switched account emails on", async () => {
    resetEnv({ ...env, ACCOUNT_EMAILS: undefined });
    expect(await requestPasswordReset("nell@harbour.example", ORIGIN)).toBe(false);
    expect(fakeMail().sent).toHaveLength(0);
    expect(await db.select().from(passwordResets).all()).toHaveLength(0);
  });
});
