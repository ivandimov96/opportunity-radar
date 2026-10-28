/**
 * Off-site footprint: public records about the domain that need no key and
 * are not under the business's editorial control.
 *  - RDAP (registry data): domain registration year.
 *  - DNS MX: email hosting provider; SPF includes: authorized sending services.
 *  - Internet Archive CDX: year the site was first captured.
 * Every lookup is bounded, runs in parallel and fails independently; a failure
 * simply yields no fact (never a guess).
 */
import dns from "node:dns/promises";
import type { DetectedFact } from "./detect";

const TIMEOUT_MS = 8_000;

const MX_PROVIDERS: [RegExp, string][] = [
  [/google\.com$|googlemail\.com$/i, "Google Workspace"],
  [/outlook\.com$|office365\.com$|microsoft\.com$/i, "Microsoft 365"],
  [/secureserver\.net$|godaddy\.com$/i, "GoDaddy email"],
  [/zoho\.(com|eu)$/i, "Zoho Mail"],
  [/yahoodns\.net$|yahoo\.com$/i, "Yahoo"],
  [/protonmail\.ch$|proton\.me$/i, "Proton Mail"],
  [/pphosted\.com$|proofpoint\.com$/i, "Proofpoint-filtered"],
  [/mimecast\.com$/i, "Mimecast-filtered"],
  [/emailsrvr\.com$|rackspace\.com$/i, "Rackspace email"],
  [/ionos\.(com|de)$|1and1\.com$/i, "IONOS"],
  [/hostinger\.com$/i, "Hostinger"],
  [/mail\.protection\.outlook\.com$/i, "Microsoft 365"],
  [/wixdns\.net$|wix\.com$/i, "Wix email"],
  [/icloud\.com$/i, "iCloud"],
  [/mxroute\.com$|hostgator\.com$|bluehost\.com$|dreamhost\.com$|siteground\.(com|net)$|namecheap\.com$|privateemail\.com$/i, "Web-host email"],
];

