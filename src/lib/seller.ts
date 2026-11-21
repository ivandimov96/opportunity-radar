/**
 * The seller: who the workspace's operator is and what they sell, as the research, the email writer and the
 * reply reader are told it. Everything comes from the profile (Settings, Your details); nothing about the
 * seller is ever made up, and what the profile leaves empty is simply not said.
 *
 * A workspace without a profile is the product's first user: a small software consultancy, described the way
 * the prompts described it before the profile existed.
 */
import type { AppSettings } from "@/lib/settings";

/** What the first email asks for: one small thing the seller can deliver, answerable with a word. */
export const FIRST_STEPS = {
  example: {
    label: "A short example made for them",
    hint: "A mock-up, a sample or a draft that shows how it would look for their company.",
    ask: "whether you may send them a short example (a mock-up, a sample or a draft, whichever fits what the sender offers) of how the idea would look for their company",
    renew: "The first email offered to send a short example made for them: you may renew that offer in a few words.",
  },
  details: {
    label: "A few details by email",
    hint: "A short note on how it would work for them.",
    ask: "whether you may send them a few lines on how it would work for their company",
    renew: "The first email offered to send a few details: you may renew that offer in a few words.",
  },
  quote: {
    label: "A rough price",
    hint: "An idea of what it would cost for a company like theirs.",
    ask: "whether you may send them a rough idea of what it would cost for their company",
    renew: "The first email offered to send a rough price: you may renew that offer in a few words.",
  },
  trial: {
    label: "A free trial or sample",
    hint: "Something they can try before deciding.",
    ask: "whether they would like to try it, free, before deciding anything",
    renew: "The first email offered a free trial or sample: you may renew that offer in a few words.",
  },
  review: {
    label: "A free short review",
    hint: "Two or three observations about their business, from your own field. Suits an adviser or consultant.",
    ask: "whether you may send them two or three short observations about their business, from the sender's own field, free and with nothing expected in return",
    renew: "The first email offered to send a few free observations: you may renew that offer in a few words.",
  },
  call: {
    label: "A short call",
    hint: "A conversation, when what you offer is best explained by talking. Suits an adviser or consultant.",
    ask: "whether they would be open to a short call (name no date and no length)",
    renew: "The first email asked whether they would be open to a short call: you may renew that in a few words.",
  },
} as const;
export type FirstStep = keyof typeof FIRST_STEPS;
export const FIRST_STEP_KEYS = Object.keys(FIRST_STEPS) as FirstStep[];

const SIZE_WORDS: Record<string, string> = { solo: "one-person businesses", small: "small teams (2 to 10 people)", medium: "medium companies (11 to 50 people)", large: "larger companies (over 50 people)" };

export interface SellerProfile {
  name: string;
  company: string;
  /** What they sell, in their own words. */
  offer: string;
  /** What a customer gets out of it, in their own words; empty when not given. */
  result: string;
  /** Kinds of business they sell to, and kinds they do not want. */
  sellsTo: string[];
  leavesOut: string[];
  /** Sizes they sell to, in words; empty = any size. */
  sizes: string[];
  /** What they would look for on a website themselves; empty when not given. */
  fitSigns: string;
  /** Past results they can back up; empty when not given. Never embellished. */
  proof: string;
  firstStep: FirstStep;
  /** What is sold is made to order as software (tools, websites, automation): the catalogue of software ideas applies. */
  buildsSoftware: boolean;
  /** No profile yet: the built-in description is used. */
  isDefault: boolean;
}

const DEFAULT_OFFER = "custom software, integrations, automation and AI tools, built to order for one business at a time";
const SOFTWARE_RE = /\b(software|apps?|web ?sites?|web ?apps?|web design|automations?|integrations?|develop(er|ment|ing)?|programming|ai tools?|chatbots?|custom tools?|booking tools?|saas|platforms?|plugins?|crm)\b/i;

export function sellerOf(s: Pick<AppSettings, "senderName" | "senderCompany" | "offer" | "offerResult" | "targetKinds" | "excludeKinds" | "targetSizes" | "fitSigns" | "proofPoints" | "firstStep">): SellerProfile {
  const offer = s.offer.trim();
  const isDefault = !offer;
  return {
    name: s.senderName.trim(),
    company: s.senderCompany.trim(),
    offer: offer || DEFAULT_OFFER,
    result: s.offerResult.trim(),
    sellsTo: s.targetKinds,
    leavesOut: s.excludeKinds,
    sizes: s.targetSizes.map((x) => SIZE_WORDS[x]).filter(Boolean),
    fitSigns: s.fitSigns.trim(),
    proof: s.proofPoints.trim(),
    // The first user offered a mock-up before there was a choice; anyone else starts with the ask every seller can keep.
    firstStep: s.firstStep ? s.firstStep : isDefault ? "example" : "details",
    buildsSoftware: isDefault || SOFTWARE_RE.test(offer),
    isDefault,
  };
}

/** The seller as the research is told it. Stable per workspace, so it can sit in the cached part of the prompt. */
export function sellerForResearch(p: SellerProfile): string {
  const lines = [`- What the seller offers: ${p.offer}`];
  if (p.result) lines.push(`- What the seller's customers get out of it: ${p.result}`);
  if (p.sellsTo.length) lines.push(`- Who the seller sells to: ${p.sellsTo.join(", ")}`);
  if (p.sizes.length) lines.push(`- Size of business the seller sells to: ${p.sizes.join("; ")}`);
  if (p.leavesOut.length) lines.push(`- The seller does not want: ${p.leavesOut.join(", ")}`);
  if (p.fitSigns) lines.push(`- Signs the seller says mark a good fit: ${p.fitSigns}`);
  if (p.proof) lines.push(`- Results the seller can back up (background for your judgment; never attribute them to this business): ${p.proof}`);
  return lines.join("\n");
}

/** The seller as the email writer is told it (in the message, next to the recipient). */
export function sellerForEmail(p: SellerProfile): string {
  const lines = [`Sender: ${p.name || "the owner"}${p.company ? ` of ${p.company}` : ""}.`, `What the sender offers, in the sender's own words: ${p.offer}`];
  if (p.result) lines.push(`What the sender's customers get out of it: ${p.result}`);
  return lines.join("\n");
}
