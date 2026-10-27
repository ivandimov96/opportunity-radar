/**
 * Outreach stage: a draft whose company-specific claims are mapped to verified
 * profile facts. Unsupported claims become warnings for the human reviewer.
 * Nothing is ever sent.
 */
import { getConfig } from "@/lib/config";
import { factLabel } from "@/lib/profile/fields";
import { callStructured } from "./client";
import { OUTREACH_STYLES, OUTREACH_SYSTEM, type OutreachStyle } from "./prompts";
import { OutreachSchema, type Outreach } from "./schemas";

export interface FactForOutreach {
  key: string;
  status: string;
  value: string | null;
}
export interface OpportunityForOutreach {
  title: string;
  category: string;
  problemHypothesis: string;
  proposedSolution: string;
  expectedValue?: string | null;
  salesAngle?: string | null;
  supportingFactKeys: string[];
  validationQuestions: string[];
}

export function buildOutreachInput(business: { name: string; city?: string | null; region?: string | null }, opportunity: OpportunityForOutreach, facts: FactForOutreach[], style: OutreachStyle, senderName?: string | null) {
  const verified = facts.filter((f) => f.status === "verified");
  const gaps = facts.filter((f) => f.status === "not_found");
  return `Recipient business: ${business.name} (${[business.city, business.region].filter(Boolean).join(", ") || "location unknown"})
Style: ${OUTREACH_STYLES[style]}
Sender name: ${senderName?.trim() || "(none provided — sign as The Opportunity Radar team)"}

<website_content>
VERIFIED FACTS (cite by key in claims):
${verified.map((f) => `[${f.key}] ${factLabel(f.key)}: ${f.value}`).join("\n") || "(none)"}
NOT FOUND ON THE SITE (may be mentioned carefully as "I didn't see..."; cite by key):
${gaps.map((f) => `[${f.key}] ${factLabel(f.key)}`).join("\n") || "(none)"}
</website_content>

OPPORTUNITY TO RAISE (a hypothesis to explore with them, not a fact):
Title: ${opportunity.title}
Hypothesis: ${opportunity.problemHypothesis}
Possible solution: ${opportunity.proposedSolution}
Value mechanism: ${opportunity.expectedValue ?? "n/a"}
Suggested angle: ${opportunity.salesAngle ?? "n/a"}
Supporting fact keys: ${opportunity.supportingFactKeys.join(", ") || "(none — frame as a question)"}
Questions we would like answered: ${opportunity.validationQuestions.slice(0, 3).join(" | ")}

Write the email.`;
}

export interface OutreachOutcome {
  draft: { subject: string; body: string; claims: { text: string; factKeys: string[] }[] };
  warnings: string[];
  model: string;
  costUsd: number;
}

export async function generateOutreach(business: { id: string; name: string; city?: string | null; region?: string | null }, opportunity: OpportunityForOutreach, facts: FactForOutreach[], style: OutreachStyle, senderName?: string | null): Promise<OutreachOutcome> {
  const cfg = getConfig();
  const result = await callStructured({
    stage: "outreach",
    model: cfg.AI_OUTREACH_MODEL,
    effort: cfg.AI_OUTREACH_EFFORT,
    system: OUTREACH_SYSTEM,
    user: buildOutreachInput(business, opportunity, facts, style, senderName),
    schema: OutreachSchema,
    businessId: business.id,
    maxTokens: 4000,
  });
  const { draft, warnings } = validateOutreach(result.data, facts);
  return { draft, warnings, model: result.model, costUsd: result.usage.costUsd };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function validateOutreach(data: Outreach, facts: FactForOutreach[]): { draft: OutreachOutcome["draft"]; warnings: string[] } {
  const known = new Set(facts.filter((f) => f.status === "verified" || f.status === "not_found").map((f) => f.key));
  const warnings: string[] = [];
  const body = norm(data.body);
  const claims = data.claims.map((c) => {
    const keys = c.fact_keys.filter((k) => known.has(k));
    if (!keys.length) warnings.push(`Unsupported claim (no established fact): "${c.text.slice(0, 80)}"`);
    if (!body.includes(norm(c.text))) warnings.push(`Claim text not found verbatim in body: "${c.text.slice(0, 80)}"`);
    return { text: c.text, factKeys: keys };
  });
  if (/\[[^\]]{1,30}\]/.test(data.body)) warnings.push("Body contains a bracketed placeholder; edit before use");
  if (/\b\d{1,3}(\.\d+)?%|\$\s?\d/.test(data.body)) warnings.push("Body contains a percentage or dollar figure; verify it is not an invented statistic");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(data.body)) warnings.push("Body contains an email address; verify it comes from a verified fact");
  const words = data.body.trim().split(/\s+/).length;
  if (words > 220) warnings.push(`Body is long (${words} words); consider trimming`);
  return { draft: { subject: data.subject, body: data.body, claims }, warnings };
}
