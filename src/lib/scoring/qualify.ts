/**
 * Qualification: one outcome per researched business, decided in code from
 * what the research established. Attractiveness and confidence stay separate
 * numbers; this function only says whether the business is worth approaching.
 *
 * Rules, in order:
 *  - the model's "no opportunity" is final (fixed rule patterns never override it);
 *  - too little verified about the business → insufficient evidence;
 *  - a hypothesis that only rules produced, that rests mostly on things not
 *    found on the site, that scores low on confidence, or that contradicts a
 *    verified fact → needs review;
 *  - otherwise → qualified.
 * "Not found on the website" never counts as evidence that qualifies.
 */
import type { Verdict } from "@/lib/pipeline/stages";

export const QUALIFY_MIN_VERIFIED_EVIDENCE = 2;
export const QUALIFY_MIN_CONFIDENCE = 60;

export interface QualifyInput {
  kind: string;
  /** Too few content facts were verified to assess the business at all. */
  thin: boolean;
  thinReason?: string;
  modelRan: boolean;
  modelVerdict: "opportunity" | "no_opportunity" | null;
  modelReason: string | null;
  /** Why the model did not run, when it did not. */
  aiSkipped: string | null;
  primary: { source: "ai" | "rules"; title: string; verifiedEvidence: number; gapEvidence: number; confidence: number; attractiveness: number; contradictions: string[] } | null;
}

export function qualify(i: QualifyInput): { verdict: Exclude<Verdict, "no_contact">; reasons: string[] } {
  if (i.modelRan && (i.modelVerdict === "no_opportunity" || !i.primary)) return { verdict: "not_a_fit", reasons: [i.modelReason?.trim() || "The research found no convincing reason to write to this business."] };
  if (i.thin && (!i.primary || i.primary.source === "rules")) return { verdict: "insufficient_evidence", reasons: [i.thinReason ?? "Too little about the business could be verified on its website."] };
  if (!i.primary) return { verdict: "needs_review", reasons: [`No rule pattern matched and the AI analysis did not run (${i.aiSkipped ?? "not configured"}).`] };

  const p = i.primary;
  const review: string[] = [];
  if (p.source === "rules") review.push(`Only fixed rule patterns produced this idea; the AI analysis did not run (${i.aiSkipped ?? "not configured"}).`);
  if (i.kind === "chain") review.push("The business looks like a chain or franchise outlet.");
  if (p.verifiedEvidence < QUALIFY_MIN_VERIFIED_EVIDENCE) review.push(`The idea rests on ${p.verifiedEvidence} verified observation(s)${p.gapEvidence ? ` and ${p.gapEvidence} thing(s) not found on the site, which prove nothing about how they work` : ""}.`);
  if (p.confidence < QUALIFY_MIN_CONFIDENCE) review.push(`Confidence in the research is ${p.confidence} of 100 (below ${QUALIFY_MIN_CONFIDENCE}).`);
  review.push(...p.contradictions);
  if (review.length) return { verdict: "needs_review", reasons: review };
  return { verdict: "qualified", reasons: [`"${p.title}" is backed by ${p.verifiedEvidence} verified observation(s).`, `Confidence ${p.confidence}, attractiveness ${p.attractiveness} of 100.`] };
}

/** A recommendation that a verified fact already answers is flagged for review instead of being sent out. */
const CONTRADICTS: Record<string, { key: string; says: string }[]> = {
  online_booking: [{ key: "booking_tool", says: "an online booking tool is already in use" }],
  review_reputation: [{ key: "review_tool", says: "a review tool is already in use" }],
  customer_portal: [{ key: "customer_portal", says: "a customer portal or login already exists" }],
  invoicing_payments: [{ key: "online_payments", says: "online payments are already offered" }],
};

export function contradictionsFor(category: string, facts: { key: string; status: string; value: string | null }[]): string[] {
  const out: string[] = [];
  for (const c of CONTRADICTS[category] ?? []) {
    const f = facts.find((x) => x.key === c.key && x.status === "verified" && x.value !== "no");
    if (f) out.push(`The idea is about ${category.replace(/_/g, " ")}, but ${c.says}${f.value && f.value !== "yes" ? ` (${f.value})` : ""}.`);
  }
  return out;
}
