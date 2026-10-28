/**
 * Deterministic profile facts from fetched pages. Three evidence classes, in
 * order of reliability:
 *  1. Resources the page loads (third-party tool hosts) and declared structured
 *     data (schema.org JSON-LD): precise, cannot be misread.
 *  2. Contact channels (mailto/tel links, forms, social links).
 *  3. Text cues: conservative regexes with the matched sentence as evidence.
 * Every verified fact carries the page URL and the evidence. Fields we looked
 * for and did not find are reported as explicit gaps ("not_found"), which the
 * rule engine and the model treat as hypotheses to validate, never as facts.
 */
import { looksLikeContactForm, type PageContent, type PageKind } from "./html";
import type { FactKey, FactStatus } from "@/lib/profile/fields";
import { snippet } from "./snippet";

export interface DetectedFact {
  key: FactKey;
  status: FactStatus;
  value: string | null;
  evidenceQuote: string | null;
  sourceUrl: string | null;
}

export interface HomeMeasurement {
  finalUrl: string;
  bytes: number;
  ms: number;
}

interface ToolSignature {
  name: string;
  field: "booking_tool" | "shop_management_tool" | "chat_tool" | "review_tool" | "financing_provider" | "marketing_tool" | "website_platform" | "customer_updates";
  hosts: RegExp;
}

export const TOOL_SIGNATURES: ToolSignature[] = [
  { name: "Calendly", field: "booking_tool", hosts: /(^|\.)calendly\.com$/ },
  { name: "Acuity Scheduling", field: "booking_tool", hosts: /acuityscheduling\.com$|squarespacescheduling\.com$/ },
  { name: "Square Appointments", field: "booking_tool", hosts: /square\.site$|squareup\.com$/ },
  { name: "Booksy", field: "booking_tool", hosts: /booksy\.com$/ },
  { name: "Vagaro", field: "booking_tool", hosts: /vagaro\.com$/ },
  { name: "Setmore", field: "booking_tool", hosts: /setmore\.com$/ },
  { name: "SimplyBook", field: "booking_tool", hosts: /simplybook\.(me|it)$/ },
  { name: "AutoOps", field: "booking_tool", hosts: /autoops\.com$/ },
  { name: "Openbay", field: "booking_tool", hosts: /openbay\.com$/ },
  { name: "Shopgenie", field: "booking_tool", hosts: /shopgenie\.(io|com)$/ },
  { name: "Housecall Pro", field: "shop_management_tool", hosts: /housecallpro\.com$/ },
  { name: "Jobber", field: "shop_management_tool", hosts: /getjobber\.com$/ },
  { name: "ServiceTitan", field: "shop_management_tool", hosts: /servicetitan\.com$|schedulingpro\.com$/ },
  { name: "Shopmonkey", field: "shop_management_tool", hosts: /shopmonkey\.(io|cloud)$/ },
  { name: "Tekmetric", field: "shop_management_tool", hosts: /tekmetric\.com$/ },
  { name: "AutoLeap", field: "shop_management_tool", hosts: /autoleap\.com$/ },
  { name: "Shop-Ware", field: "shop_management_tool", hosts: /shop-ware\.com$/ },
  { name: "AutoWatch (online repair status)", field: "customer_updates", hosts: /autowatch\.com$/ },
  { name: "Kukui", field: "marketing_tool", hosts: /kukui\.com$/ },
  { name: "Steer CRM", field: "marketing_tool", hosts: /steercrm\.com$|mechanicnet\.com$/ },
  { name: "RepairPal", field: "marketing_tool", hosts: /repairpal\.com$/ },
  { name: "HubSpot", field: "marketing_tool", hosts: /hubspot\.com$|hsforms\.(com|net)$|hs-scripts\.com$/ },
  { name: "Mailchimp", field: "marketing_tool", hosts: /mailchimp\.com$|list-manage\.com$/ },
  { name: "Tawk.to", field: "chat_tool", hosts: /tawk\.to$/ },
  { name: "Intercom", field: "chat_tool", hosts: /intercom(cdn)?\.(com|io)$/ },
  { name: "Drift", field: "chat_tool", hosts: /drift\.com$/ },
  { name: "Tidio", field: "chat_tool", hosts: /tidio\.co$/ },
  { name: "LiveChat", field: "chat_tool", hosts: /livechatinc\.com$|livechat\.com$/ },
  { name: "Smith.ai", field: "chat_tool", hosts: /smith\.ai$/ },
  { name: "Podium", field: "review_tool", hosts: /podium\.com$/ },
  { name: "Birdeye", field: "review_tool", hosts: /birdeye\.com$/ },
  { name: "NiceJob", field: "review_tool", hosts: /nicejob\.com$/ },
  { name: "Elfsight", field: "review_tool", hosts: /elfsight\.com$/ },
  { name: "Trustindex", field: "review_tool", hosts: /trustindex\.io$/ },
  { name: "Wisetack", field: "financing_provider", hosts: /wisetack\.(com|us)$/ },
  { name: "Sunbit", field: "financing_provider", hosts: /sunbit\.com$/ },
  { name: "Affirm", field: "financing_provider", hosts: /affirm\.com$/ },
  { name: "Synchrony", field: "financing_provider", hosts: /synchrony\.com$|mysynchrony\.com$/ },
  { name: "Snap Finance", field: "financing_provider", hosts: /snapfinance\.com$/ },
  { name: "Wix", field: "website_platform", hosts: /wix\.com$|wixstatic\.com$|parastorage\.com$/ },
  { name: "Squarespace", field: "website_platform", hosts: /squarespace\.com$|squarespace-cdn\.com$/ },
  { name: "GoDaddy Website Builder", field: "website_platform", hosts: /godaddy\.com$|secureserver\.net$|wsimg\.com$/ },
  { name: "Weebly", field: "website_platform", hosts: /weebly\.com$|editmysite\.com$/ },
  { name: "Duda", field: "website_platform", hosts: /duda\.co$|dudaone\.com$|multiscreensite\.com$/ },
  { name: "WordPress", field: "website_platform", hosts: /wp\.com$|wordpress\.com$/ },
];

