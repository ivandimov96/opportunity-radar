/**
 * The pipeline: one stage per business, from discovery to the outcome.
 * The first four stages are set by the system (research, qualification, a
 * validated email ready for review); "contacted" and "replied" follow from
 * sending and from incoming mail; the rest are the operator's decisions.
 */
export const PIPELINE_STAGES = [
  { key: "discovered", label: "Discovered" },
  { key: "researching", label: "Researching" },
  { key: "qualified", label: "Qualified" },
  { key: "ready_to_contact", label: "Ready to contact" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "meeting_scheduled", label: "Meeting scheduled" },
  { key: "proposal_sent", label: "Proposal sent" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number]["key"];
export const PIPELINE_STAGE_KEYS = PIPELINE_STAGES.map((s) => s.key) as PipelineStage[];
export const stageLabel = (key: string) => PIPELINE_STAGES.find((s) => s.key === key)?.label ?? key.replace(/_/g, " ");
/** From first contact on: research and automatic drafting no longer move these. */
export const CONTACTED_STAGES: PipelineStage[] = ["contacted", "replied", "meeting_scheduled", "proposal_sent", "won", "lost"];
/** Machine states that can hold hundreds of businesses; the board shows them as counters, not columns. */
export const MACHINE_STAGES: PipelineStage[] = ["discovered", "researching"];
/** Stages the system manages before first contact; research can move a business back out of them. */
export const PRE_CONTACT_STAGES: PipelineStage[] = ["researching", "qualified", "ready_to_contact"];

export const BUSINESS_STATUSES = ["new", "queued", "investigating", "profiled", "failed", "no_website"] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];
/**
 * The qualification outcome of an investigation (businesses.verdict):
 *  qualified: a consolidated opportunity backed by enough verified evidence
 *  needs_review: something is there but uncertain (thin support, rules only, a contradiction)
 *  not_a_fit: no convincing opportunity (the model's "no" is final)
 *  insufficient_evidence: the site did not show enough to assess
 *  no_contact: research stopped because no public email was found
 */
export const VERDICTS = ["qualified", "needs_review", "not_a_fit", "insufficient_evidence", "no_contact"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_LABELS: Record<Verdict, string> = { qualified: "Qualified", needs_review: "Needs review", not_a_fit: "Not a fit", insufficient_evidence: "Insufficient evidence", no_contact: "No public email" };
export const verdictLabel = (v: string | null | undefined) => (v ? (VERDICT_LABELS[v as Verdict] ?? v.replace(/_/g, " ")) : "");
