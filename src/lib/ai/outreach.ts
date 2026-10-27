/**
 * Outreach stage: produces a draft whose company-specific claims are mapped to
 * verified observations. Claims that cite nothing, or that do not appear in
 * the body, become warnings for the human reviewer. Nothing is ever sent.
 */
import { getConfig } from "@/lib/config";
import { callStructured } from "./client";
import { OUTREACH_STYLES, OUTREACH_SYSTEM, type OutreachStyle } from "./prompts";
import { OutreachSchema, type Outreach } from "./schemas";
import type { ObservationForAnalysis } from "./analyze";

export interface OpportunityForOutreach {
  title: string;
  category: string;
  problemHypothesis: string;
  proposedSolution: string;
  expectedValue?: string | null;
  salesAngle?: string | null;
  supportingObservationIds: string[];
  validationQuestions: string[];
}

export function buildOutreachInput(business: { name: string; city?: string | null; region?: string | null }, opportunity: OpportunityForOutreach, observations: ObservationForAnalysis[], style: OutreachStyle, senderName?: string | null) {
  const verified = observations.filter((o) => o.kind === "verified");
  return `Recipient business: ${business.name} (${[business.city, business.region].filter(Boolean).join(", ") || "location unknown"})
Style: ${OUTREACH_STYLES[style]}
Sender name: ${senderName?.trim() || "(none provided — sign as The Opportunity Radar team)"}

<website_content>
VERIFIED OBSERVATIONS (cite by ID in claims):
${verified.map((o) => `[${o.id}] ${o.statement}`).join("\n") || "(none)"}
</website_content>

OPPORTUNITY TO RAISE (a hypothesis to explore with them, not a fact):
Title: ${opportunity.title}
Hypothesis: ${opportunity.problemHypothesis}
Possible solution: ${opportunity.proposedSolution}
Value mechanism: ${opportunity.expectedValue ?? "n/a"}
Suggested angle: ${opportunity.salesAngle ?? "n/a"}
Observations that support it: ${opportunity.supportingObservationIds.join(", ") || "(none — be especially careful to frame as a question)"}
Questions we would like answered: ${opportunity.validationQuestions.slice(0, 3).join(" | ")}

Write the email.`;
}

export interface OutreachOutcome {
  draft: Outreach;
  warnings: string[];
  model: string;
  costUsd: number;
}

export async function generateOutreach(business: { id: string; name: string; city?: string | null; region?: string | null }, opportunity: OpportunityForOutreach, observations: ObservationForAnalysis[], style: OutreachStyle, senderName?: string | null): Promise<OutreachOutcome> {
  const cfg = getConfig();
  const result = await callStructured({
    stage: "outreach",
    model: cfg.AI_OUTREACH_MODEL,
    effort: cfg.AI_OUTREACH_EFFORT,
    system: OUTREACH_SYSTEM,
    user: buildOutreachInput(business, opportunity, observations, style, senderName),
    schema: OutreachSchema,
    businessId: business.id,
    maxTokens: 4000,
  });
  const { draft, warnings } = validateOutreach(result.data, observations);
  return { draft, warnings, model: result.model, costUsd: result.usage.costUsd };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function validateOutreach(data: Outreach, observations: ObservationForAnalysis[]): { draft: Outreach; warnings: string[] } {
  const valid = new Set(observations.filter((o) => o.kind === "verified").map((o) => o.id));
  const warnings: string[] = [];
  const body = norm(data.body);
  const claims = data.claims.map((c) => {
    const ids = c.observation_ids.filter((id) => valid.has(id));
    if (!ids.length) warnings.push(`Unsupported claim (no verified observation): "${c.text.slice(0, 80)}"`);
    if (!body.includes(norm(c.text))) warnings.push(`Claim text not found verbatim in body: "${c.text.slice(0, 80)}"`);
    return { text: c.text, observation_ids: ids };
  });
  if (/\[[^\]]{1,30}\]/.test(data.body)) warnings.push("Body contains a bracketed placeholder; edit before use");
  if (/\b\d{1,3}(\.\d+)?%|\$\s?\d/.test(data.body)) warnings.push("Body contains a percentage or dollar figure; verify it is not an invented statistic");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(data.body)) warnings.push("Body contains an email address; verify it comes from a verified observation");
  const words = data.body.trim().split(/\s+/).length;
  if (words > 220) warnings.push(`Body is long (${words} words); consider trimming`);
  return { draft: { ...data, claims }, warnings };
}
