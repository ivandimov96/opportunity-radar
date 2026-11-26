/**
 * A head start for a new account: pick what you are, tick what you actually do and what your customers
 * value, and the profile is written from those choices in plain sentences a seller of that kind would use.
 * It also names the kinds of business they usually sell to, what their first email should offer and what
 * shows that a business is a good fit. Everything is a starting point the person edits; nothing here is
 * ever sent or claimed as written. Pure data: safe to import anywhere.
 *
 * The words are meant to be understood in any country: no tax, law or certificate of one country by name,
 * and kinds of business as a map search anywhere would name them.
 *
 * The description is put together from parts so that it says what THIS seller does, not what the trade
 * does in general: "<lead> <the services ticked> <tail>." and "<the benefits ticked>.". The texts keep to
 * the profile rules (src/lib/profile-rules.ts); a test checks every combination that can be made.
 */
import type { FirstStep } from "@/lib/seller";

export interface Profession {
  key: string;
  label: string;
  /** How the description opens: "We do", "We clean". */
  lead: string;
  /** What they may do, as it reads after the lead: "bookkeeping", "payroll". The first three are ticked to begin with. */
  services: string[];
  /** How the description ends: for whom and on what terms. */
  tail: string;
  /** What a customer may get out of it, each a phrase that can open a sentence. The first two are ticked to begin with. */
  benefits: string[];
  firstStep: FirstStep;
  offerKind: "service" | "product" | "software";
  /** Kinds of business they usually sell to: what the searches are made from. */
  kinds: string[];
  /** What to look for on a prospect's website, one sign per sentence. */
  fitSigns: string;
}

export const START_SERVICES = 3;
export const START_BENEFITS = 2;
export const MAX_SERVICES = 5;
export const MAX_BENEFITS = 3;

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const sentence = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t ? `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}` : "";
};

/** "What do you offer?", written from the services ticked. Empty when none is. */
export function offerText(p: Profession, services: string[]): string {
  return services.length ? sentence(`${p.lead} ${list(services)} ${p.tail}`) : "";
}
/** "What does your customer get out of it?", written from the benefits ticked. Empty when none is. */
export function resultText(benefits: string[]): string {
  if (!benefits.length) return "";
  const [first, ...rest] = benefits;
  return sentence(rest.length ? `${first}, ${rest.length > 1 ? `${rest.slice(0, -1).join(", ")}, and ${rest.at(-1)}` : `and ${rest[0]}`}` : first);
}

