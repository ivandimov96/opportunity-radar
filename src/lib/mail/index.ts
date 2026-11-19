import { FIRST_WORKSPACE_ID } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { workspaceId } from "@/lib/workspace";
import { fakeProvider } from "./fake";
import { smtpImapProvider } from "./smtp-imap";
import type { MailProvider } from "./types";

export * from "./types";

/** The connected mailbox, or null when none is configured (sending and reply sync are then off). */
export function getMailProvider(): MailProvider | null {
  const m = getConfig().mail;
  if (!m.enabled || !m.address) return null;
  if (m.provider === "fake") return fakeProvider(m.address);
  return smtpImapProvider({ provider: m.provider!, address: m.address, user: m.user!, password: m.password!, smtp: m.smtp!, imap: m.imap! });
}

export function mailEnabled(): boolean {
  return getConfig().mail.enabled;
}

/**
 * Whose mailbox it is. There is ONE mailbox, from the environment, and it belongs to the first
 * workspace. Until each workspace connects its own, every other workspace has none: it can write,
 * review and approve emails, but nothing is sent or read for it. This is the only place that rule lives.
 */
export const MAILBOX_WORKSPACE_ID = FIRST_WORKSPACE_ID;
export const NO_WORKSPACE_MAILBOX = "This workspace has no mailbox connected yet.";

/** The mailbox as the acting workspace has it: what the pages show and what the pre-send summary checks. */
export async function mailboxFor(ws?: string): Promise<{ enabled: boolean; address: string | null; reason: string | null }> {
  if ((ws ?? (await workspaceId())) !== MAILBOX_WORKSPACE_ID) return { enabled: false, address: null, reason: NO_WORKSPACE_MAILBOX };
  const m = getConfig().mail;
  return { enabled: m.enabled, address: m.address ?? null, reason: m.reason ?? null };
}

/** For everything that sends or reads mail: refuses, in plain words, a workspace that has no mailbox of its own. */
export async function assertMailboxForWorkspace(): Promise<void> {
  if ((await workspaceId()) !== MAILBOX_WORKSPACE_ID) throw new Error(NO_WORKSPACE_MAILBOX);
}

/** One inbox read per workspace at a time (the queue's idempotency key). */
export const syncMailboxKey = (ws: string) => `sync_mailbox:${ws}`;
