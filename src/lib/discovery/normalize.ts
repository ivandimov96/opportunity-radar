/**
 * Normalization helpers shared by all providers and the deduplication step.
 * These are deterministic and heavily unit-tested; they never invent data.
 */

const LEGAL_SUFFIXES = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|pllc|plc|gmbh)\b\.?/gi;
const NOISE_WORDS = /\b(the|and|&|of)\b/gi;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’"]/g, "")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(NOISE_WORDS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Returns a canonical https URL or null when the value is not a usable website. */
export function normalizeWebsite(input: string | null | undefined): string | null {
  if (!input) return null;
  let v = input.trim();
  if (!v) return null;
  if (v.startsWith("mailto:") || v.startsWith("tel:")) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    // Drop tracking params; keep meaningful paths (some businesses live on subpaths).
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid|^gclid/i.test(k)) u.searchParams.delete(k);
    let s = u.toString();
    if (s.endsWith("/") && u.pathname === "/") s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

const AGGREGATOR_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "yelp.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "google.com",
  "goo.gl",
  "maps.app.goo.gl",
  "nextdoor.com",
  "tiktok.com",
  "youtube.com",
  "business.site",
];

/** Domain used for deduplication; social/aggregator domains do not count as identity. */
export function websiteDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const host = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
    if (AGGREGATOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return null;
    return host;
  } catch {
    return null;
  }
}

export function isAggregatorUrl(website: string | null | undefined): boolean {
  if (!website) return false;
  try {
    const host = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
    return AGGREGATOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** Normalize phone to digits (keeps leading + for international). */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 7) return null;
  // US numbers: strip leading 1 / +1 for comparison stability.
  const d = digits.replace(/^\+?1(?=\d{10}$)/, "");
  return d;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().toLowerCase().replace(/^mailto:/, "");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export function normalizeCity(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().toLowerCase().replace(/\s+/g, " ");
  return v || null;
}
