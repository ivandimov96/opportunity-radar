import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { FIRST_WORKSPACE_ID, mailboxes, settings } from "@/db/schema";
import { MAIL_PRESETS, getConfig } from "@/lib/config";
import { newId, nowIso } from "@/lib/ids";
import { resolvePublicAddress } from "@/lib/research/url-guard";
import { open, seal } from "@/lib/secret-box";
import { workspaceId } from "@/lib/workspace";
import { fakeProvider } from "./fake";
import { MICROSOFT_SERVERS, forgetMicrosoftToken, microsoftAccessToken, microsoftConfigured, rememberMicrosoftToken } from "./microsoft";
import { smtpImapProvider, type SmtpImapConfig } from "./smtp-imap";
import type { MailProvider } from "./types";

export * from "./types";

/**
 * Whose mailboxes they are. Every workspace connects its own in Settings (the
 * `mailboxes` table, passwords encrypted), as many as it likes, and removes
 * them there. One of them is the default: new emails go out from it. A
 * follow-up or an answer goes out from the address its conversation started
 * from, while that mailbox is still connected. A mailbox configured in the
 * environment is taken over once, as an ordinary mailbox of the first
 * workspace: from then on it is listed, chosen and removed like any other. A
 * workspace without a mailbox can write, review and approve emails, but
 * nothing is sent or read for it. This file is the only place those rules live.
 */
export const MAILBOX_WORKSPACE_ID = FIRST_WORKSPACE_ID;
export const NO_WORKSPACE_MAILBOX = "No mailbox is connected yet. Connect yours under Settings, Mailbox.";
export const MAILBOX_UNREADABLE = "The saved mailbox password can no longer be read. Remove this mailbox and connect it again.";
const SERVERLESS_OFF = "Sending is switched off on a serverless deployment.";
/** A mailbox connected with "Sign in with Microsoft" (no password; a token is stored instead). */
const MICROSOFT = "microsoft";
const MICROSOFT_LABEL = "Outlook / Microsoft 365 · signed in with Microsoft";
const FAKE_LABEL = "in-memory test mailbox: nothing leaves this computer";

export interface Mailbox {
  enabled: boolean;
  address: string | null;
  /** Why it cannot be used, in plain words; null when it can. */
  reason: string | null;
  /** "settings" for a mailbox the workspace holds; null when it has none. */
  source: "settings" | null;
  /** "Gmail / Google Workspace", or the two servers of a custom mailbox. */
  label: string | null;
}
/** One line of the list in Settings. */
export interface MailboxEntry extends Mailbox {
  id: string;
  address: string;
  /** New emails are sent from this one. */
  isDefault: boolean;
  /** The provider it was added as (a preset key, "microsoft", "custom" or "fake"), for its logo. */
  provider: string;
}

type Resolved = MailboxEntry & { config: SmtpImapConfig | null; fake: boolean };
const NONE: Mailbox = { enabled: false, address: null, reason: NO_WORKSPACE_MAILBOX, source: null, label: null };

/** Every mailbox of the workspace, the default first. */
async function resolveAll(ws?: string): Promise<Resolved[]> {
  const id = ws ?? (await workspaceId());
  const cfg = getConfig();
  const db = await getDb();
  let rows = await db.select().from(mailboxes).where(eq(mailboxes.workspaceId, id)).orderBy(asc(mailboxes.createdAt)).all();
  if (id === MAILBOX_WORKSPACE_ID && (await adoptServerMailbox(rows))) rows = await db.select().from(mailboxes).where(eq(mailboxes.workspaceId, id)).orderBy(asc(mailboxes.createdAt)).all();
  // The in-memory mailbox exists only where the server itself runs on it (tests, dry runs); elsewhere such a row is not a mailbox at all.
  if (cfg.mail.provider !== "fake") rows = rows.filter((r) => r.provider !== "fake");
  const out: Resolved[] = rows.map((row) => {
    const base = { id: row.id, provider: row.provider, address: row.address, source: "settings" as const, isDefault: row.isDefault, config: null, fake: false, label: MAIL_PRESETS[row.provider]?.label ?? `${row.smtpHost} / ${row.imapHost}` };
    if (cfg.serverless) return { ...base, enabled: false, reason: SERVERLESS_OFF };
    if (row.provider === "fake") return { ...base, enabled: true, reason: null, label: FAKE_LABEL, fake: true };
    const password = open(row.passwordEnc);
    if (password === null) return { ...base, enabled: false, reason: MAILBOX_UNREADABLE };
    if (row.provider === MICROSOFT) {
      // Signed in with Microsoft: what is stored is the long-lived token, exchanged for a short one at every connection.
      if (!microsoftConfigured()) return { ...base, label: MICROSOFT_LABEL, enabled: false, reason: "Signing in with Microsoft is not switched on here at the moment." };
      const accessToken = () => microsoftAccessToken(row.id, password, (next) => db.update(mailboxes).set({ passwordEnc: seal(next), updatedAt: nowIso() }).where(eq(mailboxes.id, row.id)).run().then(() => undefined));
      return { ...base, label: MICROSOFT_LABEL, enabled: true, reason: null, config: { provider: MICROSOFT, address: row.address, user: row.user, password: "", smtp: { ...MICROSOFT_SERVERS.smtp, secure: false }, imap: MICROSOFT_SERVERS.imap, accessToken } };
    }
    return { ...base, enabled: true, reason: null, config: { provider: row.provider, address: row.address, user: row.user, password, smtp: { host: row.smtpHost, port: row.smtpPort, secure: row.smtpPort === 465 }, imap: { host: row.imapHost, port: row.imapPort } } };
  });
  // Exactly one default: the one chosen, otherwise the first that works.
  const chosen = out.find((r) => r.isDefault && r.enabled) ?? out.find((r) => r.enabled) ?? out.find((r) => r.isDefault) ?? out[0];
  for (const r of out) r.isDefault = r === chosen;
  // The list as people read it: the one they send from, then the working ones, then the rest, each group by address.
  return out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.enabled) - Number(a.enabled) || a.address.localeCompare(b.address));
}

