import { z } from "zod";
import { OPPORTUNITY_CATEGORY_KEYS } from "@/lib/industries";
import { FACT_KEYS } from "@/lib/profile/fields";

const Rating = z.number().int().min(1).max(5);

export const FactOutput = z.object({
  key: z.enum(FACT_KEYS as [string, ...string[]]),
  status: z.enum(["verified", "not_found"]).describe("verified = the pages state it (give the quote); not_found = you looked and the pages do not establish it."),
  value: z.string().describe("The fact as a short value. Empty string when not_found."),
  evidence_quote: z.string().describe("Verbatim quote copied exactly from the page text (max ~250 chars). Empty when not_found."),
  source_url: z.string().describe("URL of the page the quote came from, exactly as given. Empty when not_found."),
});

export const OpportunitySchema = z.object({
  category: z.enum(OPPORTUNITY_CATEGORY_KEYS as [string, ...string[]]),
  title: z.string(),
  problem_hypothesis: z.string().describe("The operational problem we hypothesize, phrased as a hypothesis, not a fact."),
  proposed_solution: z.string().describe("Concrete software/automation we could build or integrate."),
  why_not_existing_tool: z.string().describe("Why an off-the-shelf tool or a process change is not clearly the better answer, or say that it might be."),
  expected_value: z.string().describe("Plausible value mechanism, without invented numbers."),
  supporting_fact_keys: z.array(z.string()).describe("Profile fact keys (verified or not_found) that support this hypothesis."),
  assumptions: z.array(z.string()),
  validation_questions: z.array(z.string()),
  implementation_effort: z.enum(["small", "medium", "large"]),
  reusability: z.enum(["low", "medium", "high"]),
  risks: z.array(z.string()),
  sales_angle: z.string().describe("How to open a conversation about this, grounded in verified facts."),
  ratings: z.object({
    value: Rating,
    feasibility: Rating,
    evidence_strength: Rating,
    buying_readiness: Rating,
  }),
});

export const InvestigationSchema = z.object({
  facts: z.array(FactOutput).describe("One entry per profile field you can assess from the pages. Skip fields you cannot assess."),
  workflows: z.array(z.object({ name: z.string(), fact_keys: z.array(z.string()) })).describe("Customer-facing workflows the site documents, each citing fact keys."),
  opportunities: z.array(OpportunitySchema).max(3),
  verdict: z.enum(["opportunity", "no_opportunity"]),
  verdict_reason: z.string(),
});
export type Investigation = z.infer<typeof InvestigationSchema>;

export const OutreachSchema = z.object({
  subject: z.string(),
  body: z.string().describe("The full message body, plain text, 90-170 words, no placeholders like [Name]."),
  claims: z
    .array(z.object({ text: z.string().describe("A phrase copied exactly from the body that makes a company-specific claim."), fact_keys: z.array(z.string()) }))
    .describe("Every company-specific claim in the body, mapped to the verified fact keys that support it."),
});
export type Outreach = z.infer<typeof OutreachSchema>;
