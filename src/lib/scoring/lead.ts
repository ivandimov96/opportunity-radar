/**
 * Lead score: how worth investigating a discovered business looks before we
 * spend any research time, computed from discovery data alone. It orders the
 * "Investigate all" queue and the search results, and explains itself.
 *
 * Independents with a real website, a phone and a full address come first;
 * chains/franchises and businesses that only exist on aggregator pages come
 * last. The score never hides anyone; it only sets the order.
 */
import { getPlaybook, GENERIC_CHAIN_RE } from "@/lib/industries";
import { isAggregatorUrl } from "@/lib/discovery/normalize";

export type BusinessKind = "independent" | "chain" | "unknown";

export interface LeadInput {
  name: string;
  industry: string;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  category?: string | null;
}

/** Extra discovery-time signals a provider may know (none are required). */
export interface LeadHints {
  /** The listing carries opening hours: an actively maintained record. */
  openingHours?: boolean;
  /** Years since the business started trading (registry permit date). */
  yearsActive?: number | null;
  /** Outlets under the same owner in this search (registry): 3+ reads as a small chain. */
  outletCount?: number;
  /** Brand the source attaches to the place (Overture): a branded place is a chain outlet. */
  brand?: string | null;
}

const CAR_BRANDS = "toyota|honda|ford|chevrolet|chevy|nissan|hyundai|kia|subaru|mazda|volkswagen|vw|bmw|mercedes(-| )?benz|mercedes|audi|lexus|acura|infiniti|jeep|dodge|ram|chrysler|gmc|buick|cadillac|volvo|tesla|porsche|land ?rover|jaguar|mini|genesis|mitsubishi|lincoln|maserati|ferrari|lamborghini|bentley|rolls(-| )?royce|alfa ?romeo|fiat";
/** A bare brand as the business name, or a dealer-style domain (mercedesbenzofaustin.com, austintoyota.com). */
const DEALER_NAME_RE = new RegExp(`^(${CAR_BRANDS})( of [a-z .]+| [a-z]+ (dealer|dealership|sales))?$`, "i");
const HOST_BRANDS = "toyota|honda|ford|chevrolet|chevy|nissan|hyundai|kia|subaru|mazda|volkswagen|vw|bmw|mercedesbenz|mercedes|audi|lexus|acura|infiniti|jeep|dodge|chrysler|gmc|buick|cadillac|volvo|porsche|landrover|jaguar|genesis|mitsubishi|lincoln|maserati|ferrari|lamborghini|bentley|rollsroyce|alfaromeo|fiat";
/** Applied to the domain label (no TLD): brandof…, …brandsales, citybrand (austintoyota). */
const DEALER_HOST_RE = new RegExp(`(^|[a-z])(${HOST_BRANDS})(of|dealer|dealers|sales|motors|$)`, "i");

/** Chain store locator URLs: local.brand.com, /locations/..., /store/123, /texas/austin/... */
const CHAIN_URL_RE = /^https?:\/\/(local|locations|stores?)\.|\/(locations?|stores?|store-locator|locate[-a-z]*|find-a-store|dealers?)\/|\/[a-z]{2}\/[a-z-]+\/[a-z0-9-]+\/?$|\/[a-z-]+\/[a-z-]+\/\d{2,5}-[a-z0-9-]+/i;

export function classifyKind(input: LeadInput, hints: LeadHints = {}): { kind: BusinessKind; reason: string | null } {
  const playbook = getPlaybook(input.industry);
  if ((hints.outletCount ?? 0) >= 3) return { kind: "chain", reason: `${hints.outletCount} outlets under the same owner` };
  if (hints.brand) return { kind: "chain", reason: `branded outlet (${hints.brand})` };
  if (playbook.chainPatterns?.test(input.name)) return { kind: "chain", reason: `name matches a known chain/franchise in ${playbook.label}` };
  if (GENERIC_CHAIN_RE.test(input.name)) return { kind: "chain", reason: "name matches a national brand or dealership" };
  if (input.website && CHAIN_URL_RE.test(input.website)) return { kind: "chain", reason: "website is a store-locator page of a larger brand" };
  if (DEALER_NAME_RE.test(input.name.trim())) return { kind: "chain", reason: "franchised car dealership" };
  if (input.website) {
    try {
      const label = new URL(input.website).hostname.replace(/^www\./, "").split(".")[0];
      if (DEALER_HOST_RE.test(label)) return { kind: "chain", reason: "dealer-style website domain" };
    } catch {
      /* ignore */
    }
  }
  return { kind: input.website || input.phone ? "independent" : "unknown", reason: null };
}

export interface LeadScore {
  score: number;
  kind: BusinessKind;
  reasons: string[];
}

export function leadScore(input: LeadInput, hints: LeadHints = {}): LeadScore {
  const reasons: string[] = [];
  let score = 20;
  const { kind, reason } = classifyKind(input, hints);
  if (input.website && !isAggregatorUrl(input.website)) {
    score += 35;
    reasons.push("own website");
  } else if (input.website) {
    score += 8;
    reasons.push("only a social/aggregator page");
  } else reasons.push("no website yet (finder will try)");
  if (input.phone) {
    score += 12;
    reasons.push("phone");
  }
  if (input.email) {
    score += 8;
    reasons.push("email");
  }
  if (input.street) {
    score += 10;
    reasons.push("street address");
  }
  if (input.city) score += 5;
  if (input.category) {
    const sel = getPlaybook(input.industry).osmSelectors.join(" ");
    if (sel.includes(`"${input.category}"`) || sel.includes(input.category)) {
      score += 10;
      reasons.push("category matches the playbook");
    }
  }
  if (hints.openingHours) {
    score += 6;
    reasons.push("hours listed (maintained record)");
  }
  if (hints.yearsActive != null) {
    if (hints.yearsActive < 1) {
      score -= 5;
      reasons.push("started trading less than a year ago");
    } else if (hints.yearsActive <= 30) {
      score += 6;
      reasons.push(`${Math.floor(hints.yearsActive)} years trading`);
    } else {
      score += 3;
      reasons.push(`${Math.floor(hints.yearsActive)} years trading`);
    }
  }
  if (hints.outletCount === 2) {
    score -= 5;
    reasons.push("2 outlets under the same owner");
  }
  if (kind === "chain") {
    score -= 45;
    reasons.push(reason ?? "chain");
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), kind, reasons };
}
