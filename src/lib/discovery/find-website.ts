/**
 * Website finder for businesses discovered without a URL (the most common gap
 * in map data). Two sources, both verified before anything is stored:
 *  1. Web search: "<name>" <city> <region>, aggregator/social domains dropped.
 *  2. Domain guesses built from the name (compact and hyphenated, .com/.net),
 *     DNS-checked so unregistered names cost nothing.
 * Verification reads the candidate homepage through Firecrawl (one credit per
 * candidate, so candidates are checked in order and the first verified one
 * wins) and requires the business phone (strongest) or the name plus the
 * city/region on the page. A guess that only matches the name is rejected:
 * many similarly named shops exist elsewhere.
 */
import dns from "node:dns/promises";
import { normalizeName, isAggregatorUrl } from "./normalize";
import { normalizePhone } from "./normalize";
import { FirecrawlCreditsError, scrapePage, type ScrapeFn } from "@/lib/research/firecrawl";
import { extractPage } from "@/lib/research/html";
import { webSearch, type SearchFn } from "@/lib/search";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
}

export interface FindOutcome {
  found: FindResult | null;
  notes: string[];
  /** Firecrawl credits spent on verification. */
  credits: number;
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

/** Cheap pre-check so unregistered guesses never cost a credit. */
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
  credits: number;
}

/** Reads the homepage through Firecrawl and checks it belongs to the business. Never throws, except when credits are exhausted. */
export async function verifyCandidate(url: string, biz: FindInput, scrape: ScrapeFn = scrapePage, signal?: AbortSignal): Promise<Verification> {
  try {
    const res = await scrape(url, { signal, timeoutMs: 20_000 });
    if (res.error || !res.rawHtml) return { ok: false, confidence: 0, evidence: res.error ?? "empty page", finalUrl: res.finalUrl, credits: res.credits };
    if (isAggregatorUrl(res.finalUrl)) return { ok: false, confidence: 0, evidence: "redirected to an aggregator/social domain", finalUrl: res.finalUrl, credits: res.credits };
    const page = extractPage(res.rawHtml, res.finalUrl);
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
    const ok = (confidence: number, evidence: string): Verification => ({ ok: true, confidence, evidence, finalUrl: res.finalUrl, credits: res.credits });
    if (phoneHit && (nameHit || fullNameHit || cityHit)) return ok(0.95, `phone ${digits} and ${fullNameHit || nameHit ? "name" : "city"} found on ${res.finalUrl}`);
    if (phoneHit) return ok(0.85, `phone ${digits} found on ${res.finalUrl}`);
    if (streetHit && (nameHit || fullNameHit)) return ok(0.9, `street address and name found on ${res.finalUrl}`);
    if (fullNameHit && (cityHit || regionHit)) return ok(0.8, `full name and ${cityHit ? "city" : "region"} found on ${res.finalUrl}`);
    if (nameHit && cityHit) return ok(0.7, `${tokenHits}/${tokens.length} name words and city found on ${res.finalUrl}`);
    if (mailDomainOf(biz.email, res.finalUrl) && (nameHit || fullNameHit)) return ok(0.75, `business email is on this domain and the name appears on ${res.finalUrl}`);
    return { ok: false, confidence: nameHit ? 0.4 : 0.1, evidence: nameHit ? "name found but no phone/city/address match" : "no match", finalUrl: res.finalUrl, credits: res.credits };
  } catch (err) {
    if (err instanceof FirecrawlCreditsError || signal?.aborted) throw err;
    return { ok: false, confidence: 0, evidence: (err as Error).message, finalUrl: url, credits: 0 };
  }
}

export interface FindDeps {
  search?: SearchFn | null;
  scrape?: ScrapeFn;
  maxVerify?: number;
  lookup?: (h: string) => Promise<unknown>;
  signal?: AbortSignal;
}

export async function findWebsite(biz: FindInput, deps: FindDeps = {}): Promise<FindOutcome> {
  const notes: string[] = [];
  const maxVerify = deps.maxVerify ?? 4;
  const tried = new Set<string>();
  let credits = 0;
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
  // 2. Domain guesses (only when phone, street or city is known, otherwise verification cannot be strict enough); DNS pre-check avoids paying for dead names.
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
  // Search hits are checked up to the cap, then DNS-checked guesses; one credit each, in order, first verified wins.
  const toVerify = [...candidates.filter((c) => c.source !== "found_guess").slice(0, maxVerify + 2), ...candidates.filter((c) => c.source === "found_guess").slice(0, 3)];
  for (const c of toVerify) {
    const v = await verifyCandidate(c.url, biz, deps.scrape, deps.signal);
    credits += v.credits;
    notes.push(`${c.source === "found_search" ? "search" : c.source === "found_email" ? "email domain" : "guess"} ${c.url}: ${v.ok ? "verified" : "rejected"} (${v.evidence})`);
    if (v.ok && (c.source !== "found_guess" || v.confidence >= 0.8)) {
      return { found: { website: v.finalUrl.replace(/\/$/, ""), source: c.source, confidence: v.confidence, evidence: v.evidence }, notes, credits };
    }
  }
  return { found: null, notes, credits };
}
