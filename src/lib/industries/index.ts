/**
 * Industry playbooks: configurable knowledge the discovery, analysis and
 * scoring stages use. Adding an industry means adding an entry here; nothing
 * else in the app is industry-specific.
 */
export interface IndustryPlaybook {
  key: string;
  label: string;
  /** Overpass tag selectors, e.g. '["shop"="car_repair"]'. Empty = OSM unsupported. */
  osmSelectors: string[];
  /** Default Google Places text query. */
  googleTextQuery: string;
  /** Workflows that are typically important in this industry (analysis context). */
  typicalWorkflows: string[];
  /** Established vertical software the analysis must consider before proposing custom work. */
  commonTools: string[];
  /** Opportunity categories most often relevant (hint, not a constraint). */
  opportunityHints: OpportunityCategory[];
  /** Public-information cues that often indicate a workflow gap. */
  gapCues: string[];
}

export const OPPORTUNITY_CATEGORIES = {
  online_booking: "Online scheduling / booking",
  estimate_quote_followup: "Estimate & quote follow-up",
  reminder_automation: "Maintenance / recall reminders",
  customer_communication: "Customer status updates & two-way messaging",
  review_reputation: "Review requests & reputation",
  website_conversion: "Website lead capture & conversion",
  customer_portal: "Customer / fleet portal",
  invoicing_payments: "Invoicing, deposits & payments",
  inventory_parts: "Inventory, parts & supplier workflows",
  reporting_analytics: "Reporting & operational analytics",
  integration_automation: "Integrating & automating existing tools",
  document_processing: "Document & form processing",
  fleet_b2b: "Fleet / B2B account management",
  other: "Other",
} as const;

export type OpportunityCategory = keyof typeof OPPORTUNITY_CATEGORIES;
export const OPPORTUNITY_CATEGORY_KEYS = Object.keys(OPPORTUNITY_CATEGORIES) as OpportunityCategory[];

/** Categories we (the operator) are well positioned to build. Affects "fit" in scoring. */
export const OUR_CAPABILITIES: Record<OpportunityCategory, number> = {
  online_booking: 0.9,
  estimate_quote_followup: 1,
  reminder_automation: 1,
  customer_communication: 0.9,
  review_reputation: 0.7,
  website_conversion: 0.8,
  customer_portal: 0.9,
  invoicing_payments: 0.6,
  inventory_parts: 0.5,
  reporting_analytics: 0.8,
  integration_automation: 1,
  document_processing: 0.9,
  fleet_b2b: 0.8,
  other: 0.5,
};

const PLAYBOOKS: Record<string, IndustryPlaybook> = {
  auto_repair: {
    key: "auto_repair",
    label: "Automotive repair",
    osmSelectors: ['["shop"="car_repair"]'],
    googleTextQuery: "auto repair shop",
    typicalWorkflows: [
      "Appointment scheduling (phone, walk-in, or online)",
      "Vehicle check-in and digital vehicle inspection (DVI)",
      "Estimate creation and customer approval of repairs",
      "Parts ordering and supplier lookups",
      "Repair status updates to the customer",
      "Invoicing, payment, and financing",
      "Maintenance reminders and recall follow-ups",
      "Review requests after service",
      "Fleet / commercial account management",
      "Warranty tracking",
    ],
    commonTools: [
      "Tekmetric",
      "Shopmonkey",
      "Shop-Ware",
      "AutoLeap",
      "Mitchell 1 Manager SE",
      "Kukui",
      "Steer CRM",
      "MechanicNet",
      "AutoOps",
      "RepairPal",
      "Openbay",
      "Podium",
      "Birdeye",
      "Square Appointments",
    ],
    opportunityHints: [
      "online_booking",
      "estimate_quote_followup",
      "reminder_automation",
      "customer_communication",
      "fleet_b2b",
      "website_conversion",
      "integration_automation",
    ],
    gapCues: [
      "Site says 'call to schedule' with no online booking",
      "No text/SMS update mention",
      "Fleet services offered but no fleet portal/account page",
      "Coupons/specials as static images (no tracking)",
      "Financing mentioned only as a phone conversation",
    ],
  },
  home_services: {
    key: "home_services",
    label: "Home services (HVAC, plumbing, electrical)",
    osmSelectors: ['["craft"~"^(hvac|plumber|electrician)$"]', '["shop"~"^(hvac|plumber|electrician)$"]'],
    googleTextQuery: "HVAC plumbing electrical contractor",
    typicalWorkflows: [
      "Lead intake (phone/web form) and dispatch",
      "On-site estimate and quote delivery",
      "Quote follow-up and approval",
      "Scheduling and technician routing",
      "Maintenance plans / recurring service agreements",
      "Invoicing, deposits, financing",
      "Review requests and referrals",
      "Permit and inspection paperwork",
    ],
    commonTools: ["ServiceTitan", "Jobber", "Housecall Pro", "FieldEdge", "Service Fusion", "Workiz", "Podium", "Wisetack"],
    opportunityHints: [
      "estimate_quote_followup",
      "online_booking",
      "reminder_automation",
      "customer_communication",
      "website_conversion",
      "document_processing",
      "integration_automation",
    ],
    gapCues: [
      "Free estimate offered but request flow is phone-only",
      "Maintenance plans described without an online sign-up",
      "No online booking despite 24/7 emergency service claims",
    ],
  },
  dental: {
    key: "dental",
    label: "Dental practices",
    osmSelectors: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
    googleTextQuery: "dentist",
    typicalWorkflows: [
      "New patient intake forms",
      "Appointment scheduling and recall reminders",
      "Insurance verification",
      "Treatment plan presentation and follow-up",
      "Review requests",
    ],
    commonTools: ["Dentrix", "Eaglesoft", "Open Dental", "Curve Dental", "Weave", "NexHealth", "RevenueWell", "Solutionreach"],
    opportunityHints: ["online_booking", "document_processing", "reminder_automation", "customer_communication", "integration_automation"],
    gapCues: ["PDF intake forms to print", "No online scheduling", "No mention of text reminders"],
  },
  landscaping: {
    key: "landscaping",
    label: "Landscaping & lawn care",
    osmSelectors: ['["craft"~"^(gardener|landscaper)$"]'],
    googleTextQuery: "landscaping lawn care company",
    typicalWorkflows: ["Quote requests", "Recurring service scheduling", "Crew routing", "Invoicing and autopay", "Seasonal upsells"],
    commonTools: ["Jobber", "LMN", "Aspire", "Yardbook", "Service Autopilot"],
    opportunityHints: ["estimate_quote_followup", "online_booking", "invoicing_payments", "website_conversion", "reminder_automation"],
    gapCues: ["Quote by phone only", "No recurring plan sign-up"],
  },
  generic: {
    key: "generic",
    label: "Other / generic (CSV or Google Places only)",
    osmSelectors: [],
    googleTextQuery: "",
    typicalWorkflows: ["Lead intake", "Scheduling", "Quoting", "Customer communication", "Invoicing", "Reporting"],
    commonTools: [],
    opportunityHints: OPPORTUNITY_CATEGORY_KEYS,
    gapCues: [],
  },
};

export function getPlaybook(key: string): IndustryPlaybook {
  return PLAYBOOKS[key] ?? PLAYBOOKS.generic;
}

export function listPlaybooks(): IndustryPlaybook[] {
  return Object.values(PLAYBOOKS);
}
