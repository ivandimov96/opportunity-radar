/**
 * The guided workflow: derives, for one business, its step states and the
 * single recommended next action. Pages render this instead of inventing
 * their own logic, so the funnel reads the same everywhere.
 */
import type { businesses } from "@/db/schema";
import { getConfig } from "@/lib/config";

export type BusinessLike = Pick<typeof businesses.$inferSelect, "id" | "website" | "researchStatus" | "analysisStatus" | "isDemo">;

export interface WorkflowInput {
  business: BusinessLike;
  stage: string; // pipeline stage
  opportunityCount: number;
  draftCount: number;
  approvedDraftCount?: number;
  busy?: boolean;
}

export type StepState = "done" | "active" | "todo" | "failed" | "skipped";
export interface WorkflowStep {
  key: "discovered" | "researched" | "analyzed" | "outreach" | "contacted";
  label: string;
  state: StepState;
  hint?: string;
}

export type NextActionKind = "research" | "retry_research" | "analyze" | "draft" | "review_draft" | "contact" | "follow_up" | "needs_key" | "no_website" | "done" | "wait" | "demo";

export interface NextAction {
  kind: NextActionKind;
  title: string;
  description: string;
  tone: "accent" | "ok" | "warn" | "neutral" | "info";
}

const LATER = ["contacted", "in_conversation", "validated", "won", "lost", "disqualified"];

export function deriveWorkflow(input: WorkflowInput): { steps: WorkflowStep[]; next: NextAction } {
  const { business: b, stage, opportunityCount, draftCount } = input;
  const cfg = getConfig();
  const ai = cfg.ai.enabled;
  const contacted = LATER.includes(stage);
  const researched = b.researchStatus === "done";
  const researchActive = b.researchStatus === "queued" || b.researchStatus === "running";
  const analysisActive = b.analysisStatus === "queued" || b.analysisStatus === "running";
  const analyzed = b.analysisStatus === "done" || b.analysisStatus === "insufficient_evidence";

  const steps: WorkflowStep[] = [
    { key: "discovered", label: "Discovered", state: "done" },
    {
      key: "researched",
      label: "Researched",
      state: researched ? "done" : researchActive ? "active" : b.researchStatus === "failed" ? "failed" : b.researchStatus === "no_website" ? "skipped" : "todo",
      hint: b.researchStatus === "no_website" ? "No website" : b.researchStatus === "failed" ? "Fetch failed" : undefined,
    },
    {
      key: "analyzed",
      label: "Analyzed",
      state: analyzed ? "done" : analysisActive ? "active" : b.analysisStatus === "failed" ? "failed" : "todo",
      hint: b.analysisStatus === "insufficient_evidence" ? "Insufficient evidence" : opportunityCount ? `${opportunityCount} hypothes${opportunityCount === 1 ? "is" : "es"}` : undefined,
    },
    { key: "outreach", label: "Outreach", state: draftCount > 0 ? "done" : contacted ? "skipped" : "todo", hint: draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"}` : undefined },
    { key: "contacted", label: "In conversation", state: contacted ? "done" : "todo", hint: contacted ? stage.replace(/_/g, " ") : undefined },
  ];

  let next: NextAction;
  if (input.busy || researchActive || analysisActive) {
    next = { kind: "wait", title: "Working in the background", description: "This page refreshes automatically while research or analysis runs.", tone: "info" };
  } else if (contacted) {
    next = { kind: "follow_up", title: "Keep the conversation moving", description: "Log what you learned, record validation signals, and set the next action.", tone: "ok" };
  } else if (b.isDemo) {
    next = { kind: "demo", title: "Synthetic demo record", description: "Explore findings, opportunities and the outreach editor. Live research is disabled for demo data.", tone: "neutral" };
  } else if (!b.website) {
    next = { kind: "no_website", title: "No website to research", description: "Add a website via CSV import or research this business manually, then record notes.", tone: "warn" };
  } else if (b.researchStatus === "failed") {
    next = { kind: "retry_research", title: "Research failed — retry or check the URL", description: "The website could not be fetched. Retry, or fix the website on the record if the link is wrong.", tone: "warn" };
  } else if (!researched) {
    next = { kind: "research", title: "Research the website", description: "Fetch up to six public pages and extract verified, source-backed observations.", tone: "accent" };
  } else if (!analyzed) {
    next = ai
      ? { kind: "analyze", title: "Analyze opportunities", description: "Reason over the verified findings to produce opportunity hypotheses with scores, or conclude the evidence is insufficient.", tone: "accent" }
      : { kind: "needs_key", title: "Analysis needs an Anthropic API key", description: "Findings are ready. Set ANTHROPIC_API_KEY in .env to enable AI analysis and outreach drafting.", tone: "warn" };
  } else if (b.analysisStatus === "insufficient_evidence") {
    next = { kind: "done", title: "No compelling opportunity found", description: "The evidence does not support a software opportunity. Disqualify, or re-research later if the website changes.", tone: "neutral" };
  } else if (opportunityCount > 0 && draftCount === 0) {
    next = ai
      ? { kind: "draft", title: "Draft a personalized outreach", description: "Turn the top opportunity into a short, evidence-mapped email for your review.", tone: "accent" }
      : { kind: "needs_key", title: "Outreach drafting needs an Anthropic API key", description: "Set ANTHROPIC_API_KEY to generate drafts, or write one manually from the findings.", tone: "warn" };
  } else if (draftCount > 0) {
    next = { kind: "review_draft", title: "Review the draft and reach out", description: "Edit, approve, then send it yourself from your own email. Mark the business as contacted afterwards.", tone: "ok" };
  } else {
    next = { kind: "done", title: "Up to date", description: "Nothing pending for this business.", tone: "neutral" };
  }
  return { steps, next };
}

/** Tab the operator most likely wants given the state. */
export function defaultTabFor(next: NextActionKind): string {
  switch (next) {
    case "research":
    case "retry_research":
    case "no_website":
      return "overview";
    case "analyze":
    case "needs_key":
      return "findings";
    case "draft":
      return "opportunities";
    case "review_draft":
      return "outreach";
    case "follow_up":
      return "activity";
    default:
      return "overview";
  }
}
