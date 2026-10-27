/**
 * HTML -> structured page content. Website content is untrusted data: we only
 * extract text, links and resource hostnames; nothing is ever executed.
 */
import * as cheerio from "cheerio";

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
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

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
  const text = $("body")
    .text()
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  for (const m of text.match(EMAIL_RE) ?? []) emails.add(m.toLowerCase());
  const hasChatWidget = [...resourceHosts].some((h) => /tawk\.to|intercom|drift\.com|livechat|tidio|podium|birdeye|hubspot|crisp\.chat|zendesk|smith\.ai/.test(h));

  return { title, metaDescription, text, links, emails: [...emails], phones: [...phones], resourceHosts: [...resourceHosts], forms, hasChatWidget };
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
