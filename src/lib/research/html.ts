/**
 * HTML -> structured page content. Website content is untrusted data: we only
 * extract text, links, resource hostnames and declared structured data;
 * nothing is ever executed.
 *
 * Text is taken from the main content (navigation, header, footer and sidebars
 * stripped) so quotes and cues come from what the business actually says, not
 * from menus. When a page is nothing but chrome, the full body text is used.
 */
import * as cheerio from "cheerio";

export interface JsonLdBusiness {
  type: string;
  name: string | null;
  telephone: string | null;
  email: string | null;
  address: string | null;
  openingHours: string | null;
  priceRange: string | null;
  sameAs: string[];
  ratingValue: number | null;
  reviewCount: number | null;
}

export interface PageContent {
  title: string | null;
  metaDescription: string | null;
  text: string;
  links: { href: string; text: string }[];
  emails: string[];
  phones: string[];
  resourceHosts: string[]; // script/iframe/link hosts, for tool detection
  forms: { action: string | null; fields: string[]; hasTextarea: boolean }[];
  hasChatWidget: boolean;
  /** schema.org LocalBusiness-like objects declared by the page (JSON-LD). */
  jsonLd: JsonLdBusiness[];
  /** <meta name="generator"> (WordPress 6.x, Wix.com Website Builder, ...). */
  generator: string | null;
  /** Mobile viewport meta present. */
  hasViewport: boolean;
  /** Latest year found next to a copyright mark or in dated content. */
  latestYear: number | null;
  /** First 4000 chars of raw HTML, for platform fingerprints (never shown to the model). */
  rawHtmlSample?: string;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Elements whose text continues the surrounding word; every other element gets whitespace around its text. */
const INLINE_FORMAT_TAGS = new Set(["b", "i", "strong", "em", "u", "s", "sup", "sub", "small", "mark", "abbr", "code", "wbr", "font"]);
const MAX_TEXT_CHARS = 40_000;

/** Digits only; US numbers lose the leading country code so variants dedupe. */
export function normalizeTel(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

const CONTACT_FIELD_RE = /name|email|e-mail|phone|tel|message|comment|subject|company|inquiry|enquiry|vehicle|zip/i;
const SEARCH_FIELD_RE = /^(s|q|query|search|keyword|keywords)$/i;

/** A real contact/request form: several non-search fields, or a textarea. */
export function looksLikeContactForm(form: { fields: string[]; hasTextarea: boolean; action: string | null }): boolean {
  const fields = form.fields.filter((f) => !SEARCH_FIELD_RE.test(f.trim()));
  if (form.hasTextarea) return true;
  if (fields.length < 2) return false;
  return fields.some((f) => CONTACT_FIELD_RE.test(f)) || /contact|quote|appointment|request|gform|wpcf7|formspree/i.test(form.action ?? "");
}

const BUSINESS_TYPES = /business|store|organization|dentist|physician|medicalbusiness|automotivebusiness|autorepair|homeandconstructionbusiness|plumber|electrician|hvacbusiness|localbusiness|professionalservice|service/i;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function flattenJsonLd(node: unknown, out: Record<string, unknown>[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) flattenJsonLd(n, out);
    return;
  }
  const o = node as Record<string, unknown>;
  if (o["@type"]) out.push(o);
  if (o["@graph"]) flattenJsonLd(o["@graph"], out);
}

function addressToString(a: unknown): string | null {
  if (!a) return null;
  if (typeof a === "string") return a.trim() || null;
  if (typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const parts = [o.streetAddress, o.addressLocality, o.addressRegion, o.postalCode].filter((x) => typeof x === "string" && x.trim()).map((x) => String(x).trim());
  return parts.length ? parts.join(", ") : null;
}

function hoursToString(o: Record<string, unknown>): string | null {
  const oh = asArray(o.openingHours as string | string[] | undefined).filter((x) => typeof x === "string");
  if (oh.length) return oh.join("; ");
  const spec = asArray(o.openingHoursSpecification as Record<string, unknown>[] | undefined);
  const lines = spec
    .map((s) => {
      const days = asArray(s.dayOfWeek as string | string[] | undefined).map((d) => String(d).replace(/^https?:\/\/schema\.org\//, "").slice(0, 3));
      if (!days.length || !s.opens || !s.closes) return null;
      return `${days.join(",")} ${s.opens}-${s.closes}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join("; ") : null;
}

export function parseJsonLd($: cheerio.CheerioAPI): JsonLdBusiness[] {
  const found: JsonLdBusiness[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw || raw.length > 200_000) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const nodes: Record<string, unknown>[] = [];
    flattenJsonLd(parsed, nodes);
    for (const o of nodes) {
      const type = asArray(o["@type"] as string | string[]).map(String).join("/");
      if (!BUSINESS_TYPES.test(type)) continue;
      const rating = (o.aggregateRating ?? null) as Record<string, unknown> | null;
      found.push({
        type,
        name: typeof o.name === "string" ? o.name.trim() : null,
        telephone: typeof o.telephone === "string" ? o.telephone.trim() : null,
        email: typeof o.email === "string" ? o.email.replace(/^mailto:/i, "").trim().toLowerCase() : null,
        address: addressToString(o.address),
        openingHours: hoursToString(o),
        priceRange: typeof o.priceRange === "string" ? o.priceRange.trim() : null,
        sameAs: asArray(o.sameAs as string | string[] | undefined).filter((x) => typeof x === "string"),
        ratingValue: rating && rating.ratingValue != null && Number.isFinite(Number(rating.ratingValue)) ? Number(rating.ratingValue) : null,
        reviewCount: rating && (rating.reviewCount ?? rating.ratingCount) != null && Number.isFinite(Number(rating.reviewCount ?? rating.ratingCount)) ? Number(rating.reviewCount ?? rating.ratingCount) : null,
      });
    }
  });
  return found;
}

function cleanText(raw: string) {
  return raw
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const YEAR_RE = /\b(19[89]\d|20[0-4]\d)\b/g;

export function latestYearIn(text: string, html: string): number | null {
  const now = new Date().getFullYear();
  const years: number[] = [];
  // Copyright lines are the most reliable "still maintained" marker.
  for (const m of text.matchAll(/(?:©|&copy;|\(c\)|copyright)\s*(?:[^\n]{0,40}?)(\b(?:19[89]\d|20[0-4]\d)\b)(?:\s*[-–]\s*(\b(?:19[89]\d|20[0-4]\d)\b))?/gi)) {
    for (const y of [m[1], m[2]]) if (y) years.push(Number(y));
  }
  // <time datetime="2024-05-01"> on blog posts / updates.
  for (const m of html.matchAll(/datetime="(\d{4})-\d{2}-\d{2}/g)) years.push(Number(m[1]));
  const valid = years.filter((y) => y >= 1990 && y <= now + 1);
  return valid.length ? Math.max(...valid) : null;
}

export function extractPage(html: string, baseUrl: string): PageContent {
  const $ = cheerio.load(html);
  const resourceHosts = new Set<string>();
  const collectHost = (src: string | undefined) => {
    if (!src) return;
    try {
      const h = new URL(src, baseUrl).hostname.toLowerCase();
      if (h) resourceHosts.add(h);
    } catch {
      /* ignore */
    }
  };
  $("script[src]").each((_, el) => collectHost($(el).attr("src")));
  $("iframe[src]").each((_, el) => collectHost($(el).attr("src")));
  $("link[href]").each((_, el) => collectHost($(el).attr("href")));
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/^https?:/i.test(href)) collectHost(href);
  });

  const title = $("title").first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const generator = $('meta[name="generator"]').attr("content")?.trim() || null;
  const hasViewport = $('meta[name="viewport"]').length > 0;
  const jsonLd = parseJsonLd($);

  const links: { href: string; text: string }[] = [];
  const emails = new Set<string>();
  const phones = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 120);
    if (href.toLowerCase().startsWith("mailto:")) {
      const m = href.slice(7).split("?")[0].trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) emails.add(m);
      return;
    }
    if (href.toLowerCase().startsWith("tel:")) {
      const p = normalizeTel(href.slice(4));
      if (p) phones.add(p);
      return;
    }
    try {
      const abs = new URL(href, baseUrl);
      if (abs.protocol === "http:" || abs.protocol === "https:") {
        abs.hash = "";
        links.push({ href: abs.toString(), text });
      }
    } catch {
      /* ignore */
    }
  });

  const forms: PageContent["forms"] = [];
  $("form").each((_, el) => {
    const fields: string[] = [];
    let hasTextarea = false;
    $(el)
      .find("input,select,textarea")
      .each((_, f) => {
        const type = ($(f).attr("type") ?? "").toLowerCase();
        if (["hidden", "submit", "button", "reset", "image"].includes(type)) return;
        if (f.tagName?.toLowerCase() === "textarea") hasTextarea = true;
        const name = $(f).attr("name") || $(f).attr("placeholder") || $(f).attr("aria-label") || type;
        if (name) fields.push(name.slice(0, 40));
      });
    forms.push({ action: $(el).attr("action") ?? null, fields, hasTextarea });
  });

  $("script,style,noscript,svg,iframe,template").remove();
  // `.text()` joins text nodes with nothing in between, so "<p>312-2177</p><span>info@x.com</span>" would read
  // "312-2177info@x.com". Separate elements with whitespace (line breaks for <br>), except pure inline formatting.
  $("br").replaceWith("\n");
  $("body *").each((_, el) => {
    if (INLINE_FORMAT_TAGS.has(el.tagName?.toLowerCase() ?? "")) return;
    $(el).before(" ").after(" ");
  });
  const fullText = cleanText($("body").text());
  // Main content: drop site chrome. Fall back to the full text when a page is mostly chrome.
  $("nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],.nav,.navbar,.menu,.site-header,.site-footer,#header,#footer,#nav,#menu,.cookie,.cookies").remove();
  const mainText = cleanText(($("main").text().trim() ? $("main") : $("body")).text());
  const text = (mainText.length >= Math.min(300, fullText.length * 0.3) ? mainText : fullText).slice(0, MAX_TEXT_CHARS);

  for (const m of fullText.match(EMAIL_RE) ?? []) {
    // Backstop for text that runs together inside one node ("Tel 312-2177info@x.com"): a local part that
    // begins like a phone number has that number stripped; mailto: links were collected above.
    const [local, domain] = m.split("@");
    const cleaned = `${local.replace(/^\d{3}[-.]\d{4}/, "")}@${domain}`;
    if (!cleaned.startsWith("@") && local.length <= 64) emails.add(cleaned.toLowerCase());
  }
  for (const j of jsonLd) {
    if (j.email) emails.add(j.email);
    const p = j.telephone ? normalizeTel(j.telephone) : null;
    if (p) phones.add(p);
  }
  const hasChatWidget = [...resourceHosts].some((h) => /tawk\.to|intercom|drift\.com|livechat|tidio|podium|birdeye|hubspot|crisp\.chat|zendesk|smith\.ai/.test(h));

  return { title, metaDescription, text, links, emails: [...emails], phones: [...phones], resourceHosts: [...resourceHosts], forms, hasChatWidget, jsonLd, generator, hasViewport, latestYear: latestYearIn(fullText, html), rawHtmlSample: html.slice(0, 4000) };
}

export type PageKind = "home" | "about" | "services" | "contact" | "pricing" | "booking" | "faq" | "fleet" | "financing" | "reviews" | "other";

const KIND_PATTERNS: [PageKind, RegExp][] = [
  ["booking", /book|schedule|appointment|request-service|request-an-appointment|reserve/i],
  ["services", /service|repair|what-we-do|maintenance|specialt/i],
  ["pricing", /pric|rates|cost|coupon|special|offer|promotion/i],
  ["contact", /contact|location|hours|directions|find-us/i],
  ["about", /about|our-story|team|staff|why-us|history/i],
  ["faq", /faq|question/i],
  ["fleet", /fleet|commercial|business-account/i],
  ["financing", /financ|payment-plan|credit/i],
  ["reviews", /review|testimonial/i],
];

export function classifyLink(href: string, text: string): PageKind {
  const hay = `${href} ${text}`;
  for (const [kind, re] of KIND_PATTERNS) if (re.test(hay)) return kind;
  return "other";
}

/** Priority used when choosing which internal links to crawl after the homepage. */
export const KIND_PRIORITY: Record<PageKind, number> = {
  home: 0,
  services: 1,
  booking: 2,
  about: 3,
  contact: 4,
  pricing: 5,
  fleet: 6,
  financing: 7,
  faq: 8,
  reviews: 9,
  other: 10,
};
