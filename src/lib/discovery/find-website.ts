/**
 * Website finder for businesses discovered without a URL (the most common gap
 * in OpenStreetMap data). Two sources, both verified before anything is stored:
 *  1. Web search: "<name>" <city> <region>, aggregator/social domains dropped.
 *  2. Domain guesses built from the name (compact and hyphenated, .com/.net).
 * Verification fetches the candidate homepage and requires the business phone
 * (strongest) or the name plus the city/region on the page. A guess that only
 * matches the name is rejected: many similarly named shops exist elsewhere.
 */
import { normalizeName, isAggregatorUrl } from "./normalize";
import { normalizePhone } from "./normalize";
import { safeFetch } from "@/lib/research/fetcher";
import { extractPage } from "@/lib/research/html";
import { webSearch, type SearchFn } from "@/lib/search";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
import dns from "node:dns/promises";

export interface FindInput {
  name: string;
  city?: string | null;
  region?: string | null;
  phone?: string | null;
  street?: string | null;
  email?: string | null;
}

export interface FindResult {
  website: string;
  source: "found_search" | "found_guess" | "found_email";
  confidence: number;
  evidence: string;
  notes: string[];
}

const STOP = new Set(["auto", "automotive", "repair", "service", "services", "shop", "center", "centre", "llc", "inc", "co", "company", "the", "and", "of", "garage", "car", "care", "tire", "tires", "collision", "body", "mechanic", "mechanics"]);

export function nameTokens(name: string): string[] {
  return normalizeName(name)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP.has(t));
}

const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|live|msn|aol|icloud|me|mac|protonmail|proton|comcast|att|sbcglobal|verizon|earthlink|ymail|mail|gmx|zoho|yandex|rocketmail)\.(com|net|org|me)$/i;

/** A business email on its own domain usually means the website lives there too. */
export function domainFromEmail(email: string | null | undefined): string | null {
  const d = email?.split("@")[1]?.toLowerCase().trim();
  if (!d || !d.includes(".") || FREE_MAIL.test(d)) return null;
  return d;
}

export function guessDomains(name: string, city?: string | null): string[] {
  const norm = normalizeName(name).replace(/\b(llc|inc|co|company)\b/g, "").trim();
  if (!norm) return [];
  const words = norm.split(" ").filter(Boolean);
  const compact = words.join("");
  const hyphen = words.join("-");
  const cityCompact = city ? normalizeName(city).replace(/\s+/g, "") : "";
  const out = new Set<string>();
  if (compact.length >= 4 && compact.length <= 40) {
    out.add(`${compact}.com`);
    if (hyphen !== compact) out.add(`${hyphen}.com`);
    out.add(`${compact}.net`);
    if (cityCompact && compact.length + cityCompact.length <= 40) out.add(`${compact}${cityCompact}.com`);
    // "Longhorn Automotive" → longhornauto.com style shortening.
    const short = words.map((w) => (w === "automotive" ? "auto" : w === "collision" ? "collision" : w)).join("");
    if (short !== compact) out.add(`${short}.com`);
  }
  return [...out];
}

/** Cheap pre-check so unregistered guesses never cost an HTTP fetch. */
export async function resolves(host: string, lookup: (h: string) => Promise<unknown> = (h) => dns.lookup(h)): Promise<boolean> {
  try {
    await lookup(host);
    return true;
  } catch {
    return false;
  }
}

const STREET_ABBR: [RegExp, string][] = [[/\bboulevard\b/g, "blvd"], [/\bstreet\b/g, "st"], [/\broad\b/g, "rd"], [/\bavenue\b/g, "ave"], [/\bdrive\b/g, "dr"], [/\blane\b/g, "ln"], [/\bhighway\b/g, "hwy"], [/\bparkway\b/g, "pkwy"], [/\bnorth\b/g, "n"], [/\bsouth\b/g, "s"], [/\beast\b/g, "e"], [/\bwest\b/g, "w"], [/\bsuite\b/g, "ste"], [/\bfarm to market\b/g, "fm"]];
export function normalizeStreet(s: string): string {
  let out = s.toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, abbr] of STREET_ABBR) out = out.replace(re, abbr);
  return out;
}
/** Street number plus the first street word must both appear (abbreviations normalized). */
export function streetMatches(street: string, hay: string): boolean {
  const n = normalizeStreet(street);
  const m = /^(\d+[a-z]?)\s+([a-z0-9]+)/.exec(n);
  if (!m) return false;
  const h = normalizeStreet(hay);
  return new RegExp(`\\b${m[1]}\\s+${m[2]}\\b`).test(h);
}

