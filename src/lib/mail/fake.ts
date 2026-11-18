/**
 * An in-memory mailbox for tests and local dry runs (MAIL_PROVIDER=fake):
 * "sent" messages are kept in a list, the inbox is whatever a test puts in it,
 * and failures can be scripted. Nothing leaves the process.
 */
import { MailSendError, type InboundMessage, type MailProvider, type OutgoingMessage } from "./types";

interface FakeState {
  sent: OutgoingMessage[];
  inbox: InboundMessage[];
  nextUid: number;
  /** Errors thrown by the next sends, in order (null = succeed). */
  failures: (MailSendError | null)[];
  /** The mailbox accepted the message, then the "process died" before the app heard about it. */
  crashAfterAccept: boolean;
  sentFolderAvailable: boolean;
  uidValidity: string;
}

const g = globalThis as unknown as { __radarFakeMail?: FakeState };
const fresh = (): FakeState => ({ sent: [], inbox: [], nextUid: 1, failures: [], crashAfterAccept: false, sentFolderAvailable: true, uidValidity: "1" });

export function fakeMail(): FakeState {
  if (!g.__radarFakeMail) g.__radarFakeMail = fresh();
  return g.__radarFakeMail;
}
export function resetFakeMail() {
  g.__radarFakeMail = fresh();
}

/** Puts a message into the fake inbox as if it had arrived. */
export function deliverToFakeInbox(m: Omit<Partial<InboundMessage>, "from"> & { from: { address: string; name?: string }; text: string }): InboundMessage {
  const s = fakeMail();
  const uid = s.nextUid++;
  const msg: InboundMessage = { uid, messageId: m.messageId ?? `<in-${uid}@fake.local>`, inReplyTo: m.inReplyTo ?? null, references: m.references ?? [], from: { address: m.from.address.toLowerCase(), name: m.from.name ?? "" }, subject: m.subject ?? "", text: m.text, date: m.date ?? new Date().toISOString(), headers: m.headers ?? {}, rawHead: m.rawHead ?? m.text };
  s.inbox.push(msg);
  return msg;
}

export function fakeProvider(address: string): MailProvider {
  return {
    key: "fake",
    address,
    async send(msg) {
      const s = fakeMail();
      const failure = s.failures.shift();
      if (failure) throw failure;
      s.sent.push(msg);
      if (s.crashAfterAccept) {
        s.crashAfterAccept = false;
        throw new MailSendError("The connection broke after the message was handed over", "unknown");
      }
      return { response: "250 OK (fake mailbox)" };
    },
    async wasSent(messageId) {
      const s = fakeMail();
      return s.sentFolderAvailable ? s.sent.some((m) => m.messageId === messageId) : null;
    },
    async fetchInbox({ cursor, since, limit = 200 }) {
      const s = fakeMail();
      const usable = cursor && cursor.uidValidity === s.uidValidity;
      const messages = s.inbox.filter((m) => (usable ? m.uid > cursor.uid : new Date(m.date) >= since)).slice(-limit);
      const last = s.inbox.length ? Math.max(...s.inbox.map((m) => m.uid)) : (usable ? cursor.uid : 0);
      return { messages, cursor: { uid: last, uidValidity: s.uidValidity } };
    },
    async verify() {
      return { smtp: null, imap: null };
    },
  };
}