/** Emails on these domains belong to vendors/widgets, never to the business. */
const VENDOR_EMAIL_DOMAINS = /(^|\.)(autowatch\.com|wixpress\.com|wix\.com|squarespace\.com|godaddy\.com|sentry\.io|example\.com|domain\.com|yourdomain\.com|email\.com|wordpress\.com|w3\.org|schema\.org|googleusercontent\.com|cloudflare\.com)$/i;
const EMAIL_NOISE_RE = /^(noreply|no-reply|donotreply|privacy|abuse|dmca|webmaster|hostmaster|postmaster)@/i;

/** Vendor, widget, placeholder and role addresses never belong to the business (shared by detection and outreach). */
export function isVendorEmail(email: string): boolean {
  return VENDOR_EMAIL_DOMAINS.test(email.split("@")[1] ?? "") || EMAIL_NOISE_RE.test(email);
}

const SOCIAL_RE = /(facebook|instagram|yelp|tiktok|youtube|linkedin|nextdoor)\.com\//i;
const ONLINE_BOOKING_RE = /(book|schedule|request)( an| your| a)? (appointment|service|visit) online|online (booking|scheduling)|book online|schedule online/i;
const CALL_TO_BOOK_RE = /call (us )?(today |now )?to (schedule|book|make an appointment)|schedule by phone|call for (an )?appointment|give us a call to (schedule|book)/i;
const WALK_IN_RE = /walk-?ins? (are )?welcome/i;
const MULTI_LOCATION_RE = /\b(our|all|view|see all|visit any of our|across our)\s+locations\b|\b(find|choose|select)\s+a\s+location\b|\blocation finder\b|\bnearest location\b|\b\d+\s+(convenient\s+)?locations\b/i;