function mailDomainOf(email: string | null | undefined, url: string): boolean {
  const d = domainFromEmail(email);
  if (!d) return false;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") === d;
  } catch {
    return false;
  }
}

export interface Verification {
  ok: boolean;
  confidence: number;
  evidence: string;
  finalUrl: string;
}

/** Fetches the homepage and checks it belongs to the business. Never throws. */
export async function verifyCandidate(url: string, biz: FindInput, fetcher = safeFetch): Promise<Verification> {
  try {
    const res = await fetcher(url, { timeoutMs: 8000, maxBytes: 600_000 });
    if (res.status >= 400 || !res.body) return { ok: false, confidence: 0, evidence: `HTTP ${res.status}`, finalUrl: res.finalUrl };
    if (isAggregatorUrl(res.finalUrl)) return { ok: false, confidence: 0, evidence: "redirected to an aggregator/social domain", finalUrl: res.finalUrl };
    const page = extractPage(res.body, res.finalUrl);
    const hay = `${page.title ?? ""}\n${page.metaDescription ?? ""}\n${page.text.slice(0, 6000)}`.toLowerCase();
    const digits = normalizePhone(biz.phone);
    const phoneHit = Boolean(digits && (page.phones.includes(digits) || hay.replace(/\D/g, "").includes(digits)));
    const tokens = nameTokens(biz.name);
    const tokenHits = tokens.filter((t) => hay.includes(t)).length;
    const nameHit = tokens.length > 0 && tokenHits >= Math.max(1, Math.ceil(tokens.length * 0.6));
    const fullName = normalizeName(biz.name);
    const fullNameHit = fullName.length > 5 && normalizeName(hay.slice(0, 8000)).includes(fullName);
    const cityHit = Boolean(biz.city && hay.includes(biz.city.toLowerCase()));
    const regionHit = Boolean(biz.region && new RegExp(`\\b${escapeRe(biz.region.toLowerCase())}\\b`).test(hay));
    const streetHit = Boolean(biz.street && streetMatches(biz.street, hay));
    if (phoneHit && (nameHit || fullNameHit || cityHit)) return { ok: true, confidence: 0.95, evidence: `phone ${digits} and ${fullNameHit || nameHit ? "name" : "city"} found on ${res.finalUrl}`, finalUrl: res.finalUrl };
    if (phoneHit) return { ok: true, confidence: 0.85, evidence: `phone ${digits} found on ${res.finalUrl}`, finalUrl: res.finalUrl };
    if (streetHit && (nameHit || fullNameHit)) return { ok: true, confidence: 0.9, evidence: `street address and name found on ${res.finalUrl}`, finalUrl: res.finalUrl };
    if (fullNameHit && (cityHit || regionHit)) return { ok: true, confidence: 0.8, evidence: `full name and ${cityHit ? "city" : "region"} found on ${res.finalUrl}`, finalUrl: res.finalUrl };
    if (nameHit && cityHit) return { ok: true, confidence: 0.7, evidence: `${tokenHits}/${tokens.length} name words and city found on ${res.finalUrl}`, finalUrl: res.finalUrl };
    if (mailDomainOf(biz.email, res.finalUrl) && (nameHit || fullNameHit)) return { ok: true, confidence: 0.75, evidence: `business email is on this domain and the name appears on ${res.finalUrl}`, finalUrl: res.finalUrl };
    return { ok: false, confidence: nameHit ? 0.4 : 0.1, evidence: nameHit ? "name found but no phone/city/address match" : "no match", finalUrl: res.finalUrl };
  } catch (err) {
    return { ok: false, confidence: 0, evidence: (err as Error).message, finalUrl: url };
  }
}

