import { z } from "zod";
import { OPPORTUNITY_CATEGORY_KEYS, SOLUTION_SCOPE_KEYS } from "@/lib/industries";
import { FACT_KEYS } from "@/lib/profile/fields";

/**
 * Size and range limits are stated in the descriptions and enforced in code after the call (ratings are clamped,
 * lists are cut). They are not Zod constraints on purpose: the API's schema format does not carry them, so a strict
 * local check would throw away a whole paid answer because a list came back one item too long.
 */
const Rating = z.number().describe("An integer from 1 (lowest) to 5 (highest).");

export const FactOutput = z.object({
  key: z.enum(FACT_KEYS as [string, ...string[]]),
  status: z.enum(["verified", "not_found"]).describe("verified = the pages state it (give the quote); not_found = you looked and the pages do not establish it."),
  value: z.string().describe("The fact as a short value. Empty string when not_found."),
  evidence_quote: z.string().describe("Verbatim quote copied exactly from the page text (max ~250 chars). Empty when not_found."),
  source_url: z.string().describe("URL of the page the quote came from, exactly as given. Empty when not_found."),
});

export const OBSERVATION_KINDS = ["offering", "process", "capability", "limitation"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export const ObservationOutput = z.object({
  ref: z.string().describe('Short id you assign: "o1", "o2", ... Opportunities cite it.'),
  kind: z.enum(OBSERVATION_KINDS).describe("offering = something they sell or do; process = how something works for the customer; capability = something customers can do online; limitation = a manual or restricted step the page itself states."),
  statement: z.string().describe("One plain sentence stating what the page shows."),
  evidence_quote: z.string().describe("Verbatim quote copied exactly from the page text (max ~250 chars)."),
  source_url: z.string().describe("URL of the page the quote came from, exactly as given."),
});

export const ComponentSchema = z.object({
  name: z.string().describe("Short name of this part of the solution."),
  description: z.string().describe("What it does for this business, in one or two sentences."),
  evidence: z.array(z.string()).describe("Profile fact keys and observation refs that motivate this part."),
});

export const OpportunitySchema = z.object({
  role: z.enum(["primary", "secondary"]).describe("primary = the one consolidated solution to propose; secondary = a genuinely independent idea."),
  category: z.enum(OPPORTUNITY_CATEGORY_KEYS as [string, ...string[]]),
  scope: z.enum(SOLUTION_SCOPE_KEYS as [string, ...string[]]).describe("existing = improves something the pages show they already offer; new_for_customers = something their customers could use that the pages do not show; internal = a tool for the people who work in the business."),
  title: z.string().describe("The outcome in everyday words an owner would use, e.g. 'Estimates that follow themselves up'. No product names, no jargon."),
  problem_hypothesis: z.string().describe("The business challenge we hypothesize, phrased as a hypothesis, not a fact."),
  proposed_solution: z.string().describe("What we could build: first the small first version (useful on its own, a few weeks of work for one developer), then one sentence on what it could grow into."),
  why_relevant: z.string().describe("Why this fits this specific business, referring to what was observed about it."),
  components: z.array(ComponentSchema).describe("The parts of the solution, two to five. Empty only when the idea is a single thing."),
  why_not_existing_tool: z.string().describe("Why an off-the-shelf tool or a process change is not clearly the better answer, or say that it might be."),
  expected_value: z.string().describe("Plausible value mechanism, without invented numbers."),
  supporting_fact_keys: z.array(z.string()).describe("Profile fact keys (verified or not_found) and observation refs that support this hypothesis as a whole."),
  assumptions: z.array(z.string()),
  validation_questions: z.array(z.string()),
  implementation_effort: z.enum(["small", "medium", "large"]),
  reusability: z.enum(["low", "medium", "high"]),
  risks: z.array(z.string()),
  sales_angle: z.string().describe("The idea as you would say it to the owner in two friendly sentences: what you noticed (verified things only) and what would get easier for them. Everyday words, no feature list, no technical terms, never a claim that they lack something."),
  ratings: z.object({
    value: Rating,
    feasibility: Rating,
    evidence_strength: Rating,
  }),
});
export type OpportunityOutput = z.infer<typeof OpportunitySchema>;

export const InvestigationSchema = z.object({
  facts: z.array(FactOutput).describe("One entry per profile field you can assess from the pages. Skip fields you cannot assess."),
  observations: z.array(ObservationOutput).describe("At most 10 things the pages show that the profile fields do not capture, each with a verbatim quote."),
  opportunities: z.array(OpportunitySchema).describe("At most one primary and two secondary. Empty when the verdict is no_opportunity."),
  verdict: z.enum(["opportunity", "no_opportunity"]),
  verdict_reason: z.string(),
});
export type Investigation = z.infer<typeof InvestigationSchema>;

export const OutreachSchema = z.object({
  subject: z.string(),
  body: z.string().describe("The full message body, plain text, no placeholders like [Name], no signature block beyond the sender's first name."),
  claims: z
    .array(z.object({ text: z.string().describe("A phrase copied exactly from the body that makes a company-specific claim."), fact_keys: z.array(z.string()).describe("Fact keys or observation refs that support it.") }))
    .describe("Every company-specific claim in the body, mapped to the evidence that supports it."),
});
export type Outreach = z.infer<typeof OutreachSchema>;

export const SubjectsSchema = z.object({
  subjects: z.array(z.string()).describe("Five alternative subject lines, each two to five words, clearly different from each other."),
});

export const EmailCheckSchema = z.object({
  statements: z
    .array(
      z.object({
        text: z.string().describe("The statement, copied from the email."),
        verdict: z.enum(["supported", "hypothesis", "unsupported"]),
        evidence: z.array(z.string()).describe("Refs from the evidence pack that support it. Empty unless supported."),
        note: z.string().describe("Why, in a few words. Empty when supported."),
      }),
    )
    .describe("Every statement the email makes about the recipient business."),
  tone_problems: z.array(z.string()).describe("Tone problems, one short phrase each. Empty when there are none."),
});
export type EmailCheck = z.infer<typeof EmailCheckSchema>;

export const REPLY_CATEGORIES = ["wants_meeting", "interested", "wants_info", "not_now", "declined", "unsubscribe", "wrong_person", "other"] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

export const ReplySchema = z.object({
  category: z.enum(REPLY_CATEGORIES),
  confidence: z.number().describe("From 0 (a guess) to 1 (certain)."),
  summary: z.string().describe("One neutral sentence on what they said."),
  suggested_reply: z.string().describe("A short answer in the sender's voice, or an empty string."),
});
export type ReplyClassification = z.infer<typeof ReplySchema>;
