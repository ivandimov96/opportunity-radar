/**
 * The evidence pack: everything an outreach email may say about a business.
 * Only verified facts and observations go in, each with its ref and the exact
 * words from the website. Measured values (fetch size, dates from registries)
 * and contact details are left out: they are not things to tell a business
 * about itself. Things not found on the site are listed separately, and only
 * the ones the opportunity rests on: they may be raised as questions, never
 * stated.
 */
import { factLabel, factValueLabel } from "@/lib/profile/fields";

export interface EvidenceItem {
  ref: string;
  label: string;
  /** What is established, in plain words. */
  text: string;
  /** The exact words from the website (or what was detected), when there are any. */
  quote: string | null;
  sourceUrl: string | null;
}

export interface EvidencePack {
  verified: EvidenceItem[];
  notSeen: { ref: string; label: string }[];
  /** Lower-cased text of everything verified: used to check numbers and names in an email. */
  haystack: string;
}

/** Never offered to the writer: measurements and registry dates, contact channels, and the greeting name. */
const EXCLUDED_KEYS = new Set(["website_health", "website_updated", "domain_registered", "site_first_seen", "email_provider", "email_senders", "email", "phone", "address", "social_profiles", "contact_person", "hours"]);
const MAX_VERIFIED = 16;
const MAX_NOT_SEEN = 4;

export interface FactRow {
  key: string;
  status: string;
  value: string | null;
  evidenceQuote?: string | null;
  sourceUrl?: string | null;
}
export interface ObservationRow {
  ref: string;
  kind: string;
  statement: string;
  evidenceQuote: string;
  sourceUrl: string;
}

export function buildEvidencePack(facts: FactRow[], observations: ObservationRow[], opportunity: { supportingFactKeys: string[] } | null): EvidencePack {
  const cited = new Set(opportunity?.supportingFactKeys ?? []);
  const citedFirst = <T extends { ref: string }>(xs: T[]) => [...xs.filter((x) => cited.has(x.ref)), ...xs.filter((x) => !cited.has(x.ref))];
  const factItems: EvidenceItem[] = facts
    .filter((f) => f.status === "verified" && f.value && f.value !== "no" && !EXCLUDED_KEYS.has(f.key))
    .map((f) => ({ ref: f.key, label: factLabel(f.key), text: f.value === "yes" ? factLabel(f.key) : `${factLabel(f.key)}: ${factValueLabel(f.value)}`, quote: f.evidenceQuote?.trim() || null, sourceUrl: f.sourceUrl ?? null }));
  const obsItems: EvidenceItem[] = observations.map((o) => ({ ref: o.ref, label: o.kind, text: o.statement, quote: o.evidenceQuote, sourceUrl: o.sourceUrl }));
  const verified = citedFirst([...obsItems, ...factItems]).slice(0, MAX_VERIFIED);
  const notSeen = facts
    .filter((f) => f.status === "not_found" && cited.has(f.key) && !EXCLUDED_KEYS.has(f.key))
    .slice(0, MAX_NOT_SEEN)
    .map((f) => ({ ref: f.key, label: factLabel(f.key) }));
  const haystack = verified
    .map((v) => `${v.text} ${v.quote ?? ""}`)
    .join(" \n ")
    .toLowerCase();
  return { verified, notSeen, haystack };
}

export function renderEvidencePack(pack: EvidencePack): string {
  const v = pack.verified.map((e) => `[${e.ref}] ${e.text}${e.quote ? ` — their words: "${e.quote.replace(/\s+/g, " ").slice(0, 260)}"` : ""}`).join("\n");
  const n = pack.notSeen.map((e) => `[${e.ref}] ${e.label}`).join("\n");
  return `VERIFIED (may be stated; cite the ref in claims):\n${v || "(nothing)"}\n\nNOT SEEN ON THEIR SITE (not facts about the business; may only be raised as an open question; cite the ref):\n${n || "(nothing)"}`;
}
