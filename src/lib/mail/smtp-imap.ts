/**
 * A real mailbox over SMTP (send) and IMAP (read): works with Gmail / Google
 * Workspace, Yahoo, iCloud, Zoho, Fastmail and most hosting providers through
 * an app password. Mail goes out from the operator's own address, lands in
 * their Sent folder, and replies come back to their inbox, where this reads
 * them. Nothing here retries: the send job decides what an error means.
 */
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { ImapFlow } from "imapflow";
import { parseRawEmail } from "./parse";
import { MailSendError, type InboundMessage, type InboxCursor, type MailProvider, type OutgoingMessage } from "./types";

export interface SmtpImapConfig {
  provider: string;
  address: string;
  user: string;
  password: string;
  smtp: { host: string; port: number; secure: boolean };
  imap: { host: string; port: number };
}

/** Gmail files a copy of everything sent over SMTP in Sent on its own; other mailboxes need the copy appended. */
const SAVES_SENT_COPY = new Set(["gmail"]);
const MAX_SOURCE_BYTES = 300_000;

function toSendError(err: unknown): MailSendError {
  const e = err as { code?: string; responseCode?: number; permanent?: boolean; response?: string; message?: string };
  const detail = (e.response ?? e.message ?? String(err)).split("\n")[0].slice(0, 300);
  if (e.code === "EAUTH" || e.code === "ENOAUTH" || e.code === "EOAUTH2") return new MailSendError(`The mailbox refused the login: ${detail}`, "auth", e.responseCode);
  if (e.responseCode) return new MailSendError(detail, (e.permanent ?? (e.responseCode >= 500 && e.responseCode !== 503)) ? "rejected" : "temporary", e.responseCode);
  if (e.code === "EDNS" || e.code === "ETLS" || e.code === "ECONFIG" || e.code === "EPROXY" || e.code === "EENVELOPE") return new MailSendError(detail, "connection");
  // A broken or timed-out connection may have happened after the message was handed over: the outcome is not known.
  return new MailSendError(detail, "unknown");
}

export function smtpImapProvider(cfg: SmtpImapConfig): MailProvider {
  const transport = () => nodemailer.createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure, auth: { user: cfg.user, pass: cfg.password }, connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 45_000 });
  const imap = () => new ImapFlow({ host: cfg.imap.host, port: cfg.imap.port, secure: true, auth: { user: cfg.user, pass: cfg.password }, logger: false, connectionTimeout: 20_000, socketTimeout: 60_000 });
  const withImap = async <T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> => {
    const client = imap();
    // imapflow reports a dropped connection as an event; without a listener that would crash the process.
    client.on("error", () => {});
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => client.close());
    }
  };
  const sentFolder = async (client: ImapFlow) => {
    const boxes = await client.list();
    return boxes.find((b) => b.specialUse === "\\Sent") ?? boxes.find((b) => /^(sent|sent items|sent mail|sent messages)$/i.test(b.name)) ?? null;
  };

  return {
    key: cfg.provider,
    address: cfg.address,

    async send(msg: OutgoingMessage) {
      const raw = await new MailComposer({ from: msg.from, to: msg.to, subject: msg.subject, text: msg.text, messageId: msg.messageId, inReplyTo: msg.inReplyTo ?? undefined, references: msg.references?.length ? msg.references : undefined, headers: msg.headers, date: new Date() }).compile().build();
      let response: string;
      const t = transport();
      try {
        const info = await t.sendMail({ envelope: { from: cfg.address, to: [msg.to] }, raw });
        response = String(info.response ?? "accepted");
      } catch (err) {
        throw toSendError(err);
      } finally {
        t.close();
      }
      let note: string | null = null;
      if (!SAVES_SENT_COPY.has(cfg.provider)) {
        try {
          await withImap(async (client) => {
            const sent = await sentFolder(client);
            if (!sent) throw new Error("no Sent folder found");
            await client.append(sent.path, raw, ["\\Seen"]);
          });
        } catch (err) {
          note = `Sent, but the copy could not be saved to the Sent folder (${(err as Error).message.split("\n")[0]})`;
        }
      }
      return { response, note };
    },

    async wasSent(messageId: string) {
      try {
        return await withImap(async (client) => {
          const sent = await sentFolder(client);
          if (!sent) return null;
          const lock = await client.getMailboxLock(sent.path);
          try {
            const hits = await client.search({ header: { "message-id": messageId } }, { uid: true });
            return Array.isArray(hits) && hits.length > 0;
          } finally {
            lock.release();
          }
        });
      } catch {
        return null;
      }
    },

    async fetchInbox({ cursor, since, limit = 200 }) {
      return withImap(async (client) => {
        const lock = await client.getMailboxLock("INBOX");
        try {
          const box = client.mailbox;
          const uidValidity = box ? String(box.uidValidity) : "";
          const usable = cursor && cursor.uidValidity === uidValidity;
          const found = usable ? await client.search({ uid: `${cursor.uid + 1}:*` }, { uid: true }) : await client.search({ since }, { uid: true });
          // "n:*" always matches the newest message, even when its UID is below n.
          const uids = (Array.isArray(found) ? found : []).filter((u) => !usable || u > cursor.uid).sort((a, b) => a - b).slice(-limit);
          const messages: InboundMessage[] = [];
          if (uids.length) {
            for await (const m of client.fetch(uids, { uid: true, source: { maxLength: MAX_SOURCE_BYTES }, internalDate: true }, { uid: true })) {
              if (!m.source) continue;
              try {
                messages.push(await parseRawEmail(m.source, m.uid, m.internalDate ?? null));
              } catch {
                /* an unreadable message is skipped; the cursor still moves past it */
              }
            }
          }
          const last = uids.length ? uids[uids.length - 1] : usable ? cursor.uid : box && box.uidNext ? box.uidNext - 1 : 0;
          const next: InboxCursor | null = uidValidity ? { uid: last, uidValidity } : null;
          return { messages, cursor: next };
        } finally {
          lock.release();
        }
      });
    },

    async verify() {
      let smtp: string | null = null;
      let imapErr: string | null = null;
      const t = transport();
      try {
        await t.verify();
      } catch (err) {
        smtp = toSendError(err).message;
      } finally {
        t.close();
      }
      try {
        await withImap(async () => undefined);
      } catch (err) {
        imapErr = (err as Error).message.split("\n")[0];
      }
      return { smtp, imap: imapErr };
    },
  };
}