/**
 * A mailbox configured in the environment (MAIL_PROVIDER, MAIL_USER, MAIL_PASSWORD) becomes an ordinary mailbox
 * of the first workspace the first time it is seen: stored like one added in Settings, password encrypted.
 * It is taken over once per address, so removing it in Settings is final (it does not come back by itself),
 * while a different address configured later is taken over again. Returns whether a row was added.
 */
const SERVER_ADOPTED_KEY = "state:mail.serverMailboxAdopted";
async function adoptServerMailbox(rows: (typeof mailboxes.$inferSelect)[]): Promise<boolean> {
  const m = getConfig().mail;
  if (!m.enabled || !m.address || !m.provider || rows.some((r) => r.address === m.address)) return false;
  const db = await getDb();
  const ws = MAILBOX_WORKSPACE_ID;
  const seen = await db.select({ value: settings.value }).from(settings).where(and(eq(settings.workspaceId, ws), eq(settings.key, SERVER_ADOPTED_KEY))).get();
  if (seen?.value === m.address) return false;
  await db
    .insert(mailboxes)
    .values({ id: newId(), workspaceId: ws, provider: m.provider, address: m.address, user: m.user ?? m.address, passwordEnc: seal(m.password ?? ""), smtpHost: m.smtp?.host ?? "fake.local", smtpPort: m.smtp?.port ?? 465, imapHost: m.imap?.host ?? "fake.local", imapPort: m.imap?.port ?? 993, isDefault: !rows.some((r) => r.isDefault), updatedAt: nowIso() })
    .onConflictDoNothing()
    .run();
  await db.insert(settings).values({ workspaceId: ws, key: SERVER_ADOPTED_KEY, value: m.address, updatedAt: nowIso() }).onConflictDoUpdate({ target: [settings.workspaceId, settings.key], set: { value: m.address, updatedAt: nowIso() } }).run();
  return true;
}

/** The mailbox an email goes out from: the one named (while it is connected and working), otherwise the default. */
async function pick(ws?: string, address?: string | null): Promise<Resolved | null> {
  const all = await resolveAll(ws);
  const named = address ? all.find((r) => r.address === address.toLowerCase() && r.enabled) : null;
  return named ?? all[0] ?? null;
}

const provide = (r: Resolved): MailProvider => (r.fake ? fakeProvider(r.address) : smtpImapProvider(r.config!));

/**
 * The acting workspace's mailbox, ready to send and read, or null when it has none (sending and reply sync are then off).
 * `address` asks for a particular one of its mailboxes; when that one is gone, the default answers.
 */
export async function getMailProvider(ws?: string, address?: string | null): Promise<MailProvider | null> {
  const r = await pick(ws, address);
  return r?.enabled ? provide(r) : null;
}

/** Every working mailbox of the acting workspace (the inbox of each is read). */
export async function getMailProviders(ws?: string): Promise<MailProvider[]> {
  return (await resolveAll(ws)).filter((r) => r.enabled).map(provide);
}

const publicOf = ({ enabled, address, reason, source, label }: Resolved): Mailbox => ({ enabled, address, reason, source, label });

