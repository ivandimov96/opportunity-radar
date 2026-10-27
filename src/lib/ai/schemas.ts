import { z } from "zod";
import { OPPORTUNITY_CATEGORY_KEYS } from "@/lib/industries";

export const OBSERVATION_CATEGORIES = ["services", "booking", "pricing", "contact", "tools", "hours", "team", "reviews", "payments", "customers", "other"] as const;

export const ExtractionSchema = z.object({
  observations: z
    .array(
      z.object({
        category: z.enum(OBSERVATION_CATEGORIES),
        statement: z.string().describe("One factual sentence about the business, stated neutrally."),
        evidence_quote: z.string().describe("Verbatim quote (max ~300 chars) copied exactly from the page text that supports the statement."),
        source_url: z.string().describe("URL of the page the quote came from, exactly as given."),
      }),
    )
    .describe("Facts directly supported by the page text."),
  unknowns: z
    .array(z.object({ topic: z.string(), note: z.string() }))
    .describe("Operationally relevant things the pages do NOT establish (e.g. what scheduling software they use)."),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const Rating = z.number().int().min(1).max(5);

export const OpportunitySchema = z.object({
  category: z.enum(OPPORTUNITY_CATEGORY_KEYS as [string, ...string[]]),
  title: z.string(),
  problem_hypothesis: z.string().describe("The operational problem we hypothesize, phrased as a hypothesis, not a fact."),
  proposed_solution: z.string().describe("Concrete software/automation we could build or integrate."),
  why_not_existing_tool: z.string().describe("Why an off-the-shelf tool or a simple process change is not clearly the better answer, or state that it might be."),
  expected_value: z.string().describe("Plausible value mechanism, without invented numbers."),
  supporting_observation_ids: z.array(z.string()).describe("IDs of verified observations that support this hypothesis. Empty if none."),
  assumptions: z.array(z.string()).describe("What we are assuming that the public information does not confirm."),
  validation_questions: z.array(z.string()).describe("Questions to ask the business to confirm or reject the hypothesis."),
  implementation_effort: z.enum(["small", "medium", "large"]),
  reusability: z.enum(["low", "medium", "high"]),
  risks: z.array(z.string()),
  sales_angle: z.string().describe("How to open a conversation about this, grounded in verified observations."),
  ratings: z.object({
    value: Rating.describe("Potential business value if the hypothesis holds, 1-5"),
    feasibility: Rating.describe("How realistic it is to build and adopt, 1-5"),
    evidence_strength: Rating.describe("How strongly verified observations support the hypothesis, 1-5"),
    buying_readiness: Rating.describe("Signals that the business invests in tools/marketing/growth, 1-5"),
  }),
});

export const AnalysisSchema = z.object({
  company_summary: z.string().describe("2-4 sentences on what the company actually does, based only on verified observations."),
  documented_workflows: z.array(z.object({ name: z.string(), observation_ids: z.array(z.string()) })).describe("Workflows that the public information documents, each citing observation IDs."),
  industry_workflows_considered: z.array(z.string()),
  existing_tools_detected: z.array(z.string()).describe("Software/tools verified from observations; empty if none."),
  opportunities: z.array(OpportunitySchema).max(4),
  no_compelling_opportunity: z.boolean().describe("True when the evidence does not support a commercially compelling software opportunity."),
  no_opportunity_reason: z.string().describe("Explain when no_compelling_opportunity is true; otherwise empty string."),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const OutreachSchema = z.object({
  subject: z.string(),
  body: z.string().describe("The full message body, plain text, 90-170 words, no placeholders like [Name]."),
  claims: z
    .array(z.object({ text: z.string().describe("A phrase copied exactly from the body that makes a company-specific claim."), observation_ids: z.array(z.string()) }))
    .describe("Every company-specific claim in the body, mapped to the verified observation IDs that support it."),
});
export type Outreach = z.infer<typeof OutreachSchema>;