export const PROFESSIONS: Profession[] = [
  {
    key: "accounting",
    label: "Accounting and bookkeeping",
    lead: "We do",
    services: ["bookkeeping", "payroll", "annual accounts", "tax returns", "sales tax filings", "monthly management reports", "company registration", "accounting software set-up"],
    tail: "for small companies, for a fixed monthly fee",
    benefits: ["books that are always up to date", "no surprises at tax time", "someone who answers the phone", "one fixed fee with no extra bills", "more time for the business itself"],
    firstStep: "review",
    offerKind: "service",
    kinds: ["building contractors", "restaurants", "dental clinics", "car repair shops", "real estate agencies", "marketing agencies"],
    fitSigns: "They are hiring or have opened a new location. They have several people on the team page. They sell to other businesses.",
  },
  {
    key: "cleaning",
    label: "Commercial cleaning",
    lead: "We do",
    services: ["daily office cleaning", "shop cleaning", "deep cleans", "window cleaning", "floor care", "restroom supplies", "move-out cleans", "cleaning after building work"],
    tail: "in the evening or early morning, with our own trained staff",
    benefits: ["a clean workplace every morning", "no cleaners to hire, manage or cover for", "the same trusted people every visit", "one invoice for everything", "a workplace that passes any inspection"],
    firstStep: "quote",
    offerKind: "service",
    kinds: ["dental clinics", "gyms", "daycare centers", "real estate agencies", "veterinary clinics", "accounting firms"],
    fitSigns: "They receive customers or patients on the premises. They have more than one site. They list long opening hours.",
  },
  {
    key: "signs_print",
    label: "Signs and printing",
    lead: "We design, make and fit",
    services: ["shop signs", "vehicle graphics", "window graphics", "banners", "printed menus", "illuminated signs", "safety signs", "printed workwear"],
    tail: "for local businesses, from one piece to a full rebrand",
    benefits: ["a business that is noticed from the street", "the same look on the van, the door and the paperwork", "one supplier from design to fitting", "signs that last for years", "a quick turnaround when it is urgent"],
    firstStep: "example",
    offerKind: "product",
    kinds: ["restaurants", "hair salons", "real estate agencies", "car repair shops", "gyms", "building contractors"],
    fitSigns: "They opened a new location or changed their name. They run vans. Their photos show an old or faded shop front.",
  },
  {
    key: "it_support",
    label: "IT support",
    lead: "We look after",
    services: ["computers", "company email", "backups", "security", "the office network", "new equipment", "phone systems", "accounts for new staff"],
    tail: "for small offices, for a fixed monthly fee per person",
    benefits: ["computers that simply work", "a person to call when they do not", "data that is backed up and safe", "a fixed cost each month", "new staff ready to work on day one"],
    firstStep: "review",
    offerKind: "service",
    kinds: ["accounting firms", "law firms", "dental clinics", "real estate agencies", "architects", "insurance agencies"],
    fitSigns: "They have five to fifty people. They handle confidential client records. They have more than one office.",
  },
  {
    key: "web_software",
    label: "Websites and software",
    lead: "I build",
    services: ["websites", "online booking tools", "quote forms", "customer portals", "automatic reminders", "small custom software", "links between the tools a business already uses", "online shops"],
    tail: "for small businesses, starting with one small piece that is useful on its own",
    benefits: ["fewer missed requests", "less retyping and paperwork", "customers who can book or ask for a price without a phone call", "repeat business that comes back on its own", "one clear picture of every job"],
    firstStep: "example",
    offerKind: "software",
    kinds: ["building contractors", "training centers", "metal fabricators", "car repair shops", "cleaning companies", "security system installers"],
    fitSigns: "They take bookings or quote requests by phone or a plain contact form. They issue certificates or do repeat visits. Their work is made to order.",
  },
  {
    key: "marketing",
    label: "Marketing and advertising",
    lead: "We run",
    services: ["local search advertising", "social media", "search engine work", "email newsletters", "review requests", "photography", "flyers", "monthly reports on new leads"],
    tail: "for small businesses, on a monthly plan with no long contract",
    benefits: ["more requests from the right local customers", "a clear monthly figure for what each new lead cost", "a business that is found before its competitors", "marketing that happens every month without being chased", "more and better reviews"],
    firstStep: "review",
    offerKind: "service",
    kinds: ["dental clinics", "building contractors", "law firms", "gyms", "hair salons", "car repair shops"],
    fitSigns: "They have few or old reviews. Their website has no way to book or ask for a price. They are opening a new location.",
  },
  {
    key: "insurance",
    label: "Insurance",
    lead: "We arrange",
    services: ["liability insurance", "property insurance", "vehicle insurance", "professional liability insurance", "equipment insurance", "cyber insurance", "business interruption insurance", "help with claims"],
    tail: "for small companies, and compare the market again at every renewal",
    benefits: ["the right protection at a fair price", "someone on their side when they need to claim", "no gaps they find out about too late", "one renewal date for everything", "an answer the same day"],
    firstStep: "quote",
    offerKind: "service",
    kinds: ["building contractors", "car repair shops", "restaurants", "trucking companies", "cleaning companies", "landscapers"],
    fitSigns: "They run vehicles or work on customers' premises. They employ staff. They hold trade accreditations.",
  },
  {
    key: "recruitment",
    label: "Recruitment",
    lead: "We find and screen",
    services: ["permanent staff", "temporary staff", "skilled trades", "drivers", "office staff", "care staff", "managers", "seasonal staff"],
    tail: "for small and medium companies, and charge only when someone starts",
    benefits: ["vacancies filled with people who stay", "no weeks spent reading applications", "cover at short notice", "candidates who were actually interviewed", "nothing to pay until someone starts"],
    firstStep: "call",
    offerKind: "service",
    kinds: ["metal fabricators", "building contractors", "nursing homes", "trucking companies", "restaurants", "accounting firms"],
    fitSigns: "They have a careers or vacancies page. The same job has been advertised for a long time. They are opening a new site.",
  },
  {
    key: "training",
    label: "Training and compliance",
    lead: "We run",
    services: ["first aid courses", "fire safety courses", "health and safety courses", "manual handling courses", "food hygiene courses", "forklift training", "fire risk assessments", "refresher courses"],
    tail: "at the customer's premises, with a certificate for every person",
    benefits: ["staff who are trained and certified on time", "paperwork that stands up to an inspection", "a reminder before any certificate runs out", "training on site with no travel", "one provider for every course"],
    firstStep: "quote",
    offerKind: "service",
    kinds: ["daycare centers", "nursing homes", "building contractors", "gyms", "restaurants", "metal fabricators"],
    fitSigns: "They employ staff who work with the public or with machinery. They mention inspections or accreditations. They have several sites.",
  },
  {
    key: "trade_services",
    label: "Testing, servicing and maintenance",
    lead: "We test, service and maintain",
    services: ["fire alarms", "security alarms", "fire extinguishers", "emergency lighting", "electrical installations", "electrical equipment", "heating systems", "air conditioning"],
    tail: "for businesses, with a certificate after every visit",
    benefits: ["equipment that is safe and certified on time", "one company to call when something stops working", "a reminder before the next test is due", "paperwork ready for the insurer", "a fixed price agreed beforehand"],
    firstStep: "quote",
    offerKind: "service",
    kinds: ["restaurants", "daycare centers", "nursing homes", "gyms", "hotels", "real estate agencies"],
    fitSigns: "They receive the public on the premises. They have several sites. They mention inspections, licenses or insurance requirements.",
  },
];

export const professionOf = (key: string | null | undefined): Profession | null => PROFESSIONS.find((p) => p.key === key) ?? null;
