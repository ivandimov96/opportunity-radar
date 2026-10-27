/**
 * Deterministic detectors that turn page content into VERIFIED observations
 * with evidence. No AI involved; each detector cites the page URL and the
 * exact matched text or resource host.
 */
import { looksLikeContactForm, type PageContent, type PageKind } from "./html";

export interface DetectedObservation {
  category: string;
  statement: string;
  evidenceQuote: string;
  sourceUrl: string;
  confidence: number;
}

interface ToolSignature {
  name: string;
  kind: "booking" | "shop_management" | "chat" | "reviews" | "financing" | "forms" | "cms" | "marketing";
  hosts: RegExp;
}

export const TOOL_SIGNATURES: ToolSignature[] = [
  { name: "Calendly", kind: "booking", hosts: /(^|\.)calendly\.com$/ },
  { name: "Acuity Scheduling", kind: "booking", hosts: /acuityscheduling\.com$|squarespacescheduling\.com$/ },
  { name: "Square Appointments", kind: "booking", hosts: /square\.site$|squareup\.com$/ },
  { name: "Booksy", kind: "booking", hosts: /booksy\.com$/ },
  { name: "Vagaro", kind: "booking", hosts: /vagaro\.com$/ },
  { name: "Setmore", kind: "booking", hosts: /setmore\.com$/ },
  { name: "SimplyBook", kind: "booking", hosts: /simplybook\.(me|it)$/ },
  { name: "Housecall Pro", kind: "booking", hosts: /housecallpro\.com$/ },
  { name: "Jobber", kind: "booking", hosts: /getjobber\.com$/ },
  { name: "ServiceTitan", kind: "booking", hosts: /servicetitan\.com$|schedulingpro\.com$/ },
  { name: "Shopmonkey", kind: "shop_management", hosts: /shopmonkey\.(io|cloud)$/ },
  { name: "Tekmetric", kind: "shop_management", hosts: /tekmetric\.com$/ },
  { name: "AutoLeap", kind: "shop_management", hosts: /autoleap\.com$/ },
  { name: "Shop-Ware", kind: "shop_management", hosts: /shop-ware\.com$/ },
  { name: "Kukui", kind: "marketing", hosts: /kukui\.com$/ },
  { name: "Steer CRM", kind: "marketing", hosts: /steercrm\.com$|mechanicnet\.com$/ },
  { name: "AutoOps", kind: "booking", hosts: /autoops\.com$/ },
  { name: "RepairPal", kind: "marketing", hosts: /repairpal\.com$/ },
  { name: "Openbay", kind: "booking", hosts: /openbay\.com$/ },
  { name: "Tawk.to chat", kind: "chat", hosts: /tawk\.to$/ },
  { name: "Intercom", kind: "chat", hosts: /intercom(cdn)?\.(com|io)$/ },
  { name: "Drift", kind: "chat", hosts: /drift\.com$/ },
  { name: "Tidio", kind: "chat", hosts: /tidio\.co$/ },
  { name: "LiveChat", kind: "chat", hosts: /livechatinc\.com$|livechat\.com$/ },
  { name: "Podium", kind: "reviews", hosts: /podium\.com$/ },
  { name: "Birdeye", kind: "reviews", hosts: /birdeye\.com$/ },
  { name: "NiceJob", kind: "reviews", hosts: /nicejob\.com$/ },
  { name: "Elfsight widgets", kind: "reviews", hosts: /elfsight\.com$/ },
  { name: "Trustindex", kind: "reviews", hosts: /trustindex\.io$/ },
  { name: "Wisetack financing", kind: "financing", hosts: /wisetack\.(com|us)$/ },
  { name: "Sunbit financing", kind: "financing", hosts: /sunbit\.com$/ },
  { name: "Affirm", kind: "financing", hosts: /affirm\.com$/ },
  { name: "Synchrony Car Care", kind: "financing", hosts: /synchrony\.com$|mysynchrony\.com$/ },
  { name: "Snap Finance", kind: "financing", hosts: /snapfinance\.com$/ },
  { name: "JotForm", kind: "forms", hosts: /jotform\.com$/ },
  { name: "Typeform", kind: "forms", hosts: /typeform\.com$/ },
  { name: "HubSpot", kind: "marketing", hosts: /hubspot\.com$|hsforms\.(com|net)$|hs-scripts\.com$/ },
  { name: "Wix", kind: "cms", hosts: /wix\.com$|wixstatic\.com$|parastorage\.com$/ },
  { name: "Squarespace", kind: "cms", hosts: /squarespace\.com$|squarespace-cdn\.com$/ },
  { name: "GoDaddy Website Builder", kind: "cms", hosts: /godaddy\.com$|secureserver\.net$|img1\.wsimg\.com$|wsimg\.com$/ },
  { name: "Weebly", kind: "cms", hosts: /weebly\.com$|editmysite\.com$/ },
  { name: "Duda", kind: "cms", hosts: /duda\.co$|dudaone\.com$|multiscreensite\.com$/ },
];

