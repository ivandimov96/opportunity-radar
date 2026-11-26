/**
 * Sends one of the product's own emails to a user: from the product's own sender when one is set up,
 * otherwise from the first workspace's default mailbox (see account-emails.ts). Plain text only, one
 * recipient, nothing tracked.
 */
import nodemailer from "nodemailer";
import { FIRST_WORKSPACE_ID } from "@/db/schema";
import { newId } from "@/lib/ids";
import { getMailProvider } from "@/lib/mail";
import { accountEmailsOn, accountSender } from "./account-emails";

type Transport = { sendMail(msg: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
let injected: Transport | null = null;
/** Test hook: stands in for the product's own SMTP sender. */
export function _setAccountTransport(t: Transport | null) {
  injected = t;
}

const SENDER_NAME = "Opportunity Radar";

/** True when the email was handed over for delivery; false when account emails are off or no sender can be reached. */
export async function sendAccountEmail(msg: { to: string; subject: string; text: string }): Promise<boolean> {
  if (!accountEmailsOn()) return false;
  const own = accountSender();
  if (own) {
    const transport = injected ?? nodemailer.createTransport({ host: own.host, port: own.port, secure: own.port === 465, auth: { user: own.user, pass: own.password } });
    await transport.sendMail({ from: `"${SENDER_NAME}" <${own.from}>`, to: msg.to, subject: msg.subject, text: msg.text });
    return true;
  }
  const provider = await getMailProvider(FIRST_WORKSPACE_ID);
  if (!provider) return false;
  await provider.send({ from: { name: SENDER_NAME, address: provider.address }, to: msg.to, subject: msg.subject, text: msg.text, messageId: `<${newId()}@${provider.address.split("@")[1] ?? "localhost"}>` });
  return true;
}
