/**
 * Industry playbooks: configurable knowledge the discovery, analysis and
 * scoring stages use. Adding an industry means adding an entry here; nothing
 * else in the app is industry-specific.
 */
export interface IndustrySegment {
  key: string;
  label: string;
  description: string;
  /** Overpass tag selectors for this segment. */
  osmSelectors: string[];
  /** Google Places text query for this segment. */
  googleQuery: string;
}

export interface IndustryPlaybook {
  key: string;
  label: string;
  /** One-line description shown when choosing the business type. */
  description: string;
  /** Sub-types the operator can narrow to. Empty = no segmentation. */
  segments: IndustrySegment[];
  /** Overpass tag selectors, e.g. '["shop"="car_repair"]'. Empty = OSM unsupported. */
  osmSelectors: string[];
  /** Case-insensitive name pattern that catches mis-tagged map entries (any shop/craft/office with such a name). Used when no sub-type narrows the search. */
  osmNameRegex?: string;
  /** Adjacent businesses that share tags but are not the target (tint, detailing, car wash…); dropped from map results by name. */
  excludeNameRegex?: RegExp;
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
  /** Names of national/regional chains and franchises in this industry (deprioritized, never hidden). */
  chainPatterns?: RegExp;
}

/** Chains and franchises common to every industry: dealerships, big-box, national brands. */
export const GENERIC_CHAIN_RE = /\b(walmart|costco|sam'?s club|sears|home depot|lowe'?s|best buy|u-?haul|enterprise rent-?a-?car|hertz|avis|budget (rent-?a-?car|truck)|carmax|carvana|autonation|(toyota|honda|ford|chevrolet|chevy|nissan|hyundai|kia|subaru|mazda|volkswagen|vw|bmw|mercedes(-benz)?|audi|lexus|acura|infiniti|jeep|dodge|ram|chrysler|gmc|buick|cadillac|volvo|tesla|porsche|land rover|jaguar|mini|genesis|mitsubishi|lincoln) (of|dealer|dealership)|dealership)\b/i;

/**
 * What the consultancy offers, as families of solutions. The keys are stored
 * with every idea; the labels are what the operator reads. The range is
 * deliberately wider than "make the website form better": most of what a
 * company needs is behind the scenes.
 */
export const OPPORTUNITY_CATEGORIES = {
  estimate_quote_followup: "Quotes: complete requests, tracking and follow-up",
  online_booking: "Booking and ordering online",
  job_tracking: "Job and production tracking",
  scheduling_dispatch: "Planning people, visits and deliveries",
  inventory_parts: "Stock, catalogue and suppliers",
  customer_portal: "Customer self-service",
  customer_communication: "Status updates for customers",
  document_processing: "Paperwork, forms and certificates",
  invoicing_payments: "Invoicing and payments",
  integration_automation: "Connecting the tools already in use",
  reporting_analytics: "Numbers at a glance",
  ai_assistant: "AI help with routine questions and documents",
  reminder_automation: "Reminders and repeat business",
  review_reputation: "Review requests",
  website_conversion: "Turning website visitors into enquiries",
  fleet_b2b: "Accounts for business customers",
  other: "Other",
} as const;

export type OpportunityCategory = keyof typeof OPPORTUNITY_CATEGORIES;
export const OPPORTUNITY_CATEGORY_KEYS = Object.keys(OPPORTUNITY_CATEGORIES) as OpportunityCategory[];

