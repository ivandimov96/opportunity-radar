/**
 * Does the sending domain say who may send for it? Receiving servers look up
 * two public DNS records before they trust a message: SPF (which servers may
 * send for the domain) and DMARC (what to do with mail that fails the check).
 * A domain without them is far more likely to land in spam once volume grows.
 * This only reads public DNS; it sends nothing. DKIM cannot be checked from
 * outside without knowing the provider's selector, so it is not claimed here.
 */
import dns from "node:dns/promises";
import { emailDomain } from "./address";

const FREE_MAILBOX = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|aol|proton|protonmail|gmx|mail|zoho|yandex)\.[a-z.]{2,6}$/i;

export interface DomainHealth {
  domain: string;
  /** A shared mailbox provider's domain: its records are the provider's business, not the sender's. */
  freeMailbox: boolean;
  spf: boolean | null;
  dmarc: boolean | null;
  /** One sentence per thing worth knowing, in plain words; empty when everything is in place. */
  advice: string[];
}

type ResolveTxt = (name: string) => Promise<string[][]>;

async function hasRecord(resolve: ResolveTxt, name: string, marker: RegExp): Promise<boolean | null> {
  try {
    const rows = await Promise.race([resolve(name), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))]);
    return rows.some((parts) => marker.test(parts.join("")));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // "No such record" is an answer; anything else (no network, timeout) is "could not tell".
    return code === "ENODATA" || code === "ENOTFOUND" ? false : null;
  }
}

export async function senderDomainHealth(address: string, resolveTxt: ResolveTxt = (n) => dns.resolveTxt(n)): Promise<DomainHealth | null> {
  const domain = emailDomain(address);
  if (!domain) return null;
  if (FREE_MAILBOX.test(domain)) {
    return { domain, freeMailbox: true, spf: null, dmarc: null, advice: [`You send from a free ${domain} address. That works at low volume; an address on your own domain looks more trustworthy to the people you write to and to spam filters.`] };
  }
  const [spf, dmarc] = await Promise.all([hasRecord(resolveTxt, domain, /^v=spf1\b/i), hasRecord(resolveTxt, `_dmarc.${domain}`, /^v=DMARC1\b/i)]);
  const advice: string[] = [];
  if (spf === false) advice.push(`${domain} has no SPF record: ask whoever manages the domain to add the one your mailbox provider gives you.`);
  if (dmarc === false) advice.push(`${domain} has no DMARC record: add at least "v=DMARC1; p=none" at _dmarc.${domain}.`);
  if (spf === null || dmarc === null) advice.push(`The sending records of ${domain} could not be looked up just now.`);
  return { domain, freeMailbox: false, spf, dmarc, advice };
}
