/**
 * Every workspace connects its own mailbox. HOME is the first workspace (it
 * may fall back to the server's mailbox), AWAY is a customer's. What is checked:
 * a mailbox is saved only after it signed in, its password is stored encrypted,
 * each workspace sends from its own address under its own name, and
 * disconnecting stops sending again. No network: the real provider is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const verify = vi.fn(async () => ({ smtp: null as string | null, imap: null as string | null }));
const tokensUsed: string[] = [];
vi.mock("@/lib/mail/smtp-imap", () => ({ smtpImapProvider: (cfg: { provider: string; address: string; accessToken?: () => Promise<string> }) => ({ key: cfg.provider, address: cfg.address, verify: async () => { if (cfg.accessToken) tokensUsed.push(await cfg.accessToken()); return verify(); }, send: async () => ({ response: "ok" }), wasSent: async () => null, fetchInbox: async () => ({ messages: [], cursor: null }) }) }));
vi.mock("@/lib/jobs/kick", () => ({ kickWorker: () => {} }));

import { resetEnv, useTempDb } from "../helpers";
import { FIRST_WORKSPACE_ID, businesses, jobs, mailboxes, outreachDrafts } from "@/db/schema";
import { newId } from "@/lib/ids";
import { runScheduler } from "@/lib/jobs/scheduler";
import { drainQueue } from "@/lib/jobs/worker";
import { MAILBOX_UNREADABLE, NO_WORKSPACE_MAILBOX, connectMailbox, connectMicrosoftMailbox, getMailProvider, listMailboxes, mailboxFor, removeMailbox, setDefaultMailbox, workspacesWithMailbox } from "@/lib/mail";
import { fakeMail, resetFakeMail } from "@/lib/mail/fake";
import { MicrosoftAuthError, forgetMicrosoftToken, microsoftAuthUrl, microsoftExchange } from "@/lib/mail/microsoft";
import { openCampaign } from "@/lib/outreach/campaigns";
import { sendCampaign } from "@/lib/outreach/send";
import { ensureProspect } from "@/lib/pipeline/prospects";
import { open, seal } from "@/lib/secret-box";
import { getSettings, getState, saveSettings, setState } from "@/lib/settings";
import { runInWorkspace } from "@/lib/workspace";

const HOME = FIRST_WORKSPACE_ID;
const AWAY = "ws-meadow";
const SENDING = { postalAddress: "1 Quay Street, Leeds LS1 1AA", sendWindowStart: 0, sendWindowEnd: 24, sendSpacingSeconds: 20, dailySendCap: 20 };

describe("a mailbox per workspace", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;

  const approvedEmail = (ws: string, name: string, email: string) =>
    runInWorkspace(ws, async () => {
      const id = newId();
      await db.insert(businesses).values({ id, workspaceId: ws, name, nameNormalized: name.toLowerCase(), industry: "home_services", firstProvider: "csv", country: "GB", status: "profiled", verdict: "qualified", email, emailStatus: "valid", emailSource: "site" }).run();
      await ensureProspect(id, "ready_to_contact");
      const draftId = newId();
      const campaignId = (await openCampaign()).id;
      await db.insert(outreachDrafts).values({ id: draftId, businessId: id, campaignId, step: 0, style: "personal", toEmail: email, subject: `Idea for ${name}`, body: "Hi team,\n\nI noticed that every replacement starts with a free in-home estimate. Would a short call be useful?", claims: [], warnings: [], status: "approved" }).run();
      return { draftId, campaignId };
    });

  beforeEach(async () => {
    resetEnv({ MAIL_PROVIDER: "fake", MAIL_USER: "owner@harbour-studio.example" });
    db = await useTempDb();
    resetFakeMail();
    verify.mockReset();
    verify.mockResolvedValue({ smtp: null, imap: null });
    vi.unstubAllGlobals();
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
  });

  it("keeps settings and state apart: one customer's name never signs another's email", async () => {
    await runInWorkspace(HOME, () => saveSettings({ senderName: "Nell Harbour" }));
    await runInWorkspace(AWAY, () => saveSettings({ senderName: "Tom Meadow" }));
    await runInWorkspace(AWAY, () => setState("mail.cursor", { uid: 7 }));
    expect((await runInWorkspace(HOME, () => getSettings())).senderName).toBe("Nell Harbour");
    expect((await runInWorkspace(AWAY, () => getSettings())).senderName).toBe("Tom Meadow");
    expect(await runInWorkspace(HOME, () => getState("mail.cursor"))).toBeNull();
    // Code without a workspace (scripts, the scheduler's own state) is the first workspace, as before.
    expect((await getSettings()).senderName).toBe("Nell Harbour");
  });

  it("stores a mailbox only after it signed in, with the password encrypted", async () => {
    resetEnv({}); // no server mailbox at all
    expect(await runInWorkspace(AWAY, () => mailboxFor())).toMatchObject({ enabled: false, reason: NO_WORKSPACE_MAILBOX });

    verify.mockResolvedValueOnce({ smtp: "The mailbox refused the login: 535 bad credentials", imap: null });
    const refused = await runInWorkspace(AWAY, () => connectMailbox({ provider: "gmail", address: "tom@meadow.example", password: "wrong" }));
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("nothing was saved") });
    expect(await db.select().from(mailboxes).all()).toEqual([]);

    // An app password is pasted in groups of four: the spaces are dropped.
    expect(await runInWorkspace(AWAY, () => connectMailbox({ provider: "gmail", address: " Tom@Meadow.example ", password: "abcd efgh ijkl mnop" }))).toEqual({ ok: true, address: "tom@meadow.example" });
    const row = (await db.select().from(mailboxes).where(eq(mailboxes.workspaceId, AWAY)).get())!;
    expect(row).toMatchObject({ provider: "gmail", address: "tom@meadow.example", user: "tom@meadow.example", smtpHost: "smtp.gmail.com", smtpPort: 465, imapHost: "imap.gmail.com", imapPort: 993 });
    expect(JSON.stringify(row)).not.toContain("abcdefghijklmnop");
    expect(open(row.passwordEnc)).toBe("abcdefghijklmnop");
    const box = await runInWorkspace(AWAY, () => mailboxFor());
    expect(box).toEqual({ enabled: true, address: "tom@meadow.example", reason: null, source: "settings", label: "Gmail / Google Workspace" });
    expect((await runInWorkspace(AWAY, () => getMailProvider()))?.address).toBe("tom@meadow.example");
    // Nobody else got a mailbox from it.
    expect(await runInWorkspace(HOME, () => getMailProvider())).toBeNull();
    expect(await workspacesWithMailbox()).toEqual([AWAY]);

    // A stored password that was altered, or a changed secret, never signs in with something else.
    await db.update(mailboxes).set({ passwordEnc: row.passwordEnc.slice(0, -4) + "AAAA" }).where(eq(mailboxes.workspaceId, AWAY)).run();
    expect(await runInWorkspace(AWAY, () => mailboxFor())).toMatchObject({ enabled: false, address: "tom@meadow.example", reason: MAILBOX_UNREADABLE });
    expect(await runInWorkspace(AWAY, () => getMailProvider())).toBeNull();

    // Someone else cannot remove it; its owner can.
    expect(await runInWorkspace(HOME, () => removeMailbox(row.id))).toBeNull();
    expect(await runInWorkspace(AWAY, () => removeMailbox(row.id))).toBe("tom@meadow.example");
    expect(await db.select().from(mailboxes).all()).toEqual([]);
  });

  it("refuses what cannot be a mailbox: a bad address, an unknown provider, a server inside our own network", async () => {
    const tryIt = (input: Parameters<typeof connectMailbox>[0]) => runInWorkspace(AWAY, () => connectMailbox(input));
    expect(await tryIt({ provider: "gmail", address: "not-an-address", password: "x" })).toMatchObject({ ok: false });
    expect(await tryIt({ provider: "hotmale", address: "tom@meadow.example", password: "x" })).toMatchObject({ ok: false, error: "Choose your mail provider." });
    expect(await tryIt({ provider: "gmail", address: "tom@meadow.example", password: "   " })).toMatchObject({ ok: false });
    for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "169.254.169.254", "mail server.example"]) {
      expect(await tryIt({ provider: "custom", address: "tom@meadow.example", password: "secret", smtpHost: host, imapHost: host })).toMatchObject({ ok: false });
    }
    expect(await tryIt({ provider: "custom", address: "tom@meadow.example", password: "secret", smtpHost: "mail.meadow.example", smtpPort: 22, imapHost: "mail.meadow.example" })).toMatchObject({ ok: false });
    expect(verify).not.toHaveBeenCalled();
    expect(await db.select().from(mailboxes).all()).toEqual([]);
  });

  it("sends each workspace's email from its own mailbox, under its own name", async () => {
    await runInWorkspace(HOME, () => saveSettings({ ...SENDING, senderName: "Nell Harbour", senderCompany: "Harbour Studio" }));
    await runInWorkspace(AWAY, () => saveSettings({ ...SENDING, senderName: "Tom Meadow", senderCompany: "Meadow Works" }));
    expect(await runInWorkspace(AWAY, () => connectMailbox({ provider: "fake", address: "tom@meadow.example", password: "" }))).toEqual({ ok: true, address: "tom@meadow.example" });
    expect((await workspacesWithMailbox()).sort()).toEqual([AWAY, HOME].sort());

    const home = await approvedEmail(HOME, "Fernhill Joinery", "office@fernhill-joinery.example");
    const away = await approvedEmail(AWAY, "Oakbeck Plumbing", "hello@oakbeck-plumbing.example");
    expect(await runInWorkspace(HOME, () => sendCampaign(home.campaignId))).toMatchObject({ ok: true, queued: 1 });
    expect(await runInWorkspace(AWAY, () => sendCampaign(away.campaignId))).toMatchObject({ ok: true, queued: 1 });
    await db.update(jobs).set({ scheduledAt: new Date(Date.now() - 1000).toISOString() }).where(eq(jobs.status, "queued")).run();
    await drainQueue(["send_email"]);

    const sent = Object.fromEntries(fakeMail().sent.map((m) => [m.to, m]));
    expect(sent["office@fernhill-joinery.example"].from).toEqual({ name: "Nell Harbour", address: "owner@harbour-studio.example" });
    expect(sent["hello@oakbeck-plumbing.example"].from).toEqual({ name: "Tom Meadow", address: "tom@meadow.example" });
    expect(sent["hello@oakbeck-plumbing.example"].text).toContain("Meadow Works");
    expect(sent["hello@oakbeck-plumbing.example"].text).not.toContain("Harbour");

    // The scheduler reads the inbox of every workspace that has sent mail, each as its own job.
    await runScheduler();
    const syncs = (await db.select().from(jobs).where(eq(jobs.type, "sync_mailbox")).all()).map((j) => j.workspaceId).sort();
    expect(syncs).toEqual([AWAY, HOME].sort());
  });

  it("adds and removes mailboxes: one is the default, and removing it hands over to the next", async () => {
    resetEnv({ MAIL_PROVIDER: "fake" }); // the in-memory mailbox is allowed, but the server has none of its own
    const add = (address: string) => runInWorkspace(AWAY, () => connectMailbox({ provider: "fake", address, password: "" }));
    const list = async () => (await runInWorkspace(AWAY, () => listMailboxes())).map((m) => `${m.address}${m.isDefault ? " (default)" : ""}`);
    resetEnv({ MAIL_PROVIDER: "fake", MAIL_USER: "owner@harbour-studio.example" });
    await add("tom@meadow.example");
    await add("sales@meadow.example");
    await add("tom@meadow.example"); // the same address again updates it, it is not added twice
    expect(await list()).toEqual(["tom@meadow.example (default)", "sales@meadow.example"]);
    expect((await runInWorkspace(AWAY, () => mailboxFor())).address).toBe("tom@meadow.example");

    const sales = (await runInWorkspace(AWAY, () => listMailboxes())).find((m) => m.address === "sales@meadow.example")!;
    expect(await runInWorkspace(HOME, () => setDefaultMailbox(sales.id))).toBeNull(); // not theirs to choose
    expect(await runInWorkspace(AWAY, () => setDefaultMailbox(sales.id))).toBe("sales@meadow.example");
    expect(await list()).toEqual(["sales@meadow.example (default)", "tom@meadow.example"]);
    expect((await runInWorkspace(AWAY, () => getMailProvider()))?.address).toBe("sales@meadow.example");
    // A particular one can be asked for; one that is not connected falls back to the default.
    expect((await runInWorkspace(AWAY, () => getMailProvider(undefined, "tom@meadow.example")))?.address).toBe("tom@meadow.example");
    expect((await runInWorkspace(AWAY, () => getMailProvider(undefined, "gone@meadow.example")))?.address).toBe("sales@meadow.example");

    expect(await runInWorkspace(AWAY, () => removeMailbox(sales.id))).toBe("sales@meadow.example");
    expect(await list()).toEqual(["tom@meadow.example (default)"]);
    const tom = (await runInWorkspace(AWAY, () => listMailboxes()))[0];
    await runInWorkspace(AWAY, () => removeMailbox(tom.id));
    expect(await list()).toEqual([]);
    expect(await runInWorkspace(AWAY, () => mailboxFor())).toMatchObject({ enabled: false, reason: NO_WORKSPACE_MAILBOX });
  });

  it("keeps a conversation in the mailbox it started from, also after the default changed", async () => {
    await runInWorkspace(AWAY, () => saveSettings({ ...SENDING, senderName: "Tom Meadow", senderCompany: "Meadow Works" }));
    await runInWorkspace(AWAY, () => connectMailbox({ provider: "fake", address: "tom@meadow.example", password: "" }));
    await runInWorkspace(AWAY, () => connectMailbox({ provider: "fake", address: "sales@meadow.example", password: "" }));
    const send = async () => {
      await db.update(jobs).set({ scheduledAt: new Date(Date.now() - 1000).toISOString() }).where(eq(jobs.status, "queued")).run();
      await drainQueue(["send_email"]);
    };
    const first = await approvedEmail(AWAY, "Oakbeck Plumbing", "hello@oakbeck-plumbing.example");
    await runInWorkspace(AWAY, () => sendCampaign(first.campaignId));
    await send();
    expect((await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, first.draftId)).get())!).toMatchObject({ status: "sent", sentFrom: "tom@meadow.example" });

    // The default moves to the other address; a new business is written to from there, the follow-up to the first is not.
    const sales = (await runInWorkspace(AWAY, () => listMailboxes())).find((m) => m.address === "sales@meadow.example")!;
    await runInWorkspace(AWAY, () => setDefaultMailbox(sales.id));
    const original = (await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, first.draftId)).get())!;
    const followUp = newId();
    const batch = await runInWorkspace(AWAY, async () => (await openCampaign()).id);
    await db.insert(outreachDrafts).values({ id: followUp, businessId: original.businessId, campaignId: batch, step: 1, style: "personal", toEmail: original.toEmail, subject: original.subject, body: "Hi team,\n\nJust checking this reached you. Would a short call be useful?", claims: [], warnings: [], status: "approved", inReplyTo: original.messageId }).run();
    const second = await approvedEmail(AWAY, "Larkfield Roofing", "info@larkfield-roofing.example");
    expect(second.campaignId).toBe(batch);
    expect(await runInWorkspace(AWAY, () => sendCampaign(batch))).toMatchObject({ ok: true, queued: 2 });
    await send();
    const from = Object.fromEntries(fakeMail().sent.map((m) => [`${m.to} ${m.subject.startsWith("Re:") ? "follow-up" : "first"}`, m.from.address]));
    expect(from).toEqual({ "hello@oakbeck-plumbing.example first": "tom@meadow.example", "hello@oakbeck-plumbing.example follow-up": "tom@meadow.example", "info@larkfield-roofing.example first": "sales@meadow.example" });
  });

  it("takes a mailbox configured on the server over once, as an ordinary mailbox that can be removed for good", async () => {
    const names = async () => (await runInWorkspace(HOME, () => listMailboxes())).map((m) => `${m.address}${m.isDefault ? " (default)" : ""}`);
    // Seen for the first time: stored like one added in Settings, and nothing marks it as special.
    expect(await runInWorkspace(HOME, () => mailboxFor())).toMatchObject({ enabled: true, address: "owner@harbour-studio.example", source: "settings" });
    expect(await db.select().from(mailboxes).all()).toHaveLength(1);
    expect(await names()).toEqual(["owner@harbour-studio.example (default)"]);
    // Another workspace never gets it.
    expect(await runInWorkspace(AWAY, () => listMailboxes())).toEqual([]);

    // The list is read as: the one you send from, then the others by address.
    for (const address of ["zoe@harbour-studio.example", "nell@harbour-studio.example"]) await runInWorkspace(HOME, () => connectMailbox({ provider: "fake", address, password: "" }));
    expect(await names()).toEqual(["owner@harbour-studio.example (default)", "nell@harbour-studio.example", "zoe@harbour-studio.example"]);
    const zoe = (await runInWorkspace(HOME, () => listMailboxes())).find((m) => m.address.startsWith("zoe"))!;
    await runInWorkspace(HOME, () => setDefaultMailbox(zoe.id));
    expect(await names()).toEqual(["zoe@harbour-studio.example (default)", "nell@harbour-studio.example", "owner@harbour-studio.example"]);

    // Removing it is final: it does not come back by itself, although the server still has it configured.
    const owner = (await runInWorkspace(HOME, () => listMailboxes())).find((m) => m.address.startsWith("owner"))!;
    expect(await runInWorkspace(AWAY, () => removeMailbox(owner.id))).toBeNull();
    expect(await runInWorkspace(HOME, () => removeMailbox(owner.id))).toBe("owner@harbour-studio.example");
    expect(await names()).toEqual(["zoe@harbour-studio.example (default)", "nell@harbour-studio.example"]);
    for (const m of await runInWorkspace(HOME, () => listMailboxes())) await runInWorkspace(HOME, () => removeMailbox(m.id));
    expect(await names()).toEqual([]);
    expect(await runInWorkspace(HOME, () => getMailProvider())).toBeNull();
    expect(await workspacesWithMailbox()).toEqual([]);
    // A different address configured on the server later is taken over again.
    resetEnv({ MAIL_PROVIDER: "fake", MAIL_USER: "hello@harbour-studio.example" });
    expect(await names()).toEqual(["hello@harbour-studio.example (default)"]);
  });

  describe("Sign in with Microsoft", () => {
    const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
    const answer = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    let calls: URLSearchParams[];
    const microsoftSays = (...answers: Response[]) => {
      calls = [];
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: URLSearchParams }) => (calls.push(init.body), answers.shift() ?? answer(500, {}))));
    };
    beforeEach(() => {
      resetEnv({});
      process.env.MICROSOFT_CLIENT_ID = "app-id";
      process.env.MICROSOFT_CLIENT_SECRET = "app-secret";
      tokensUsed.length = 0;
    });

    it("sends the browser to Microsoft asking for mail access, and reads the address and tokens from the answer", async () => {
      const url = new URL(microsoftAuthUrl("https://radar.example", "st4te"));
      expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "app-id", response_type: "code", redirect_uri: "https://radar.example/auth/microsoft/mailbox/callback", state: "st4te" });
      expect(url.searchParams.get("scope")!.split(" ")).toEqual(expect.arrayContaining(["offline_access", "https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"]));

      microsoftSays(answer(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, id_token: idToken({ preferred_username: "Tom@Meadow.example" }) }));
      expect(await microsoftExchange("https://radar.example", "the-code")).toEqual({ address: "tom@meadow.example", refreshToken: "rt-1", accessToken: "at-1", expiresIn: 3600 });
      expect(Object.fromEntries(calls[0])).toMatchObject({ grant_type: "authorization_code", code: "the-code", client_id: "app-id", client_secret: "app-secret", redirect_uri: "https://radar.example/auth/microsoft/mailbox/callback" });

      microsoftSays(answer(400, { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided.\r\nTrace ID: 1" }));
      await expect(microsoftExchange("https://radar.example", "x")).rejects.toThrow("Microsoft refused: AADSTS7000215: Invalid client secret provided.");
      microsoftSays(answer(200, { access_token: "at", id_token: idToken({ email: "tom@meadow.example" }) })); // no refresh token: it could not stay connected
      await expect(microsoftExchange("https://radar.example", "x")).rejects.toBeInstanceOf(MicrosoftAuthError);
    });

    it("saves the mailbox only when it opened, stores the token encrypted, renews it and keeps the renewed one", async () => {
      const signedIn = { address: "tom@meadow.example", refreshToken: "rt-1", accessToken: "at-1", expiresIn: 3600 };
      verify.mockResolvedValueOnce({ smtp: "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant.", imap: null });
      const refused = await runInWorkspace(AWAY, () => connectMicrosoftMailbox(signedIn));
      expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("nothing was saved") });
      expect(await db.select().from(mailboxes).all()).toEqual([]);

      expect(await runInWorkspace(AWAY, () => connectMicrosoftMailbox(signedIn))).toEqual({ ok: true, address: "tom@meadow.example" });
      expect(tokensUsed).toEqual(["at-1", "at-1"]); // the check used the token of the sign-in itself, both times
      const row = (await db.select().from(mailboxes).get())!;
      expect(row).toMatchObject({ workspaceId: AWAY, provider: "microsoft", smtpHost: "smtp.office365.com", smtpPort: 587, imapHost: "outlook.office365.com", isDefault: true });
      expect(JSON.stringify(row)).not.toContain("rt-1");
      expect(open(row.passwordEnc)).toBe("rt-1");
      expect(await runInWorkspace(AWAY, () => mailboxFor())).toMatchObject({ enabled: true, address: "tom@meadow.example", label: expect.stringContaining("signed in with Microsoft") });
      // The password form cannot be used to plant a mailbox of this kind.
      expect(await runInWorkspace(AWAY, () => connectMailbox({ provider: "microsoft", address: "x@meadow.example", password: "p" }))).toMatchObject({ ok: false });

      // An hour later the short token is gone: a new one is fetched with the stored one, and Microsoft's replacement is kept.
      forgetMicrosoftToken(row.id);
      microsoftSays(answer(200, { access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }));
      await (await runInWorkspace(AWAY, () => getMailProvider()))!.verify();
      expect(tokensUsed.at(-1)).toBe("at-2");
      expect(Object.fromEntries(calls[0])).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt-1" });
      expect(open((await db.select().from(mailboxes).get())!.passwordEnc)).toBe("rt-2");
      // Within the hour Microsoft is not asked again.
      await (await runInWorkspace(AWAY, () => getMailProvider()))!.verify();
      expect(calls).toHaveLength(1);

      // The customer withdrew the access at Microsoft: the mailbox says so instead of sending.
      forgetMicrosoftToken(row.id);
      microsoftSays(answer(400, { error: "invalid_grant", error_description: "AADSTS70000: The grant was revoked." }));
      await expect((await runInWorkspace(AWAY, () => getMailProvider()))!.verify()).rejects.toThrow("Remove this mailbox and sign in with Microsoft again");

      // Without the app's own id and secret on the server the mailbox is listed, but not used.
      delete process.env.MICROSOFT_CLIENT_SECRET;
      expect(await runInWorkspace(AWAY, () => mailboxFor())).toMatchObject({ enabled: false, address: "tom@meadow.example" });
      expect(await runInWorkspace(AWAY, () => getMailProvider())).toBeNull();
    });
  });

  it("seals and opens, and gives nothing back for a value it did not seal", () => {
    const sealed = seal("pässword with spaces");
    expect(sealed).not.toContain("pässword");
    expect(seal("pässword with spaces")).not.toBe(sealed); // a fresh nonce every time
    expect(open(sealed)).toBe("pässword with spaces");
    expect(open("v1.a.b.c")).toBeNull();
    expect(open("plain text")).toBeNull();
  });
});