const SPF_SENDERS: [RegExp, string][] = [
  [/_spf\.google\.com/i, "Google Workspace"],
  [/spf\.protection\.outlook\.com/i, "Microsoft 365"],
  [/servers\.mcsv\.net|mailchimp/i, "Mailchimp"],
  [/spf\.constantcontact\.com/i, "Constant Contact"],
  [/sendgrid\.net/i, "SendGrid"],
  [/mailgun\.org/i, "Mailgun"],
  [/amazonses\.com/i, "Amazon SES"],
  [/_spf\.salesforce\.com|pardot/i, "Salesforce"],
  [/hubspot|hubspotemail\.net/i, "HubSpot"],
  [/klaviyo/i, "Klaviyo"],
  [/sendinblue|brevo/i, "Brevo"],
  [/zendesk\.com/i, "Zendesk"],
  [/servicetitan/i, "ServiceTitan"],
  [/housecallpro/i, "Housecall Pro"],
  [/getjobber|jobber/i, "Jobber"],
  [/podium/i, "Podium"],
  [/birdeye/i, "Birdeye"],
  [/kukui/i, "Kukui"],
  [/mechanicnet|steercrm/i, "Steer CRM"],
  [/tekmetric/i, "Tekmetric"],
  [/shopmonkey/i, "Shopmonkey"],
  [/autoleap/i, "AutoLeap"],
  [/quickbooks|intuit/i, "QuickBooks"],
  [/squareup\.com|square\.com/i, "Square"],
  [/stripe\.com/i, "Stripe"],
  [/zohomail|zoho\.com/i, "Zoho"],
  [/secureserver\.net/i, "GoDaddy"],
  [/wix\.com|wixdns/i, "Wix"],
  [/squarespace/i, "Squarespace"],
];

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }, (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

/** Registrable domain (last two labels; good enough for .com/.net/.org SMB sites). */
export function registrableDomain(hostname: string): string {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  // Handle common two-level public suffixes (co.uk, com.au, ...).
  if (/^(co|com|net|org|gov|edu|ac)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

export interface FootprintDeps {
  resolveMx?: (d: string) => Promise<{ exchange: string; priority: number }[]>;
  resolveTxt?: (d: string) => Promise<string[][]>;
  fetchJson?: (url: string) => Promise<unknown>;
  fetchText?: (url: string) => Promise<string>;
  /** Aborts the default lookups (job timeout). */
  signal?: AbortSignal;
}

async function defaultFetch(url: string, accept: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { headers: { Accept: accept, "User-Agent": "OpportunityRadarBot/0.1 (+https://github.com/opportunity-radar; respectful research crawler)" }, signal: signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), signal]) : AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export async function rdapRegistrationYear(domain: string, deps: FootprintDeps = {}): Promise<{ year: number; url: string } | null> {
  const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  const data = (await (deps.fetchJson ? deps.fetchJson(url) : defaultFetch(url, "application/rdap+json, application/json", deps.signal).then((r) => r.json()))) as { events?: { eventAction?: string; eventDate?: string }[] } | null;
  const ev = data?.events?.find((e) => e.eventAction === "registration");
  const y = ev?.eventDate ? new Date(ev.eventDate).getUTCFullYear() : NaN;
  return Number.isFinite(y) ? { year: y, url } : null;
}

export async function waybackFirstYear(domain: string, deps: FootprintDeps = {}): Promise<{ year: number; url: string } | null> {
  const api = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&limit=1&fl=timestamp&filter=statuscode:200`;
  const text = await (deps.fetchText ? deps.fetchText(api) : defaultFetch(api, "text/plain", deps.signal).then((r) => r.text()));
  const m = /^(\d{4})\d{10}/m.exec(text.trim());
  if (!m) return null;
  return { year: Number(m[1]), url: `https://web.archive.org/web/${m[0]}/${domain}` };
}

export async function mailFootprint(domain: string, deps: FootprintDeps = {}): Promise<{ provider: string | null; mx: string[]; senders: string[]; spf: string | null }> {
  const resolveMx = deps.resolveMx ?? ((d: string) => dns.resolveMx(d));
  const resolveTxt = deps.resolveTxt ?? ((d: string) => dns.resolveTxt(d));
  const [mxRes, txtRes] = await Promise.allSettled([withTimeout(resolveMx(domain)), withTimeout(resolveTxt(domain))]);
  const mx = mxRes.status === "fulfilled" ? mxRes.value.sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase().replace(/\.$/, "")) : [];
  let provider: string | null = null;
  for (const host of mx) {
    const hit = MX_PROVIDERS.find(([re]) => re.test(host));
    if (hit) {
      provider = hit[1];
      break;
    }
  }
  if (!provider && mx.length) provider = mx[0].endsWith(domain) ? "Self-hosted / web host" : `Other (${registrableDomain(mx[0])})`;
  const spf = txtRes.status === "fulfilled" ? txtRes.value.map((parts) => parts.join("")).find((t) => /^v=spf1/i.test(t)) ?? null : null;
  const senders: string[] = [];
  if (spf) for (const [re, name] of SPF_SENDERS) if (re.test(spf) && !senders.includes(name)) senders.push(name);
  return { provider, mx, senders, spf };
}

/** All lookups in parallel; returns verified facts only for what succeeded. */
export async function footprintFacts(website: string, deps: FootprintDeps = {}): Promise<{ facts: DetectedFact[]; notes: string[] }> {
  const notes: string[] = [];
  let domain: string;
  try {
    domain = registrableDomain(new URL(website).hostname);
  } catch {
    return { facts: [], notes: ["Footprint skipped: invalid website URL"] };
  }
  const [rdap, wayback, mail] = await Promise.allSettled([withTimeout(rdapRegistrationYear(domain, deps)), withTimeout(waybackFirstYear(domain, deps)), mailFootprint(domain, deps)]);
  const facts: DetectedFact[] = [];
  if (rdap.status === "fulfilled" && rdap.value) facts.push({ key: "domain_registered", status: "verified", value: String(rdap.value.year), evidenceQuote: `RDAP registration event for ${domain}`, sourceUrl: rdap.value.url });
  else notes.push(`RDAP lookup for ${domain} unavailable${rdap.status === "rejected" ? ` (${(rdap.reason as Error).message})` : ""}`);
  if (wayback.status === "fulfilled" && wayback.value) facts.push({ key: "site_first_seen", status: "verified", value: String(wayback.value.year), evidenceQuote: `First Internet Archive capture of ${domain}`, sourceUrl: wayback.value.url });
  else notes.push(`Internet Archive lookup for ${domain} unavailable${wayback.status === "rejected" ? ` (${(wayback.reason as Error).message})` : ""}`);
  if (mail.status === "fulfilled") {
    const m = mail.value;
    const dnsUrl = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`;
    if (m.provider) facts.push({ key: "email_provider", status: "verified", value: m.provider, evidenceQuote: `MX: ${m.mx.slice(0, 2).join(", ")}`, sourceUrl: dnsUrl });
    else if (!m.mx.length) facts.push({ key: "email_provider", status: "not_found", value: null, evidenceQuote: `No MX record for ${domain} (email is not hosted on the business domain)`, sourceUrl: null });
    if (m.senders.length) facts.push({ key: "email_senders", status: "verified", value: m.senders.join(", "), evidenceQuote: `SPF: ${m.spf!.slice(0, 160)}`, sourceUrl: `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=TXT` });
    else if (m.spf) facts.push({ key: "email_senders", status: "not_found", value: null, evidenceQuote: "SPF record names no recognized marketing/transactional sender", sourceUrl: null });
  } else notes.push(`DNS lookup for ${domain} failed`);
  return { facts, notes };
}
