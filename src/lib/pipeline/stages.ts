/** Sales pipeline: what WE do with a business after investigation. Investigation state lives on businesses.status. */
export const PIPELINE_STAGES = [
  { key: "lead", label: "Lead" },
  { key: "qualified", label: "Qualified" },
  { key: "contacted", label: "Contacted" },
  { key: "in_conversation", label: "In conversation" },
  { key: "validated", label: "Problem validated" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "disqualified", label: "Disqualified" },
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number]["key"];
export const PIPELINE_STAGE_KEYS = PIPELINE_STAGES.map((s) => s.key) as PipelineStage[];
export const stageLabel = (key: string) => PIPELINE_STAGES.find((s) => s.key === key)?.label ?? key;
export const CONTACTED_STAGES: PipelineStage[] = ["contacted", "in_conversation", "validated", "won", "lost"];

export const VALIDATION_SIGNALS = [
  { key: "conversation", label: "Had a conversation" },
  { key: "confirmed_problem", label: "Problem confirmed by the business" },
  { key: "rejected", label: "Hypothesis rejected by the business" },
  { key: "pilot", label: "Pilot agreed" },
  { key: "paying", label: "Paying customer" },
] as const;
export type ValidationSignalType = (typeof VALIDATION_SIGNALS)[number]["key"];

export const BUSINESS_STATUSES = ["new", "queued", "investigating", "profiled", "failed", "no_website"] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];
export const VERDICTS = ["opportunity", "no_opportunity", "needs_ai", "insufficient_evidence"] as const;
export type Verdict = (typeof VERDICTS)[number];
