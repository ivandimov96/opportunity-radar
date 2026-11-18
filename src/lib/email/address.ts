/**
 * Email address checks that cost nothing and send nothing: syntax, and whether
 * the domain has mail servers (DNS MX). No mailbox probing: it is unreliable
 * and looks like abuse to the receiving server. A bounce after sending is the
 * only real proof, and it suppresses the address.
 */
import { resolveMx } from "node:dns/promises";

const SYNTAX_RE = /^[a-z0-9._%+-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
const FREEMAIL_RE = /^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|aol|icloud|me|mac|proton|protonmail|pm|gmx|mail|comcast|att|sbcglobal|verizon|bellsouth|cox|charter)\.(com|net|me|org|de|fr|co\.uk|ca)$/i;

export type EmailStatus = "valid" | "invalid" | "unchecked";

export function normalizeAddress(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e || null;
}

export function emailSyntaxOk(email: string): boolean {
  return email.length <= 254 && SYNTAX_RE.test(email) && !email.includes("..");
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/** A consumer mailbox provider (many small businesses publish one as their business address). */
export function isFreemail(email: string): boolean {
  return FREEMAIL_RE.test(emailDomain(email));
}

type Resolver = (domain: string) => Promise<unknown[]>;
let resolver: Resolver = (d) => resolveMx(d);
/** Test hook. */
export function _setMxResolver(fn: Resolver | null) {
  resolver = fn ?? ((d) => resolveMx(d));
}

export async function checkEmailAddress(email: string | null | undefined, opts: { mx?: boolean; timeoutMs?: number } = {}): Promise<{ status: EmailStatus; reason: string | null }> {
  const e = normalizeAddress(email);
  if (!e) return { status: "invalid", reason: "no address" };
  if (!emailSyntaxOk(e)) return { status: "invalid", reason: "not a valid email address" };
  if (opts.mx === false) return { status: "unchecked", reason: "mail servers not checked" };
  try {
    const records = await Promise.race([resolver(emailDomain(e)), new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), opts.timeoutMs ?? 4000))]);
    return records.length ? { status: "valid", reason: null } : { status: "invalid", reason: "the domain has no mail servers" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    if (code === "ENOTFOUND" || code === "ENODATA") return { status: "invalid", reason: "the domain does not exist or has no mail servers" };
    return { status: "unchecked", reason: "mail servers could not be checked right now" };
  }
}
