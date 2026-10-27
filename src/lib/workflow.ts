/**
 * The guided workflow: one investigation status + one sales stage per business,
 * and a single recommended next action. Pages render this instead of inventing
 * their own logic.
 */
import type { businesses } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { CONTACTED_STAGES, type PipelineStage } from "@/lib/pipeline/stages";

export type BusinessLike = Pick<typeof businesses.$inferSelect, "id" | "website" | "status" | "verdict" | "isDemo">;

export interface WorkflowInput {
  business: BusinessLike;
  stage: string;
  opportunityCount: number;
  draftCount: number;
  busy?: boolean;
}

export type StepState = "done" | "active" | "todo" | "failed" | "skipped";
export interface WorkflowStep {
  key: "found" | "investigated" | "outreach" | "conversation";
  label: string;
  state: StepState;
  hint?: string;
}

export type NextActionKind = "investigate" | "retry" | "draft" | "review_draft" | "follow_up" | "needs_key" | "no_website" | "no_opportunity" | "wait" | "demo" | "done";
export interface NextAction {
  kind: NextActionKind;
  title: string;
  description: string;
  tone: "accent" | "ok" | "warn" | "neutral" | "info";
}

export function deriveWorkflow(input: WorkflowInput): { steps: WorkflowStep[]; next: NextAction } {
  const { business: b, stage, opportunityCount, draftCount } = input;
  const ai = getConfig().ai.enabled;
  const contacted = CONTACTED_STAGES.includes(stage as PipelineStage);
  const busy = Boolean(input.busy) || b.status === "queued" || b.status === "investigating";
  const profiled = b.status === "profiled";

  const steps: WorkflowStep[] = [
    { key: "found", label: "Found", state: "done" },
    {
      key: "investigated",
      label: "Investigated",
      state: profiled ? "done" : busy ? "active" : b.status === "failed" ? "failed" : b.status === "no_website" ? "skipped" : "todo",
      hint: b.status === "no_website" ? "No website" : b.status === "failed" ? "Failed" : profiled ? (b.verdict === "opportunity" ? `${opportunityCount} hypothesis${opportunityCount === 1 ? "" : "es"}` : b.verdict === "no_opportunity" ? "No opportunity" : "AI pending") : undefined,
    },
    { key: "outreach", label: "Outreach", state: draftCount > 0 ? "done" : contacted ? "skipped" : "todo", hint: draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"}` : undefined },
    { key: "conversation", label: "In conversation", state: contacted ? "done" : "todo", hint: contacted ? stage.replace(/_/g, " ") : undefined },
  ];

  let next: NextAction;
  if (busy) next = { kind: "wait", title: "Investigating in the background", description: "Fetching the website, building the profile and analyzing opportunities. This page refreshes automatically.", tone: "info" };
  else if (contacted) next = { kind: "follow_up", title: "Keep the conversation moving", description: "Log what you learned, record validation signals, and set the next action.", tone: "ok" };
  else if (b.isDemo) next = { kind: "demo", title: "Synthetic demo record", description: "Explore the profile, opportunities and the outreach editor. Live investigation is disabled for demo data.", tone: "neutral" };
  else if (!b.website) next = { kind: "no_website", title: "No website to investigate", description: "Add the website below, or research this business by hand and record notes.", tone: "warn" };
  else if (b.status === "failed") next = { kind: "retry", title: "Investigation failed — retry or fix the website", description: "The website could not be fetched. Retry, or correct the URL below.", tone: "warn" };
  else if (!profiled) next = { kind: "investigate", title: "Investigate this business", description: "Fetch the website, build the profile and analyze opportunities in one step.", tone: "accent" };
  else if (b.verdict === "needs_ai") next = { kind: "needs_key", title: "Profile ready — AI analysis needs an API key", description: "Detected facts are in. Set ANTHROPIC_API_KEY to get the full profile, opportunity hypotheses and drafts.", tone: "warn" };
  else if (b.verdict === "no_opportunity") next = { kind: "no_opportunity", title: "No compelling opportunity", description: "The evidence does not support a software opportunity. Disqualify, or re-investigate later if the website changes.", tone: "neutral" };
  else if (opportunityCount > 0 && draftCount === 0) next = ai ? { kind: "draft", title: "Draft a personalized outreach", description: "Turn the top opportunity into a short, fact-mapped email for your review.", tone: "accent" } : { kind: "needs_key", title: "Outreach drafting needs an API key", description: "Set ANTHROPIC_API_KEY to generate drafts, or write one manually from the profile.", tone: "warn" };
  else if (draftCount > 0) next = { kind: "review_draft", title: "Review the draft and reach out", description: "Edit, approve, send it from your own email, then log the contact here.", tone: "ok" };
  else next = { kind: "done", title: "Up to date", description: "Nothing pending for this business.", tone: "neutral" };
  return { steps, next };
}

export function defaultTabFor(next: NextActionKind): string {
  switch (next) {
    case "draft":
      return "opportunities";
    case "review_draft":
      return "outreach";
    case "follow_up":
      return "activity";
    default:
      return "profile";
  }
}