const TEXT_CUES: { category: string; statement: string; re: RegExp; confidence?: number }[] = [
  { category: "booking", statement: "Website asks customers to call to schedule service", re: /call (us )?(today |now )?to (schedule|book|make an appointment)|schedule by phone|call for (an )?appointment/i },
  { category: "booking", statement: "Website advertises walk-ins", re: /walk-?ins? (are )?welcome/i },
  { category: "booking", statement: "Website offers online appointment requests or booking", re: /(book|schedule|request)( an| your| a)? (appointment|service) online|online (booking|scheduling)|book online/i },
  { category: "pricing", statement: "Website advertises free estimates or quotes", re: /free (estimate|quote)s?/i },
  { category: "pricing", statement: "Website mentions coupons or specials", re: /coupon|special offer|monthly special|current specials/i },
  { category: "payments", statement: "Website mentions financing options", re: /financing (available|options)|pay over time|payment plans?/i },
  { category: "services", statement: "Website mentions fleet or commercial accounts", re: /fleet (service|account|maintenance|repair)s?|commercial accounts?/i },
  { category: "services", statement: "Website mentions a warranty on work", re: /\d+[-\s]?(month|year|mile)[^.]{0,40}warranty|nationwide warranty|warranty on (all )?(parts|repairs|work)/i },
  { category: "services", statement: "Website mentions ASE certification", re: /ASE[-\s]?certified/i },
  { category: "services", statement: "Website mentions digital vehicle inspections", re: /digital (vehicle )?inspection|DVI\b/i },
  { category: "customers", statement: "Website mentions text/SMS updates to customers", re: /text (message )?(updates|you|notifications)|sms (updates|notifications)|via text/i },
  { category: "services", statement: "Website mentions emergency or 24/7 service", re: /24\/7|24 hours|emergency service/i },
  { category: "services", statement: "Website mentions maintenance plans or service agreements", re: /maintenance (plan|agreement|membership|program)|service agreement|membership plan/i },
  { category: "customers", statement: "Website mentions a customer or fleet portal / account login", re: /customer portal|client portal|account login|my account|log ?in to your account/i },
  { category: "reviews", statement: "Website displays customer reviews or testimonials", re: /testimonials?|customer reviews|what our customers say|★|5-star/i, confidence: 0.8 },
  { category: "services", statement: "Website mentions shuttle, loaner, or pickup service", re: /shuttle|loaner|pick-?up and delivery|courtesy (car|vehicle)/i },
  { category: "hours", statement: "Website lists business hours", re: /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*[-–:]\s*(\d|closed)/i, confidence: 0.8 },
];

/** Evidence snippet: starts at the nearest sentence/word boundary before the match and always contains the match. */
export function snippet(text: string, index: number, matchLength: number, before = 60, after = 110) {
  let start = Math.max(0, index - before);
  const sentence = Math.max(text.lastIndexOf(". ", index), text.lastIndexOf(".\n", index));
  if (sentence >= start && sentence < index) start = sentence + 2;
  else if (start > 0) {
    const ws = text.slice(start, index).search(/\s/);
    if (ws !== -1) start = start + ws + 1;
  }
  let end = Math.min(text.length, index + matchLength + after);
  if (end < text.length) {
    const tail = text.slice(index + matchLength, end);
    const lastWs = Math.max(tail.lastIndexOf(" "), tail.lastIndexOf("\n"));
    if (lastWs > 0) end = index + matchLength + lastWs;
  }
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function detectSignals(page: PageContent, url: string, kind: PageKind): DetectedObservation[] {
  const out: DetectedObservation[] = [];
  const seenTools = new Set<string>();
  for (const host of page.resourceHosts) {
    for (const sig of TOOL_SIGNATURES) {
      if (sig.hosts.test(host) && !seenTools.has(sig.name)) {
        seenTools.add(sig.name);
        const what = { booking: "online booking/scheduling tool", shop_management: "shop management software", chat: "website chat widget", reviews: "review/reputation widget", financing: "consumer financing provider", forms: "third-party form builder", cms: "website builder/CMS", marketing: "marketing/CRM platform" }[sig.kind];
        out.push({ category: "tools", statement: `Website integrates ${sig.name} (${what})`, evidenceQuote: `Resource loaded from ${host}`, sourceUrl: url, confidence: 0.95 });
      }
    }
  }
  for (const cue of TEXT_CUES) {
    const m = cue.re.exec(page.text);
    if (m) out.push({ category: cue.category, statement: cue.statement, evidenceQuote: snippet(page.text, m.index, m[0].length), sourceUrl: url, confidence: cue.confidence ?? 0.9 });
  }
  const contactForm = page.forms.find(looksLikeContactForm);
  if (contactForm) {
    out.push({ category: "contact", statement: "Website has a contact/request form", evidenceQuote: `Form fields: ${contactForm.fields.slice(0, 6).join(", ")}${contactForm.hasTextarea ? " (+ message box)" : ""}`, sourceUrl: url, confidence: 0.9 });
  }
  if (page.hasChatWidget && !out.some((o) => o.statement.includes("chat widget"))) {
    out.push({ category: "tools", statement: "Website has a live chat widget", evidenceQuote: "Chat widget resource detected", sourceUrl: url, confidence: 0.85 });
  }
  for (const e of page.emails) out.push({ category: "contact", statement: `Public email address listed: ${e}`, evidenceQuote: e, sourceUrl: url, confidence: 1 });
  for (const p of page.phones) out.push({ category: "contact", statement: `Public phone number listed: ${p}`, evidenceQuote: p, sourceUrl: url, confidence: 1 });
  if (kind === "booking") out.push({ category: "booking", statement: "Website has a dedicated booking/appointment page", evidenceQuote: url, sourceUrl: url, confidence: 0.85 });
  if (kind === "pricing") out.push({ category: "pricing", statement: "Website has a pricing/specials page", evidenceQuote: url, sourceUrl: url, confidence: 0.85 });
  if (kind === "fleet") out.push({ category: "services", statement: "Website has a fleet/commercial page", evidenceQuote: url, sourceUrl: url, confidence: 0.85 });
  return out;
}