/** Conservative text cues → verified facts with the matched sentence as evidence. */
const TEXT_CUES: { key: FactKey; value: string | ((m: RegExpExecArray) => string); re: RegExp }[] = [
  { key: "customer_updates", value: "text/SMS updates", re: /\b(text (message )?(updates?|you|notifications?)|sms (updates?|notifications?|alerts?)|updates? (by|via) text|we('ll| will) text you|digital (vehicle )?inspection)/i },
  { key: "maintenance_plans", value: "yes", re: /\b(maintenance (plan|program|membership|package)s?|service (plan|membership|agreement)s?|membership program|vip (club|program|membership)|prepaid maintenance)\b/i },
  { key: "fleet_program", value: "yes", re: /\b(fleet (service|services|maintenance|program|accounts?|repair|vehicles|management|customers?)|commercial (accounts?|fleets?)|business accounts?)\b/i },
  { key: "financing", value: "yes", re: /\b(financing (available|options?|offered)|we offer financing|apply for financing|payment plans?|0% (apr|interest)|no interest (for|if paid))\b/i },
  { key: "estimate_policy", value: "free_estimates", re: /\bfree (estimates?|quotes?)\b/i },
  { key: "estimate_policy", value: "diagnostic_fee", re: /\bdiagnostic (fee|charge)\b/i },
  { key: "warranty", value: (m) => m[0], re: /\b(\d{1,2}[- ](month|year)s?(\s*\/\s*|\s*or\s*|\s*,\s*)\d{1,3},?\d{0,3}[- ]mile|lifetime warranty|nationwide warranty|\d{1,2}[- ](month|year) warranty)\b/i },
  { key: "certifications", value: "ASE-certified", re: /\bASE[- ](certified|master)/i },
  { key: "years_in_business", value: (m) => m[0], re: /\b(since (19|20)\d{2}|established (in )?(19|20)\d{2}|est\.? (19|20)\d{2}|(over|more than) \d{1,2} years (in business|of experience|serving))\b/i },
  { key: "reviews_on_site", value: "yes", re: /\b(customer reviews|testimonials|what our customers (say|are saying)|read our reviews|\d{3,}\+? (five|5)[- ]star reviews|google reviews)\b/i },
  { key: "promotions", value: "yes", re: /\b(coupons?|specials?|promotions?|discounts?|save \$\d+|\$\d+ off|% off)\b/i },
  { key: "conveniences", value: (m) => m[0], re: /\b(shuttle service|loaner (cars?|vehicles?)|courtesy (cars?|vehicles?|shuttle)|pick-?up and delivery|after[- ]hours drop[- ]off|night drop|(free )?wi-?fi|waiting (room|area|lounge))\b/i },
  { key: "hours", value: (m) => m[0], re: /\b(mon(day)?|tue(sday)?|m-f|mon-fri|monday ?- ?friday)[^\n]{0,40}\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)[^\n]{0,20}\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)/i },
];

export function pickBusinessEmail(emails: { e: string; url: string }[], siteHost: string | null): { e: string; url: string } | null {
  const host = siteHost?.replace(/^www\./, "").toLowerCase() ?? null;
  const usable = emails.filter(({ e }) => !isVendorEmail(e) && !/\.(png|jpe?g|gif|svg|webp)$/i.test(e));
  if (!usable.length) return null;
  const own = host ? usable.find(({ e }) => e.endsWith(`@${host}`) || e.endsWith(`.${host}`)) : null;
  return own ?? usable[0];
}

export function detectFacts(pages: { content: PageContent; url: string; kind: PageKind }[], home?: HomeMeasurement): DetectedFact[] {
  const out = new Map<FactKey, DetectedFact>();
  const set = (f: DetectedFact) => {
    if (!out.has(f.key)) out.set(f.key, f);
  };
  let siteHost: string | null = null;
  try {
    siteHost = new URL(home?.finalUrl ?? pages[0]?.url ?? "").hostname;
  } catch {
    /* ignore */
  }

  // 1. Tools from resource hosts across all pages (most reliable signal we have).
  const toolsByField = new Map<ToolSignature["field"], { name: string; host: string; url: string }[]>();
  for (const p of pages) {
    for (const host of p.content.resourceHosts) {
      for (const sig of TOOL_SIGNATURES) {
        if (!sig.hosts.test(host)) continue;
        const list = toolsByField.get(sig.field) ?? [];
        if (!list.some((t) => t.name === sig.name)) list.push({ name: sig.name, host, url: p.url });
        toolsByField.set(sig.field, list);
      }
    }
    if (/wp-content\/|wp-includes\//.test(p.content.rawHtmlSample ?? "") && !toolsByField.has("website_platform")) toolsByField.set("website_platform", [{ name: "WordPress", host: "wp-content path", url: p.url }]);
  }
  for (const [field, tools] of toolsByField) {
    set({ key: field, status: "verified", value: tools.map((t) => t.name).join(", "), evidenceQuote: `Resource loaded from ${tools.map((t) => t.host).join(", ")}`, sourceUrl: tools[0].url });
  }
  const gen = pages.find((p) => p.content.generator)?.content.generator;
  if (gen && !out.has("website_platform")) set({ key: "website_platform", status: "verified", value: gen.replace(/\s+\d[\d.]*$/, "").trim(), evidenceQuote: `meta generator: ${gen}`, sourceUrl: pages.find((p) => p.content.generator)!.url });

  // 2. Structured data declared by the site (schema.org).
  const ld = pages.flatMap((p) => p.content.jsonLd.map((j) => ({ j, url: p.url })));
  const ldWith = <K extends keyof PageContent["jsonLd"][number]>(k: K) => ld.find((x) => x.j[k]);
  const ldAddr = ldWith("address");
  if (ldAddr) set({ key: "address", status: "verified", value: ldAddr.j.address, evidenceQuote: `schema.org ${ldAddr.j.type} address`, sourceUrl: ldAddr.url });
  const ldHours = ldWith("openingHours");
  if (ldHours) set({ key: "hours", status: "verified", value: ldHours.j.openingHours, evidenceQuote: `schema.org ${ldHours.j.type} openingHours`, sourceUrl: ldHours.url });
  const ldRating = ld.find((x) => x.j.ratingValue != null);
  if (ldRating) set({ key: "reviews_on_site", status: "verified", value: "yes", evidenceQuote: `schema.org aggregateRating ${ldRating.j.ratingValue}${ldRating.j.reviewCount != null ? ` from ${ldRating.j.reviewCount} reviews` : ""}`, sourceUrl: ldRating.url });

  // 3. Contact channels. Prefer the business's own domain; drop vendor/widget addresses.
  const emails = [...new Set(pages.flatMap((p) => p.content.emails.map((e) => JSON.stringify({ e, url: p.url }))))].map((x) => JSON.parse(x) as { e: string; url: string });
  const email = pickBusinessEmail(emails, siteHost);
  if (email) set({ key: "email", status: "verified", value: email.e, evidenceQuote: email.e, sourceUrl: email.url });
  const phones = pages.flatMap((p) => p.content.phones.map((ph) => ({ ph, url: p.url })));
  if (phones.length) set({ key: "phone", status: "verified", value: phones[0].ph, evidenceQuote: phones[0].ph, sourceUrl: phones[0].url });
  const formPage = pages.find((p) => p.content.forms.some(looksLikeContactForm));
  if (formPage) {
    const f = formPage.content.forms.find(looksLikeContactForm)!;
    set({ key: "contact_form", status: "verified", value: "yes", evidenceQuote: `Form fields: ${f.fields.slice(0, 5).join(", ")}${f.hasTextarea ? " (+ message box)" : ""}`, sourceUrl: formPage.url });
  }
  const socialLinks = [...pages.flatMap((p) => p.content.links.map((l) => l.href)), ...ld.flatMap((x) => x.j.sameAs)];
  const socials = [...new Set(socialLinks.filter((h) => SOCIAL_RE.test(h)).map((h) => h.replace(/\?.*$/, "")))].slice(0, 5);
  if (socials.length) set({ key: "social_profiles", status: "verified", value: socials.join(" "), evidenceQuote: socials.join(" "), sourceUrl: pages[0].url });

  // 4. Text cues (main content only; evidence is the matched sentence).
  const textHit = (re: RegExp) => {
    for (const p of pages) {
      const m = re.exec(p.content.text);
      if (m) return { m, quote: snippet(p.content.text, m.index, m[0].length), url: p.url };
    }
    return null;
  };
  const bookingTool = out.get("booking_tool");
  const online = textHit(ONLINE_BOOKING_RE);
  const call = textHit(CALL_TO_BOOK_RE);
  const walk = textHit(WALK_IN_RE);
  if (bookingTool || online) set({ key: "booking_method", status: "verified", value: call ? "mixed" : "online_booking", evidenceQuote: online?.quote ?? bookingTool!.evidenceQuote, sourceUrl: online?.url ?? bookingTool!.sourceUrl });
  else if (call && formPage) set({ key: "booking_method", status: "verified", value: "mixed", evidenceQuote: call.quote, sourceUrl: call.url });
  else if (call) set({ key: "booking_method", status: "verified", value: walk ? "mixed" : "phone_only", evidenceQuote: call.quote, sourceUrl: call.url });
  else if (walk) set({ key: "booking_method", status: "verified", value: "walk_in", evidenceQuote: walk.quote, sourceUrl: walk.url });
  else if (formPage) set({ key: "booking_method", status: "verified", value: "online_form", evidenceQuote: "Request form present; no booking tool or call-to-book instruction found", sourceUrl: formPage.url });

  for (const cue of TEXT_CUES) {
    if (out.has(cue.key)) continue;
    const hit = textHit(cue.re);
    if (hit) set({ key: cue.key, status: "verified", value: typeof cue.value === "function" ? cue.value(hit.m).trim() : cue.value, evidenceQuote: hit.quote, sourceUrl: hit.url });
  }
  const multi = textHit(MULTI_LOCATION_RE);
  if (multi || ld.filter((x) => x.j.address).map((x) => x.j.address).filter((a, i, arr) => arr.indexOf(a) === i).length > 1) set({ key: "multi_location", status: "verified", value: "yes", evidenceQuote: multi?.quote ?? "Several distinct addresses in structured data", sourceUrl: multi?.url ?? pages[0].url });

  // 5. Summary in their own words: the homepage meta description, when it is a real sentence.
  const homePage = pages.find((p) => p.kind === "home") ?? pages[0];
  const desc = homePage?.content.metaDescription?.replace(/\s+/g, " ").trim();
  if (desc && desc.length >= 40 && desc.length <= 400 && /[a-z]{3,}\s+[a-z]{3,}/i.test(desc)) set({ key: "summary", status: "verified", value: desc, evidenceQuote: "Site meta description", sourceUrl: homePage.url });

  // 6. Measured site health and freshness.
  if (home) {
    const https = home.finalUrl.startsWith("https://");
    const viewport = pages.some((p) => p.content.hasViewport);
    const parts = [https ? "HTTPS" : "no HTTPS", viewport ? "mobile viewport" : "no mobile viewport", `homepage ${Math.round(home.bytes / 1024)} KB in ${(home.ms / 1000).toFixed(1)} s`];
    set({ key: "website_health", status: "verified", value: parts.join("; "), evidenceQuote: "Measured while fetching the homepage", sourceUrl: home.finalUrl });
  }
  const years = pages.map((p) => ({ y: p.content.latestYear, url: p.url })).filter((x) => x.y);
  if (years.length) {
    const best = years.reduce((a, b) => (b.y! > a.y! ? b : a));
    set({ key: "website_updated", status: "verified", value: String(best.y), evidenceQuote: `Latest copyright/dated-content year found: ${best.y}`, sourceUrl: best.url });
  }

  // 7. Explicit "not found" for fields we actively looked for: a gap signal, not a guess.
  for (const key of ["booking_tool", "chat_tool", "review_tool", "shop_management_tool", "financing_provider", "contact_form", "email", "customer_updates", "maintenance_plans", "fleet_program", "financing", "reviews_on_site", "estimate_policy", "multi_location"] as FactKey[]) {
    if (!out.has(key)) set({ key, status: "not_found", value: null, evidenceQuote: `Not detected across ${pages.length} fetched page(s)`, sourceUrl: null });
  }
  return [...out.values()];
}