/** The default mailbox as the acting workspace has it: what the pages show and what the pre-send summary checks. Never carries the password. */
export async function mailboxFor(ws?: string): Promise<Mailbox> {
  const r = await pick(ws);
  if (r) return publicOf(r);
  // The first workspace is told why the server's own mailbox is not usable (misconfigured, serverless).
  const m = getConfig().mail;
  return (ws ?? (await workspaceId())) === MAILBOX_WORKSPACE_ID && m.provider && m.reason ? { ...NONE, reason: m.reason } : NONE;
}

/** All mailboxes of the acting workspace, the default first, for the list in Settings. */
export async function listMailboxes(ws?: string): Promise<MailboxEntry[]> {
  return (await resolveAll(ws)).map((r) => ({ ...publicOf(r), id: r.id, address: r.address, isDefault: r.isDefault, provider: r.provider }));
}

/** For everything that sends or reads mail: refuses, in plain words, a workspace that has no usable mailbox. */
export async function assertMailboxForWorkspace(): Promise<void> {
  const box = await mailboxFor();
  if (!box.enabled) throw new Error(box.reason ?? NO_WORKSPACE_MAILBOX);
}

/** Every workspace that can send and read right now (the scheduler reads each one's inbox). */
export async function workspacesWithMailbox(): Promise<string[]> {
  const db = await getDb();
  const ids = new Set((await db.select({ id: mailboxes.workspaceId }).from(mailboxes).all()).map((r) => r.id));
  ids.add(MAILBOX_WORKSPACE_ID);
  const out: string[] = [];
  for (const id of ids) if ((await resolveAll(id)).some((r) => r.enabled)) out.push(id);
  return out;
}

/** One inbox read per workspace at a time (the queue's idempotency key). */
export const syncMailboxKey = (ws: string) => `sync_mailbox:${ws}`;

// ------------------------------------------------------------ connecting

export interface ConnectInput {
  provider: string;
  address: string;
  password: string;
  /** The sign-in name when it is not the address itself. */
  user?: string;
  smtpHost?: string;
  smtpPort?: number | string;
  imapHost?: string;
  imapPort?: number | string;
}

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const port = (v: number | string | undefined, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : fallback;
};

/**
 * Adds a mailbox to the acting workspace: checks the details, signs in to both servers (nothing is sent), and only
 * then stores them, the password encrypted. A mailbox that does not sign in is never saved. An address that is
 * already connected is updated (a new app password). The first mailbox of a workspace becomes its default.
 */
export async function connectMailbox(input: ConnectInput): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
  const cfg = getConfig();
  if (cfg.serverless) return { ok: false, error: SERVERLESS_OFF };
  const provider = input.provider.trim().toLowerCase();
  const address = input.address.trim().toLowerCase();
  // App passwords are shown in groups of four with spaces; the servers want them without.
  const password = provider === "custom" ? input.password.trim() : input.password.replace(/\s+/g, "");
  const user = (input.user ?? "").trim() || address;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address) || address.length > 254) return { ok: false, error: "That does not look like an email address." };

  if (provider === MICROSOFT) return { ok: false, error: "Use the Sign in with Microsoft button for this." };
  if (provider === "fake") {
    if (cfg.mail.provider !== "fake") return { ok: false, error: "Choose your mail provider." };
    await save({ provider, address, user, password: "", smtpHost: "fake.local", smtpPort: 465, imapHost: "fake.local", imapPort: 993 });
    return { ok: true, address };
  }
  const have = await resolveAll();
  if (have.filter((r) => r.address !== address).length >= MAX_MAILBOXES) return { ok: false, error: `A workspace can hold ${MAX_MAILBOXES} mailboxes. Remove one first.` };
  const preset = MAIL_PRESETS[provider];
  if (!preset && provider !== "custom") return { ok: false, error: "Choose your mail provider." };
  if (!password) return { ok: false, error: "Enter the app password of the mailbox." };
  if (password.length > 500) return { ok: false, error: "That password is too long." };
  const smtpHost = preset?.smtp.host ?? (input.smtpHost ?? "").trim().toLowerCase();
  const imapHost = preset?.imap.host ?? (input.imapHost ?? "").trim().toLowerCase();
  const smtpPort = preset?.smtp.port ?? port(input.smtpPort, 465);
  const imapPort = preset?.imap.port ?? port(input.imapPort, 993);
  if (!preset) {
    if (!HOST.test(smtpHost) || !HOST.test(imapHost)) return { ok: false, error: "Enter the outgoing (SMTP) and incoming (IMAP) server names, for example mail.yourcompany.com." };
    if (![25, 465, 587, 2525].includes(smtpPort) || ![143, 993].includes(imapPort)) return { ok: false, error: "Use port 465 or 587 for sending and 993 for reading." };
    // A server name someone typed must be a public mail server, never a machine inside our own network.
    try {
      await resolvePublicAddress(smtpHost);
      await resolvePublicAddress(imapHost);
    } catch {
      return { ok: false, error: "One of the server names could not be found, or is not a public mail server." };
    }
  }
  const config: SmtpImapConfig = { provider, address, user, password, smtp: { host: smtpHost, port: smtpPort, secure: smtpPort === 465 }, imap: { host: imapHost, port: imapPort } };
  const check = await smtpImapProvider(config).verify();
  const problems = [check.smtp ? `Sending: ${check.smtp}` : null, check.imap ? `Reading: ${check.imap}` : null].filter(Boolean);
  if (problems.length) return { ok: false, error: `The mailbox did not accept the sign-in, so nothing was saved. ${problems.join(" · ")}` };
  await save({ provider, address, user, password, smtpHost, smtpPort, imapHost, imapPort });
  return { ok: true, address };
}