/** Categories we (the operator) are well positioned to build. Affects "fit" in scoring. */
export const OUR_CAPABILITIES: Record<OpportunityCategory, number> = {
  online_booking: 0.9,
  job_tracking: 1,
  scheduling_dispatch: 0.9,
  ai_assistant: 0.8,
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

/**
 * The catalogue the research chooses from: for each family, what it does in
 * plain words and what on a website (or in what a business plainly does)
 * suggests it could matter. Signals are reasons to consider a family, never
 * proof that the business needs it.
 */
export const SOLUTION_GUIDE: Record<Exclude<OpportunityCategory, "other">, { what: string; signals: string }> = {
  estimate_quote_followup: { what: "Quote requests arrive with everything needed to price them; sent quotes are tracked and followed up.", signals: "work priced per job, free quotes or estimates, a general enquiry form, drawings or measurements needed" },
  online_booking: { what: "Customers book a visit, a slot or a repeat order themselves.", signals: "appointments, call-to-book, standard services or products ordered again and again" },
  job_tracking: { what: "One place that shows every job from order to delivery: what stage it is at, who has it, what is due.", signals: "bespoke or multi-step work, design then manufacture then installation, several trades or departments, lead times that depend on workload" },
  scheduling_dispatch: { what: "Planning who goes where and when: crews, site visits, deliveries, routes, proof of delivery.", signals: "own delivery vehicles, on-site work, installation or maintenance teams, a service area, emergency call-outs" },
  inventory_parts: { what: "Stock that is up to date and visible: what is on the shelf, an online list or catalogue, reorder alerts, supplier orders.", signals: "stockholding, a product range, offcuts or clearance items, parts, materials bought to order" },
  customer_portal: { what: "A place where their customers see their own orders, job status, documents and history, and reorder.", signals: "repeat or account customers, trade accounts, contracts, documents sent to customers" },
  customer_communication: { what: "Customers are told automatically where their job or order stands.", signals: "customers told to call for progress, lead times, collection or delivery, work that takes days or weeks" },
  document_processing: { what: "Paperwork produced or read automatically: job sheets, certificates, compliance records, forms, data pulled out of PDFs and emails.", signals: "certifications, test or mill certificates, forms to download or print, regulated work, inspections, drawings" },
  invoicing_payments: { what: "Invoices, deposits and payments raised from the job itself and chased automatically.", signals: "deposits, account terms, payment on collection, credit accounts" },
  integration_automation: { what: "The tools they already use pass data to each other, so nothing is typed twice.", signals: "several named tools, an online shop next to an accounts package, spreadsheets, a website form that ends in an inbox" },
  reporting_analytics: { what: "The numbers that matter on one screen: quotes won and lost, margin per job, late deliveries, workload ahead.", signals: "many jobs or orders, several services or sites, growth, capacity or lead-time pressure" },
  ai_assistant: { what: "Routine questions answered and routine documents drafted from their own material, with a person checking the result.", signals: "the same questions asked again and again (an FAQ), a large product or technical range, enquiries by email, quotes written from descriptions or drawings" },
  reminder_automation: { what: "Customers are reminded when something is due again.", signals: "servicing, inspections, renewals, maintenance contracts, consumables" },
  review_reputation: { what: "Happy customers are asked for a review at the right moment.", signals: "testimonials shown, consumer customers, local reputation matters" },
  website_conversion: { what: "Visitors to the website find it easy to get in touch and are answered quickly.", signals: "phone-only contact, no enquiry form, a site that is hard to use on a phone" },
  fleet_b2b: { what: "Business customers get their own terms, approvals, statements and order history.", signals: "trade or fleet accounts, commercial customers, account application forms" },
};

/**
 * Where an idea sits. "existing" improves something the business already
 * offers online; "new_for_customers" adds something its customers could use;
 * "internal" is a tool for the people who work there. A website shows the
 * first, hints at the second and rarely shows the third, so the last two are
 * always put to the owner as a question.
 */
export const SOLUTION_SCOPES = {
  existing: "Improves something they already offer",
  new_for_customers: "Something new for their customers",
  internal: "A tool for the team",
} as const;
export type SolutionScope = keyof typeof SOLUTION_SCOPES;
export const SOLUTION_SCOPE_KEYS = Object.keys(SOLUTION_SCOPES) as SolutionScope[];

const PLAYBOOKS: Record<string, IndustryPlaybook> = {
  auto_repair: {
    key: "auto_repair",
    label: "Automotive repair",
    description: "Independent repair shops, body shops, tire and specialty shops. Owner-operated, clear scheduling, estimate and update workflows.",
    segments: [
      { key: "general_repair", label: "General repair & maintenance", description: "Full-service mechanical repair shops.", osmSelectors: ['["shop"="car_repair"]'], googleQuery: "auto repair shop" },
      { key: "body_collision", label: "Body & collision", description: "Collision, paint and body work.", osmSelectors: ['["shop"="car_repair"]["name"~"body|collision|paint|dent",i]', '["shop"="car_repair"]["service:vehicle:body_repair"="yes"]'], googleQuery: "auto body collision repair shop" },
      { key: "tires", label: "Tire shops", description: "Tire sales, alignment and brake centers.", osmSelectors: ['["shop"="tyres"]'], googleQuery: "tire shop" },
      { key: "transmission", label: "Transmission specialists", description: "Transmission and drivetrain specialists (name-based).", osmSelectors: ['["shop"="car_repair"]["name"~"transmission|drivetrain",i]'], googleQuery: "transmission repair shop" },
      { key: "european_import", label: "European & import specialists", description: "Brand specialists (BMW, Mercedes, Audi, Volvo, Honda, Toyota…), name-based.", osmSelectors: ['["shop"="car_repair"]["name"~"european|euro|import|bmw|mercedes|audi|volvo|porsche|honda|toyota|subaru|lexus|vw|volkswagen|saab",i]'], googleQuery: "european import auto repair specialist" },
      { key: "quick_lube", label: "Oil change & quick lube", description: "Quick-service oil change and lube shops.", osmSelectors: ['["shop"="car_repair"]["name"~"lube|oil change|quick",i]'], googleQuery: "oil change quick lube" },
    ],
    osmSelectors: ['["shop"="car_repair"]'],
    osmNameRegex: "auto repair|auto ?motive|mechanic|car care|auto service|auto cent(er|re)|collision|body shop|transmission|muffler|brakes?( |$)|(^| )lube|(^| )(tires?|tyres?)( |&|$)",
    excludeNameRegex: /\b(tint|tinting|wraps?|wrap shop|detailing|detail(ers)?|paintless|paint protection|ppf|car wash|carwash|audio|stereo|upholstery|towing|tow\b|salvage|junk|wrecker|rental|rent-a-car|u-?haul)\b/i,
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
    chainPatterns: /\b(firestone|caliber collision|caliber auto|ntb|national tire (and|&) battery|pep boys|jiffy lube|midas|meineke|goodyear|discount tire|christian brothers|valvoline|take 5|grease monkey|brake check|maaco|gerber collision|service king|crash champions|tires plus|mavis|les schwab|big o tires|kwik kar|aamco|monro|sun auto|precision tune|tuffy|car-x|belle tire|express oil|lube stop|speedee|mr\.? tire|tire kingdom|merchant'?s tire|just brakes|safelite|abra auto|joe hudson|classic collision|driven brands|auto ?zone|o'?reilly|advance auto|napa auto ?care|aaa car care|costco tire|walmart auto|sears auto|pepboys|firestone complete|tire discounters|dobbs|wheel works|carx|tunex|lamb'?s tire|jiffylube|quick lane|lee myles|cottman)\b/i,
  },
  home_services: {
    key: "home_services",
    label: "Home services (HVAC, plumbing, electrical)",
    description: "Contractors with dispatch, quoting and recurring-service workflows. Searched as one query unless a sub-type is chosen.",
    segments: [
      { key: "hvac", label: "HVAC", description: "Heating, cooling and air quality contractors.", osmSelectors: ['["craft"="hvac"]', '["shop"="hvac"]'], googleQuery: "HVAC contractor" },
      { key: "plumbing", label: "Plumbing", description: "Plumbers and drain services.", osmSelectors: ['["craft"="plumber"]', '["shop"="plumber"]'], googleQuery: "plumber" },
      { key: "electrical", label: "Electrical", description: "Electrical contractors.", osmSelectors: ['["craft"="electrician"]', '["shop"="electrician"]'], googleQuery: "electrician" },
      { key: "roofing", label: "Roofing", description: "Roofing contractors and repair.", osmSelectors: ['["craft"="roofer"]'], googleQuery: "roofing contractor" },
      { key: "garage_doors", label: "Garage doors", description: "Garage door installation and repair.", osmSelectors: ['["craft"]["name"~"garage door",i]', '["shop"="doors"]["name"~"garage",i]'], googleQuery: "garage door repair" },
      { key: "pest_control", label: "Pest control", description: "Exterminators and pest control services.", osmSelectors: ['["shop"="pest_control"]', '["craft"="pest_control"]', '["office"]["name"~"pest",i]'], googleQuery: "pest control" },
      { key: "painting", label: "Painting", description: "Painting contractors.", osmSelectors: ['["craft"="painter"]'], googleQuery: "painting contractor" },
      { key: "cleaning", label: "Cleaning services", description: "Home and carpet cleaning companies.", osmSelectors: ['["craft"="cleaning"]', '["shop"="cleaning"]'], googleQuery: "house cleaning service" },
      { key: "handyman", label: "Handyman", description: "General handyman services.", osmSelectors: ['["craft"="handyman"]'], googleQuery: "handyman" },
      { key: "pools", label: "Pool & spa service", description: "Pool and hot-tub service and cleaning.", osmSelectors: ['["craft"~"pool"]', '["shop"="swimming_pool"]["name"~"service|clean|repair",i]'], googleQuery: "pool service" },
    ],
    osmSelectors: ['["craft"~"^(hvac|plumber|electrician|roofer|painter|cleaning|handyman|pest_control)$"]', '["shop"~"^(hvac|plumber|electrician|pest_control|cleaning)$"]'],
    osmNameRegex: "plumb|hvac|heating|cooling|air condition|electric|roof|garage door|pest|exterminat|paint|cleaning|maid|handyman|pool service|pool clean",
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
    chainPatterns: /\b(mr\.? rooter|roto-?rooter|one hour (heating|air)|ars rescue|benjamin franklin plumbing|mister sparky|abc home|aire serv|service experts|arS\b|sears home|home depot|lowe'?s|horizon services|strittmatter|radiant plumbing|abacus|goettl|parker (and|&) sons|lee'?s air|mr\.? electric|bluefrog|the plumbing (joint|pros))\b/i,
  },
  dental: {
    key: "dental",
    label: "Dental practices",
    description: "Private practices with intake, scheduling, recall and insurance workflows.",
    segments: [
      { key: "general", label: "General dentistry", description: "Family and general practices.", osmSelectors: ['["amenity"="dentist"]', '["healthcare"="dentist"]'], googleQuery: "dentist" },
      { key: "orthodontics", label: "Orthodontics", description: "Orthodontic practices (speciality tag or name-based).", osmSelectors: ['["healthcare:speciality"~"orthodont"]', '["amenity"="dentist"]["name"~"orthodont|braces",i]'], googleQuery: "orthodontist" },
    ],
    osmSelectors: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
    osmNameRegex: "dental|dentist|orthodont",
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
    chainPatterns: /\b(aspen dental|western dental|smile brands|bright now|castle dental|monarch dental|pacific dental|heartland dental|great expressions|affordable dentures|kool smiles|dental one|gentle dental|familia dental|sonrava|smile direct|dentalworks|midwest dental|north american dental)\b/i,
  },
  landscaping: {
    key: "landscaping",
    label: "Landscaping & lawn care",
    description: "Recurring-service businesses with quoting, routing and invoicing workflows.",
    segments: [
      { key: "landscaping", label: "Landscaping & design", description: "Landscape contractors and designers.", osmSelectors: ['["craft"="landscaper"]'], googleQuery: "landscaping company" },
      { key: "lawn_care", label: "Lawn care & gardening", description: "Maintenance and gardening services.", osmSelectors: ['["craft"="gardener"]'], googleQuery: "lawn care service" },
      { key: "tree_service", label: "Tree service", description: "Arborists and tree care.", osmSelectors: ['["craft"]["name"~"tree|arbor",i]'], googleQuery: "tree service" },
      { key: "irrigation", label: "Irrigation", description: "Sprinkler and irrigation contractors.", osmSelectors: ['["craft"]["name"~"irrigat|sprinkler",i]'], googleQuery: "irrigation company" },
    ],
    osmSelectors: ['["craft"~"^(gardener|landscaper)$"]'],
    osmNameRegex: "landscap|lawn|tree service|irrigation",
    excludeNameRegex: /\b(nursery|garden cent(er|re)|supply|supplies|equipment rental)\b/i,
    googleTextQuery: "landscaping lawn care company",
    typicalWorkflows: ["Quote requests", "Recurring service scheduling", "Crew routing", "Invoicing and autopay", "Seasonal upsells"],
    commonTools: ["Jobber", "LMN", "Aspire", "Yardbook", "Service Autopilot"],
    opportunityHints: ["estimate_quote_followup", "online_booking", "invoicing_payments", "website_conversion", "reminder_automation"],
    gapCues: ["Quote by phone only", "No recurring plan sign-up"],
  },
  generic: {
    key: "generic",
    label: "Other business type",
    description: "Any other business type: enter the category to look for (matched against the sources' own taxonomies) or import a CSV. Generic workflows and cues apply.",
    segments: [],
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

/** Selectors for the chosen segments (all segments when none chosen, playbook defaults when unsegmented). */
export function selectorsFor(playbook: IndustryPlaybook, segmentKeys: string[]): { osmSelectors: string[]; googleQueries: string[] } {
  const segs = playbook.segments.filter((s) => !segmentKeys.length || segmentKeys.includes(s.key));
  if (!segs.length) return { osmSelectors: playbook.osmSelectors, googleQueries: playbook.googleTextQuery ? [playbook.googleTextQuery] : [] };
  return {
    osmSelectors: [...new Set(segs.flatMap((s) => s.osmSelectors))],
    googleQueries: [...new Set(segs.map((s) => s.googleQuery))],
  };
}

