/**
 * Whether the product sends emails of its own to its users (the link that confirms an address, the link to
 * choose a new password). Read from the environment only, so anything may ask without pulling in the mail code.
 *
 * Two ways to switch them on:
 *  - a sender of the product's own: ACCOUNT_SMTP_HOST, ACCOUNT_SMTP_USER, ACCOUNT_SMTP_PASSWORD and
 *    ACCOUNT_MAIL_FROM (any SMTP service; ACCOUNT_SMTP_PORT defaults to 587). This is the one to use
 *    once customers rely on these emails;
 *  - ACCOUNT_EMAILS=on, which sends them from the first workspace's default mailbox.
 * With neither, nothing is sent: addresses are not confirmed and passwords are reset by hand.
 */
export function accountSender(): { host: string; port: number; user: string; password: string; from: string } | null {
  const e = process.env;
  const [host, user, password] = [e.ACCOUNT_SMTP_HOST?.trim(), e.ACCOUNT_SMTP_USER?.trim(), e.ACCOUNT_SMTP_PASSWORD];
  if (!host || !user || !password) return null;
  const port = Number(e.ACCOUNT_SMTP_PORT) || 587;
  return { host, port, user, password, from: e.ACCOUNT_MAIL_FROM?.trim() || user };
}

export const accountEmailsOn = () => Boolean(accountSender()) || process.env.ACCOUNT_EMAILS?.trim().toLowerCase() === "on";
