/**
 * Reading incoming mail: parse the raw message, tell bounces and automatic
 * replies from real ones, and cut the quoted original out of a reply. Message
 * content is untrusted text: it is stored and shown, never acted on.
 */
import PostalMime from "postal-mime";
import type { InboundMessage } from "./types";

const htmlToText = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();

export const MAX_STORED_TEXT = 20_000;

export async function parseRawEmail(raw: Buffer | Uint8Array | string, uid: number, internalDate?: Date | string | null): Promise<InboundMessage> {
  const mail = await PostalMime.parse(raw);
  const headers: Record<string, string> = {};
  for (const h of mail.headers) if (!(h.key.toLowerCase() in headers)) headers[h.key.toLowerCase()] = h.value;
  const from = mail.from && "address" in mail.from && mail.from.address ? { address: mail.from.address.toLowerCase(), name: mail.from.name ?? "" } : { address: "", name: mail.from?.name ?? "" };
  const text = (mail.text?.trim() ? mail.text : mail.html ? htmlToText(mail.html) : "").slice(0, MAX_STORED_TEXT);
  const date = mail.date ? new Date(mail.date) : internalDate ? new Date(internalDate) : new Date();
  const rawHead = (typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8")).slice(0, 60_000);
  return {
    uid,
    messageId: mail.messageId?.trim() || `<no-message-id-${uid}@inbox.local>`,
    inReplyTo: mail.inReplyTo?.trim() || null,
    references: (mail.references ?? "").split(/\s+/).filter(Boolean),
    from,
    subject: mail.subject ?? "",
    text,
    date: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    headers,
    rawHead,
  };
}

const BOUNCE_SENDER_RE = /^(mailer-daemon|postmaster|mail-daemon|bounce[s-]?[\w.+-]*)@/i;
const BOUNCE_SUBJECT_RE = /^(undeliverable|undelivered mail|delivery status notification|mail delivery (failed|failure|subsystem)|returned mail|failure notice|delivery failure|message not delivered)/i;

export function isBounce(m: Pick<InboundMessage, "from" | "subject" | "headers">): boolean {
  const ct = m.headers["content-type"] ?? "";
  return BOUNCE_SENDER_RE.test(m.from.address) || (/multipart\/report/i.test(ct) && /delivery-status/i.test(ct)) || Boolean(m.headers["x-failed-recipients"]) || BOUNCE_SUBJECT_RE.test(m.subject.trim());
}

/** A permanent failure (the address does not exist) rather than a full mailbox or a temporary problem. */
export function isHardBounce(m: Pick<InboundMessage, "text" | "rawHead">): boolean {
  const hay = `${m.rawHead}\n${m.text}`;
  const status = /\bStatus:\s*([245])\.\d{1,3}\.\d{1,3}/i.exec(hay)?.[1];
  if (status) return status === "5";
  if (/\b(mailbox full|over quota|quota exceeded|try again later|temporar(y|ily))\b/i.test(hay)) return false;
  return /\b(5\d\d[ -]|does not exist|doesn[’']t exist|user unknown|unknown user|no such (user|mailbox|address)|address (not found|rejected)|recipient (address )?rejected|invalid recipient|account (is )?disabled)\b/i.test(hay);
}

/** Addresses a bounce names as failed: the X-Failed-Recipients header first, then the delivery report, then the text. */
export function bouncedRecipients(m: Pick<InboundMessage, "headers" | "text" | "rawHead">): string[] {
  const out = new Set<string>();
  for (const a of (m.headers["x-failed-recipients"] ?? "").split(/[,\s]+/)) if (a.includes("@")) out.add(a.toLowerCase());
  for (const x of `${m.rawHead}\n${m.text}`.matchAll(/(?:Final-Recipient|Original-Recipient):\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?/gi)) out.add(x[1].toLowerCase());
  return [...out];
}

const AUTO_SUBJECT_RE = /^(auto(matic)?[ -]?reply|autoreply|out of (the )?office|ooo\b|away from|on vacation|abwesen|automatische antwort)/i;

/** An out-of-office or other automatic answer: recorded, but not a reply from a person. */
export function isAutoReply(m: Pick<InboundMessage, "subject" | "headers">): boolean {
  const auto = (m.headers["auto-submitted"] ?? "").toLowerCase();
  if (auto && auto !== "no") return true;
  if (m.headers["x-autoreply"] || m.headers["x-autorespond"] || m.headers["x-auto-reply"]) return true;
  if (/^(auto_reply|auto-reply|bulk|junk)$/i.test((m.headers["precedence"] ?? "").trim())) return true;
  return AUTO_SUBJECT_RE.test(m.subject.trim());
}

/** The reply without the quoted original below it. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const cut = lines.findIndex((l, i) => /^On\b.{0,200}\bwrote:\s*$/i.test(l.trim()) || (/^On\b/i.test(l.trim()) && /\bwrote:\s*$/i.test((lines[i + 1] ?? "").trim()) && l.length < 200) || /^-{2,}\s*(Original Message|Forwarded message)/i.test(l.trim()) || /^_{10,}$/.test(l.trim()) || (/^From:\s.+/i.test(l.trim()) && /^(Sent|Date):\s/i.test((lines[i + 1] ?? "").trim())));
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !/^\s*>/.test(l));
  const out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || text.trim();
}

const UNSUBSCRIBE_RE = /\b(unsubscribe|remove me|take me off|stop (emailing|contacting|sending|writing)|do not (contact|email)|don[’']t (contact|email)( me)? again|no more emails|opt[ -]?out)\b/i;

/** A request not to be contacted again, recognised without a model so it can always be honoured. */
export function asksToUnsubscribe(text: string, subject = ""): boolean {
  const body = stripQuoted(text);
  if (UNSUBSCRIBE_RE.test(body) || /^\s*unsubscribe\b/i.test(subject)) return true;
  // A bare "no thanks": the exact answer the email's last line asks for.
  return /^\W*(no,?\s+thanks?|no thank you|not interested)\W*$/i.test(body.split("\n").slice(0, 2).join(" ").trim());
}
