/**
 * Deterministic profile facts from fetched pages: third-party tools from
 * resource hosts, contact channels, booking method, and a few reliable text
 * signals. Each verified fact carries the page URL and the matched evidence.
 * Everything here is cheap, offline, and precise; the model fills the rest.
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

interface ToolSignature {
  name: string;
  field: "booking_tool" | "shop_management_tool" | "chat_tool" | "review_tool" | "financing_provider" | "marketing_tool" | "website_platform";
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
  { name: "Housecall Pro", field: "shop_management_tool", hosts: /housecallpro\.com$/ },
  { name: "Jobber", field: "shop_management_tool", hosts: /getjobber\.com$/ },
  { name: "ServiceTitan", field: "shop_management_tool", hosts: /servicetitan\.com$|schedulingpro\.com$/ },
  { name: "Shopmonkey", field: "shop_management_tool", hosts: /shopmonkey\.(io|cloud)$/ },
  { name: "Tekmetric", field: "shop_management_tool", hosts: /tekmetric\.com$/ },
  { name: "AutoLeap", field: "shop_management_tool", hosts: /autoleap\.com$/ },
  { name: "Shop-Ware", field: "shop_management_tool", hosts: /shop-ware\.com$/ },
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

const SOCIAL_RE = /(facebook|instagram|yelp|tiktok|youtube|linkedin|nextdoor)\.com\//i;
const ONLINE_BOOKING_RE = /(book|schedule|request)( an| your| a)? (appointment|service|visit) online|online (booking|scheduling)|book online|schedule online/i;
const CALL_TO_BOOK_RE = /call (us )?(today |now )?to (schedule|book|make an appointment)|schedule by phone|call for (an )?appointment|give us a call to (schedule|book)/i;
const WALK_IN_RE = /walk-?ins? (are )?welcome/i;

export function detectFacts(pages: { content: PageContent; url: string; kind: PageKind }[]): DetectedFact[] {
  const out = new Map<FactKey, DetectedFact>();
  const set = (f: DetectedFact) => {
    if (!out.has(f.key)) out.set(f.key, f);
  };

  // Tools from resource hosts across all pages (most reliable signal we have).
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

  // Contact channels.
  const emails = [...new Set(pages.flatMap((p) => p.content.emails.map((e) => ({ e, url: p.url }))).map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as { e: string; url: string });
  if (emails.length) set({ key: "email", status: "verified", value: emails[0].e, evidenceQuote: emails[0].e, sourceUrl: emails[0].url });
  const phones = pages.flatMap((p) => p.content.phones.map((ph) => ({ ph, url: p.url })));
  if (phones.length) set({ key: "phone", status: "verified", value: phones[0].ph, evidenceQuote: phones[0].ph, sourceUrl: phones[0].url });
  const formPage = pages.find((p) => p.content.forms.some(looksLikeContactForm));
  if (formPage) {
    const f = formPage.content.forms.find(looksLikeContactForm)!;
    set({ key: "contact_form", status: "verified", value: "yes", evidenceQuote: `Form fields: ${f.fields.slice(0, 5).join(", ")}${f.hasTextarea ? " (+ message box)" : ""}`, sourceUrl: formPage.url });
  }
  const socials = [...new Set(pages.flatMap((p) => p.content.links.map((l) => l.href)).filter((h) => SOCIAL_RE.test(h)).map((h) => h.replace(/\?.*$/, "")))].slice(0, 5);
  if (socials.length) set({ key: "social_profiles", status: "verified", value: socials.join(" "), evidenceQuote: socials.join(" "), sourceUrl: pages[0].url });

  // Booking method from text + tools.
  const bookingTool = out.get("booking_tool");
  const textHit = (re: RegExp) => {
    for (const p of pages) {
      const m = re.exec(p.content.text);
      if (m) return { quote: snippet(p.content.text, m.index, m[0].length), url: p.url };
    }
    return null;
  };
  const online = textHit(ONLINE_BOOKING_RE);
  const call = textHit(CALL_TO_BOOK_RE);
  const walk = textHit(WALK_IN_RE);
  if (bookingTool || online) set({ key: "booking_method", status: "verified", value: call ? "mixed" : "online_booking", evidenceQuote: online?.quote ?? bookingTool!.evidenceQuote, sourceUrl: online?.url ?? bookingTool!.sourceUrl });
  else if (call && formPage) set({ key: "booking_method", status: "verified", value: "mixed", evidenceQuote: call.quote, sourceUrl: call.url });
  else if (call) set({ key: "booking_method", status: "verified", value: walk ? "mixed" : "phone_only", evidenceQuote: call.quote, sourceUrl: call.url });
  else if (walk) set({ key: "booking_method", status: "verified", value: "walk_in", evidenceQuote: walk.quote, sourceUrl: walk.url });
  else if (formPage) set({ key: "booking_method", status: "verified", value: "online_form", evidenceQuote: "Request form present; no booking tool or call-to-book instruction found", sourceUrl: formPage.url });

  // Explicit "not found" for tool fields we actively looked for: a gap signal, not a guess.
  for (const key of ["booking_tool", "chat_tool", "review_tool", "shop_management_tool", "financing_provider", "contact_form", "email"] as FactKey[]) {
    if (!out.has(key)) set({ key, status: "not_found", value: null, evidenceQuote: `Not detected across ${pages.length} fetched page(s)`, sourceUrl: null });
  }
  return [...out.values()];
}
