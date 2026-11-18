import { getConfig } from "@/lib/config";
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
