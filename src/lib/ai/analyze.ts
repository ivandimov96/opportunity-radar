/**
 * Analysis stage: verified observations + industry playbook -> opportunities.
 * Citations are validated against real observation IDs; invalid IDs are
 * dropped and recorded as warnings. Scoring is computed in code afterwards.
 */
import { getConfig } from "@/lib/config";
import { getPlaybook, OPPORTUNITY_CATEGORY_KEYS, type OpportunityCategory } from "@/lib/industries";
import { callStructured } from "./client";
import { analysisSystem } from "./prompts";
import { AnalysisSchema, type Analysis } from "./schemas";

export interface ObservationForAnalysis {
  id: string;
  kind: "verified" | "unknown";
  category: string;
  statement: string;
  evidenceQuote?: string | null;
  sourceUrl?: string | null;
}

export function buildAnalysisInput(business: { name: string; website?: string | null; city?: string | null; region?: string | null; category?: string | null }, observations: ObservationForAnalysis[]) {
  const verified = observations.filter((o) => o.kind === "verified");
  const unknowns = observations.filter((o) => o.kind === "unknown");
  const lines = verified.map((o) => `[${o.id}] (${o.category}) ${o.statement}\n    evidence: "${(o.evidenceQuote ?? "").slice(0, 200)}" — ${o.sourceUrl ?? "n/a"}`);
  const unk = unknowns.map((o) => `- ${o.statement}`);
  return `Business: ${business.name}${business.category ? ` (${business.category})` : ""}
Location: ${[business.city, business.region].filter(Boolean).join(", ") || "unknown"}
Website: ${business.website ?? "none"}

<website_content>
VERIFIED OBSERVATIONS (cite by ID):
${lines.length ? lines.join("\n") : "(none)"}

UNKNOWNS (not established by public information):
${unk.length ? unk.join("\n") : "(none recorded)"}
</website_content>

Analyze this business and return the structured assessment.`;
}

export interface AnalysisOutcome {
  analysis: Analysis;
  warnings: string[];
  model: string;
  costUsd: number;
}

export async function analyzeBusiness(business: { id: string; name: string; industry: string; website?: string | null; city?: string | null; region?: string | null; category?: string | null }, observations: ObservationForAnalysis[]): Promise<AnalysisOutcome> {
  const cfg = getConfig();
  const playbook = getPlaybook(business.industry);
  const result = await callStructured({
    stage: "analysis",
    model: cfg.AI_ANALYSIS_MODEL,
    effort: cfg.AI_ANALYSIS_EFFORT,
    system: analysisSystem(playbook),
    user: buildAnalysisInput(business, observations),
    schema: AnalysisSchema,
    businessId: business.id,
  });
  const { analysis, warnings } = validateAnalysis(result.data, observations);
  return { analysis, warnings, model: result.model, costUsd: result.usage.costUsd };
}

export function validateAnalysis(data: Analysis, observations: ObservationForAnalysis[]): { analysis: Analysis; warnings: string[] } {
  const valid = new Set(observations.filter((o) => o.kind === "verified").map((o) => o.id));
  const warnings: string[] = [];
  const filterIds = (ids: string[], ctx: string) => {
    const ok = ids.filter((id) => valid.has(id));
    const bad = ids.length - ok.length;
    if (bad > 0) warnings.push(`${ctx}: dropped ${bad} citation(s) to unknown observation IDs`);
    return [...new Set(ok)];
  };
  const opportunities = data.opportunities.map((o, i) => {
    const category = (OPPORTUNITY_CATEGORY_KEYS as string[]).includes(o.category) ? (o.category as OpportunityCategory) : "other";
    if (category !== o.category) warnings.push(`Opportunity ${i + 1}: unknown category "${o.category}" mapped to "other"`);
    const supporting = filterIds(o.supporting_observation_ids, `Opportunity ${i + 1}`);
    let ratings = o.ratings;
    if (!supporting.length && ratings.evidence_strength > 2) {
      warnings.push(`Opportunity ${i + 1}: evidence_strength lowered to 2 because no verified observation supports it`);
      ratings = { ...ratings, evidence_strength: 2 };
    }
    return { ...o, category, supporting_observation_ids: supporting, ratings };
  });
  const documented_workflows = data.documented_workflows.map((w) => ({ ...w, observation_ids: filterIds(w.observation_ids, `Workflow "${w.name}"`) }));
  let no_compelling_opportunity = data.no_compelling_opportunity;
  if (!opportunities.length && !no_compelling_opportunity) {
    no_compelling_opportunity = true;
    warnings.push("Model returned no opportunities; recorded as insufficient evidence");
  }
  return { analysis: { ...data, opportunities, documented_workflows, no_compelling_opportunity }, warnings };
}