export async function findWebsite(biz: FindInput, deps: { search?: SearchFn | null; fetcher?: typeof safeFetch; maxVerify?: number; lookup?: (h: string) => Promise<unknown> } = {}): Promise<FindResult | null> {
  const notes: string[] = [];
  const maxVerify = deps.maxVerify ?? 4;
  const tried = new Set<string>();
  const hostOf = (u: string) => {
    try {
      return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return null;
    }
  };

  // 1. Web search.
  const q = `"${biz.name}" ${[biz.city, biz.region].filter(Boolean).join(" ")}`.trim();
  let hits: { url: string; title: string }[] = [];
  try {
    hits = deps.search === null ? [] : await webSearch(q, 8, deps.search ?? undefined);
    if (hits.length) notes.push(`Search returned ${hits.length} result(s) for ${q}`);
    else if (deps.search !== null) notes.push("Search returned no results or no provider is enabled");
  } catch (err) {
    notes.push(`Search failed: ${(err as Error).message}`);
  }
  const candidates: { url: string; source: FindResult["source"] }[] = [];
  // 0. The business's own email domain, when it has one.
  const mailDomain = domainFromEmail(biz.email);
  if (mailDomain) {
    tried.add(mailDomain);
    candidates.push({ url: `https://${mailDomain}/`, source: "found_email" });
  }
  for (const h of hits) {
    const host = hostOf(h.url);
    if (!host || isAggregatorUrl(h.url) || tried.has(host)) continue;
    if (/\.(gov|edu)$/.test(host) || /yellowpages|yelp|bbb\.org|mapquest|manta|chamberofcommerce|angi\.com|thumbtack|carfax|repairpal|autorepair|mechanicadvisor|bizapedia|opencorporates|dnb\.com|zoominfo|superpages|citysearch|foursquare|tripadvisor|indeed|glassdoor|wikipedia/i.test(host)) continue;
    tried.add(host);
    candidates.push({ url: `https://${host}/`, source: "found_search" });
  }
  // 2. Domain guesses (only when phone, street or city is known, otherwise verification cannot be strict enough); DNS pre-check avoids fetching dead names.
  if (biz.phone || biz.city || biz.street) {
    const guesses = guessDomains(biz.name, biz.city).filter((d) => !tried.has(d));
    const alive = await Promise.all(guesses.map(async (d) => ((await resolves(d, deps.lookup)) ? d : null)));
    for (const d of alive) {
      if (!d) continue;
      tried.add(d);
      candidates.push({ url: `https://${d}/`, source: "found_guess" });
    }
    const dead = guesses.filter((d) => !alive.includes(d));
    if (dead.length) notes.push(`guesses without DNS: ${dead.join(", ")}`);
  }
  // Search hits are verified up to the cap; DNS-checked guesses are cheap and always get their turn.
  const toVerify = [...candidates.filter((c) => c.source !== "found_guess").slice(0, maxVerify + 2), ...candidates.filter((c) => c.source === "found_guess").slice(0, 3)];
  const results = await Promise.all(toVerify.map(async (c) => ({ c, v: await verifyCandidate(c.url, biz, deps.fetcher) })));
  for (const { c, v } of results) notes.push(`${c.source === "found_search" ? "search" : c.source === "found_email" ? "email domain" : "guess"} ${c.url}: ${v.ok ? "verified" : "rejected"} (${v.evidence})`);
  const ok = results.filter((r) => r.v.ok && (r.c.source !== "found_guess" || r.v.confidence >= 0.8)).sort((a, b) => b.v.confidence - a.v.confidence)[0];
  if (!ok) return null;
  return { website: ok.v.finalUrl.replace(/\/$/, ""), source: ok.c.source, confidence: ok.v.confidence, evidence: ok.v.evidence, notes };
}
