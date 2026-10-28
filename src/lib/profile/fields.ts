/**
 * The business profile: a fixed set of comparable fields every investigated
 * business gets. Each fact is verified (with evidence), not_found (checked, no
 * evidence on the site) or unknown (could not be assessed). This replaces the
 * old free-form observation list and makes businesses easy to compare.
 */
export type FactStatus = "verified" | "not_found" | "unknown";
export type FactGroup = "business" | "operations" | "tools" | "contact" | "footprint";

export interface FactField {
  key: string;
  label: string;
  group: FactGroup;
  /** Short hint for the model/operator on what counts. */
  hint: string;
  /** Allowed values when the field is categorical. */
  options?: readonly string[];
}

export const FACT_FIELDS = [
  { key: "summary", label: "What they do", group: "business", hint: "One or two sentences on the actual business, from their own words." },
  { key: "services", label: "Services offered", group: "business", hint: "Comma-separated list of the main services named on the site." },
  { key: "customer_types", label: "Customer types", group: "business", hint: "Who they serve: residential, commercial, fleet, dealers, etc." },
  { key: "years_in_business", label: "Years in business", group: "business", hint: "Founding year or 'since' statement if given." },
  { key: "certifications", label: "Certifications", group: "business", hint: "ASE, NATE, licenses, manufacturer certifications named on the site." },
  { key: "warranty", label: "Warranty", group: "business", hint: "Warranty terms on work (e.g. 24 month / 24k miles)." },
  { key: "reviews_on_site", label: "Reviews / testimonials shown", group: "business", hint: "Whether the site shows reviews or testimonials.", options: ["yes", "no"] },
  { key: "multi_location", label: "Multiple locations", group: "business", hint: "Whether the site presents several locations (a location finder, 'our locations').", options: ["yes", "no"] },
  { key: "booking_method", label: "How customers book", group: "operations", hint: "The primary way the site asks customers to book or request service.", options: ["phone_only", "walk_in", "online_form", "online_booking", "mixed"] },
  { key: "estimate_policy", label: "Estimates & pricing", group: "operations", hint: "Free estimates, quote on request, published prices, diagnostic fee.", options: ["free_estimates", "quote_on_request", "prices_published", "diagnostic_fee"] },
  { key: "customer_updates", label: "Customer status updates", group: "operations", hint: "How customers are kept informed: text/SMS, email, phone, digital inspection reports." },
  { key: "maintenance_plans", label: "Maintenance plans / memberships", group: "operations", hint: "Recurring service agreements, memberships, reminders offered." },
  { key: "fleet_program", label: "Fleet / commercial program", group: "operations", hint: "Fleet accounts, commercial contracts, B2B offerings." },
  { key: "financing", label: "Financing", group: "operations", hint: "Financing or payment plans offered, provider if named." },
  { key: "promotions", label: "Promotions & coupons", group: "operations", hint: "Coupons, specials, discounts advertised." },
  { key: "conveniences", label: "Customer conveniences", group: "operations", hint: "Shuttle, loaner, pickup/delivery, after-hours drop-off, waiting room." },
  { key: "hours", label: "Business hours", group: "operations", hint: "Opening hours as listed." },
  { key: "website_platform", label: "Website platform", group: "tools", hint: "CMS or site builder detected (Wix, WordPress, Squarespace, GoDaddy...)." },
  { key: "booking_tool", label: "Online booking tool", group: "tools", hint: "Third-party scheduling/booking widget detected." },
  { key: "shop_management_tool", label: "Shop / field management software", group: "tools", hint: "Vertical software detected or named (Tekmetric, Shopmonkey, ServiceTitan, Jobber...)." },
  { key: "chat_tool", label: "Website chat", group: "tools", hint: "Live chat widget detected." },
  { key: "review_tool", label: "Reviews / reputation tool", group: "tools", hint: "Podium, Birdeye, NiceJob, review widgets." },
  { key: "marketing_tool", label: "Marketing / CRM tool", group: "tools", hint: "HubSpot, Kukui, Steer, email marketing providers." },
  { key: "financing_provider", label: "Financing provider", group: "tools", hint: "Wisetack, Sunbit, Synchrony, Affirm..." },
  { key: "email", label: "Public email", group: "contact", hint: "A public email address on the site." },
  { key: "phone", label: "Public phone", group: "contact", hint: "A public phone number on the site." },
  { key: "contact_form", label: "Contact / request form", group: "contact", hint: "Whether the site has a contact or request form.", options: ["yes", "no"] },
  { key: "social_profiles", label: "Social profiles", group: "contact", hint: "Facebook, Instagram, Google Business links." },
  { key: "address", label: "Address on site", group: "contact", hint: "Postal address as published on the site (structured data or contact page)." },
  { key: "website_health", label: "Website health", group: "footprint", hint: "HTTPS, mobile viewport, homepage size and response time (measured, not from text)." },
  { key: "website_updated", label: "Website last updated", group: "footprint", hint: "Latest copyright year or dated content found on the site." },
  { key: "domain_registered", label: "Domain registered", group: "footprint", hint: "Domain registration year from the public RDAP record." },
  { key: "site_first_seen", label: "Site first archived", group: "footprint", hint: "Year of the first Internet Archive capture of the domain." },
  { key: "email_provider", label: "Email hosting", group: "footprint", hint: "Email provider from DNS MX records (Google Workspace, Microsoft 365, ...)." },
  { key: "email_senders", label: "Email sending services", group: "footprint", hint: "Marketing/transactional senders authorized in the domain's SPF record." },
  { key: "permit_since", label: "Business permit since", group: "footprint", hint: "First sales date on the state sales tax permit (public registry)." },
] as const satisfies readonly FactField[];

export type FactKey = (typeof FACT_FIELDS)[number]["key"];
export const FACT_KEYS = FACT_FIELDS.map((f) => f.key) as FactKey[];
export const FACT_BY_KEY: Record<string, FactField> = Object.fromEntries(FACT_FIELDS.map((f) => [f.key, f]));
export const FACT_GROUPS: { key: FactGroup; label: string }[] = [
  { key: "business", label: "Business" },
  { key: "operations", label: "How they operate" },
  { key: "tools", label: "Tools in use" },
  { key: "contact", label: "Contact channels" },
  { key: "footprint", label: "Online footprint (off-site records)" },
];

/** Keys where "not found" is itself a useful signal (a gap hypothesis base). */
export const GAP_KEYS: FactKey[] = ["booking_tool", "chat_tool", "customer_updates", "maintenance_plans", "fleet_program", "financing", "review_tool", "contact_form", "email", "reviews_on_site", "estimate_policy"];

export function factLabel(key: string) {
  return FACT_BY_KEY[key]?.label ?? key.replace(/_/g, " ");
}
export function factValueLabel(v: string | null | undefined) {
  if (!v) return "";
  return v.replace(/_/g, " ");
}
