/**
 * Deterministic, explainable scoring. Two independent numbers:
 *  - attractiveness: how good the opportunity would be IF the hypothesis holds.
 *  - confidence: how much verified evidence supports the hypothesis.
 * Missing information lowers confidence, never attractiveness.
 * Weights live here so they can be tuned and tested in one place.
 */
import type { ScoreBreakdown } from "@/db/schema";
import { OUR_CAPABILITIES, type OpportunityCategory } from "@/lib/industries";

export const ATTRACTIVENESS_WEIGHTS = {
  value: 0.3,
  feasibility: 0.2,
  reusability: 0.2,
  fit: 0.1,
  reach: 0.1,
  readiness: 0.1,
} as const;

export const CONFIDENCE_WEIGHTS = {
  evidence_count: 0.45,
  evidence_strength: 0.25,
  research_depth: 0.15,
  assumption_load: 0.15,
} as const;

export interface ScoreInput {
  category: OpportunityCategory;
  aiRatings: { value: number; feasibility: number; evidenceStrength: number; buyingReadiness: number }; // 1..5
  implementationEffort: "small" | "medium" | "large";
  reusability: "low" | "medium" | "high";
  /** Verified facts cited by the opportunity. */
  supportingVerifiedCount: number;
  /** "Not found" gaps cited by the opportunity (weaker evidence than a verified fact). */
  supportingGapCount: number;
  totalVerifiedFacts: number;
  pagesResearched: number;
  assumptionCount: number;
  contact: { email: boolean; phone: boolean; contactForm: boolean };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const rating = (r: number) => clamp(((Math.max(1, Math.min(5, r)) - 1) / 4) * 100);

export function scoreOpportunity(input: ScoreInput): { attractiveness: number; confidence: number; breakdown: ScoreBreakdown } {
  const notes: string[] = [];

  // ---------------------------------------------------------- attractiveness
  const value = rating(input.aiRatings.value);
  const effortAdj = { small: 100, medium: 70, large: 40 }[input.implementationEffort];
  const feasibility = clamp(rating(input.aiRatings.feasibility) * 0.5 + effortAdj * 0.5);
  const reusability = { low: 25, medium: 60, high: 95 }[input.reusability];
  const fit = clamp((OUR_CAPABILITIES[input.category] ?? 0.5) * 100);
  const reach = input.contact.email ? 100 : input.contact.contactForm ? 65 : input.contact.phone ? 50 : 10;
  const readiness = rating(input.aiRatings.buyingReadiness);

  const attractivenessFactors = [
    { factor: "Potential value", weight: ATTRACTIVENESS_WEIGHTS.value, score: value, explanation: `Analyst value rating ${input.aiRatings.value}/5 (if the hypothesis holds).` },
    { factor: "Feasibility", weight: ATTRACTIVENESS_WEIGHTS.feasibility, score: feasibility, explanation: `Feasibility rating ${input.aiRatings.feasibility}/5 blended with ${input.implementationEffort} implementation effort.` },
    { factor: "Reusability", weight: ATTRACTIVENESS_WEIGHTS.reusability, score: reusability, explanation: `Reusability across similar businesses rated ${input.reusability}.` },
    { factor: "Capability fit", weight: ATTRACTIVENESS_WEIGHTS.fit, score: fit, explanation: `Category "${input.category}" fit with our build capabilities.` },
    { factor: "Reachability", weight: ATTRACTIVENESS_WEIGHTS.reach, score: reach, explanation: input.contact.email ? "Verified public email available." : input.contact.contactForm ? "Website contact form found; no verified email." : input.contact.phone ? "Phone only; no verified email." : "No verified contact channel." },
    { factor: "Buying readiness", weight: ATTRACTIVENESS_WEIGHTS.readiness, score: readiness, explanation: `Readiness signals rated ${input.aiRatings.buyingReadiness}/5.` },
  ];
  const attractiveness = clamp(attractivenessFactors.reduce((s, f) => s + f.weight * f.score, 0));

  // ------------------------------------------------------------- confidence
  const n = input.supportingVerifiedCount + Math.min(2, input.supportingGapCount) * 0.5;
  const evidenceCount = n === 0 ? 5 : n < 1.5 ? 40 : n < 2.5 ? 65 : n < 3.5 ? 80 : 90;
  if (input.supportingVerifiedCount === 0) notes.push(input.supportingGapCount ? "Supported only by gaps (things not found on the site): treat as a hypothesis to validate." : "No verified fact cites this opportunity: treat as a hypothesis only.");
  const evidenceStrength = rating(input.aiRatings.evidenceStrength);
  const depth = input.pagesResearched === 0 ? 0 : input.pagesResearched === 1 ? 35 : input.pagesResearched <= 3 ? 65 : 90;
  if (input.pagesResearched <= 1) notes.push("Research depth is shallow (one page or fewer).");
  const assumptionLoad = clamp(100 - Math.min(5, input.assumptionCount) * 15);

  const confidenceFactors = [
    { factor: "Evidence cited", weight: CONFIDENCE_WEIGHTS.evidence_count, score: evidenceCount, explanation: `${input.supportingVerifiedCount} verified fact(s) and ${input.supportingGapCount} gap(s) cited; ${input.totalVerifiedFacts} facts verified in total.` },
    { factor: "Evidence strength", weight: CONFIDENCE_WEIGHTS.evidence_strength, score: evidenceStrength, explanation: `Analyst evidence-strength rating ${input.aiRatings.evidenceStrength}/5.` },
    { factor: "Research depth", weight: CONFIDENCE_WEIGHTS.research_depth, score: depth, explanation: `${input.pagesResearched} page(s) researched.` },
    { factor: "Assumption load", weight: CONFIDENCE_WEIGHTS.assumption_load, score: assumptionLoad, explanation: `${input.assumptionCount} explicit assumption(s) must be validated.` },
  ];
  let confidence = clamp(confidenceFactors.reduce((s, f) => s + f.weight * f.score, 0));
  if (input.supportingVerifiedCount === 0) confidence = Math.min(confidence, input.supportingGapCount ? 45 : 35);

  return { attractiveness, confidence, breakdown: { attractiveness: attractivenessFactors, confidence: confidenceFactors, notes } };
}

/** Combined priority used for ranking lists. Kept simple and visible. */
export function priorityScore(attractiveness: number, confidence: number) {
  return Math.round(attractiveness * 0.6 + confidence * 0.4);
}