/**
 * Adds the mailbox someone just signed in to with Microsoft. As with a password, it is saved only after both
 * connections (sending and reading) were opened with it once.
 */
export async function connectMicrosoftMailbox(signedIn: { address: string; refreshToken: string; accessToken: string; expiresIn: number }): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
  if (getConfig().serverless) return { ok: false, error: SERVERLESS_OFF };
  const address = signedIn.address.toLowerCase();
  const have = await resolveAll();
  if (have.filter((r) => r.address !== address).length >= MAX_MAILBOXES) return { ok: false, error: `A workspace can hold ${MAX_MAILBOXES} mailboxes. Remove one first.` };
  const check = await smtpImapProvider({ provider: MICROSOFT, address, user: address, password: "", smtp: { ...MICROSOFT_SERVERS.smtp, secure: false }, imap: MICROSOFT_SERVERS.imap, accessToken: async () => signedIn.accessToken }).verify();
  const problems = [check.smtp ? `Sending: ${check.smtp}` : null, check.imap ? `Reading: ${check.imap}` : null].filter(Boolean);
  if (problems.length) return { ok: false, error: `Microsoft signed you in, but the mailbox did not open, so nothing was saved. ${problems.join(" · ")}${check.smtp ? " In a company account, sending from other apps (\"authenticated SMTP\") may be switched off by the administrator." : ""}` };
  await save({ provider: MICROSOFT, address, user: address, password: signedIn.refreshToken, smtpHost: MICROSOFT_SERVERS.smtp.host, smtpPort: MICROSOFT_SERVERS.smtp.port, imapHost: MICROSOFT_SERVERS.imap.host, imapPort: MICROSOFT_SERVERS.imap.port });
  const db = await getDb();
  const row = await db.select({ id: mailboxes.id }).from(mailboxes).where(and(eq(mailboxes.workspaceId, await workspaceId()), eq(mailboxes.address, address))).get();
  if (row) rememberMicrosoftToken(row.id, signedIn.accessToken, signedIn.expiresIn);
  return { ok: true, address };
}

/** A workspace holds a handful of mailboxes, not a mail farm. */
export const MAX_MAILBOXES = 10;

async function save(m: { provider: string; address: string; user: string; password: string; smtpHost: string; smtpPort: number; imapHost: string; imapPort: number }) {
  const db = await getDb();
  const ws = await workspaceId();
  const { password, ...rest } = m;
  const values = { ...rest, passwordEnc: seal(password), updatedAt: nowIso() };
  const existing = await resolveAll(ws);
  // The first one a workspace connects is the one it sends from; later ones are added beside it.
  const isDefault = !existing.some((r) => r.enabled && r.address !== m.address);
  await db.insert(mailboxes).values({ id: newId(), workspaceId: ws, isDefault, ...values }).onConflictDoUpdate({ target: [mailboxes.workspaceId, mailboxes.address], set: values }).run();
}

/**
 * Removes one mailbox of the acting workspace (and its stored password). Emails already sent and replies already
 * read stay; if it was the default, the next working mailbox takes over. Returns the address removed, or null.
 */
export async function removeMailbox(id: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.delete(mailboxes).where(and(eq(mailboxes.id, id), eq(mailboxes.workspaceId, await workspaceId()))).returning({ address: mailboxes.address }).get();
  forgetMicrosoftToken(id);
  return row?.address ?? null;
}

/** Chooses the mailbox new emails are sent from. */
export async function setDefaultMailbox(id: string): Promise<string | null> {
  const ws = await workspaceId();
  const target = (await resolveAll(ws)).find((r) => r.id === id);
  if (!target || !target.enabled) return null;
  const db = await getDb();
  await db.update(mailboxes).set({ isDefault: sql`${mailboxes.id} = ${id}`, updatedAt: nowIso() }).where(eq(mailboxes.workspaceId, ws)).run();
  return target.address;
}

/** Kept for callers that only ask whether the server itself has a mailbox configured. */
export function mailEnabled(): boolean {
  return getConfig().mail.enabled;
}
