/**
 * The guided workflow: one research status, one qualification outcome and one
 * pipeline stage per business, and a single recommended next action. Pages
 * render this instead of inventing their own logic.
 */
import type { businesses } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { CONTACTED_STAGES, stageLabel, verdictLabel, type PipelineStage } from "@/lib/pipeline/stages";

export type BusinessLike = Pick<typeof businesses.$inferSelect, "id" | "website" | "status" | "verdict"> & Partial<Pick<typeof businesses.$inferSelect, "kind" | "leadScore" | "statusMessage" | "email">>;

export interface WorkflowInput {
  business: BusinessLike;
  stage: string;
  opportunityCount: number;
  /** Emails that exist for the business (archived ones excluded). */
  draftCount: number;
  /** Status of the email that matters now (the newest one that is not archived), when known. */
  draftStatus?: string | null;
  /** Replies from a person that have no answer logged yet. */
  openReplies?: number;
  busy?: boolean;
}

export type StepState = "done" | "active" | "todo" | "failed" | "skipped";
export interface WorkflowStep {
  key: "found" | "researched" | "email" | "contacted" | "replied";
  label: string;
  state: StepState;
  hint?: string;
}

export type NextActionKind = "investigate" | "retry" | "no_website" | "add_email" | "review_research" | "not_a_fit" | "write_email" | "review_email" | "send" | "await_reply" | "answer" | "wait" | "done";
export interface NextAction {
  kind: NextActionKind;
  title: string;
  description: string;
  tone: "accent" | "ok" | "warn" | "neutral" | "info";
}

export function deriveWorkflow(input: WorkflowInput): { steps: WorkflowStep[]; next: NextAction } {
  const { business: b, stage, draftCount } = input;
  const ai = getConfig().ai.enabled;
  const contacted = CONTACTED_STAGES.includes(stage as PipelineStage);
  const replied = contacted && stage !== "contacted";
  const busy = Boolean(input.busy) || b.status === "queued" || b.status === "investigating";
  const profiled = b.status === "profiled";
  const draft = input.draftStatus ?? (draftCount > 0 ? "ready" : null);
  const hasEmail = Boolean(draft) && draft !== "excluded";

  const steps: WorkflowStep[] = [
    { key: "found", label: "Found", state: "done" },
    {
      key: "researched",
      label: "Researched",
      state: profiled ? "done" : busy ? "active" : b.status === "failed" ? "failed" : b.status === "no_website" && !b.website ? "skipped" : "todo",
      hint: b.status === "no_website" && !b.website ? "No website found" : b.status === "failed" ? "Failed" : profiled ? verdictLabel(b.verdict) : undefined,
    },
    { key: "email", label: "Email ready", state: contacted || draft === "approved" || draft === "ready" ? "done" : hasEmail ? "active" : "todo", hint: contacted ? undefined : draft === "approved" ? "Approved" : draft === "needs_review" ? "Needs review" : draft === "queued" || draft === "sending" ? "Sending" : undefined },
    { key: "contacted", label: "Contacted", state: contacted ? "done" : "todo" },
    { key: "replied", label: "Replied", state: replied ? "done" : "todo", hint: replied && stage !== "replied" ? stageLabel(stage) : undefined },
  ];

  let next: NextAction;
  if (busy) next = { kind: "wait", title: "Researching in the background", description: "Reading the website, building the profile and looking for one solid idea. This page refreshes on its own.", tone: "info" };
  else if (stage === "won" || stage === "lost") next = { kind: "done", title: stage === "won" ? "Won" : "Closed", description: "Nothing pending for this business.", tone: "neutral" };
  else if (replied && (input.openReplies ?? 0) > 0) next = { kind: "answer", title: "Answer their reply", description: "They wrote back. Read the reply, answer from your mailbox, then move the business on.", tone: "accent" };
  else if (replied) next = { kind: "done", title: `In progress: ${stageLabel(stage)}`, description: "Keep notes here and move the business on the board as things happen.", tone: "ok" };
  else if (contacted) next = { kind: "await_reply", title: "Waiting for a reply", description: "The email is out. Replies are picked up from your inbox; a follow-up is drafted for your review if nothing comes back.", tone: "ok" };
  else if (!b.website && b.status === "no_website") next = { kind: "no_website", title: "No website could be found", description: "Web search and domain guesses were checked and nothing verified against this business. Add the website below if you know it.", tone: "warn" };
  else if (b.status === "failed") next = { kind: "retry", title: "Research failed", description: "The website could not be read. Retry, or correct the address below.", tone: "warn" };
  else if (!profiled) next = { kind: "investigate", title: "Research this business", description: b.website ? "Read the website and public records, build the profile and look for one solid idea, in one step." : "No website is on record: research first tries to locate one, then builds the profile.", tone: "accent" };
  else if (b.verdict === "no_contact") next = { kind: "add_email", title: "No public email was found", description: "Research stopped before the full analysis because there is nobody to write to. Add an address below if you have one.", tone: "warn" };
  else if (b.verdict === "not_a_fit") next = { kind: "not_a_fit", title: "Not a fit", description: "The research found no convincing idea for this business. Nothing will be sent.", tone: "neutral" };
  else if (b.verdict === "needs_review" || b.verdict === "insufficient_evidence") next = { kind: "review_research", title: b.verdict === "insufficient_evidence" ? "Too little could be verified" : "Have a look before it goes further", description: "The research is not strong enough to write to them automatically. Read the reasons below, then qualify it yourself or set it aside.", tone: "warn" };
  else if (!hasEmail) next = { kind: "write_email", title: ai ? "The email is being written" : "The email cannot be written yet", description: ai ? "A qualified business gets its email written automatically. It appears under Outreach when it has passed its checks." : "Writing emails needs a model key (ANTHROPIC_API_KEY).", tone: ai ? "info" : "warn" };
  else if (draft === "queued" || draft === "sending") next = { kind: "send", title: "The email is on its way", description: "It is queued to go out at its scheduled time.", tone: "info" };
  else if (draft === "failed") next = { kind: "review_email", title: "The email could not be sent", description: "Open it to see why and to try again.", tone: "warn" };
  else if (draft === "approved") next = { kind: "send", title: "Approved: send it with the batch", description: "It goes out when you press Send on the Outreach page.", tone: "ok" };
  else next = { kind: "review_email", title: draft === "needs_review" ? "The email needs your eye" : "Review the email", description: draft === "needs_review" ? "A check failed. Open it to see what, then edit, rewrite or approve it." : "Read it, edit if you like, and approve it for the next batch.", tone: "accent" };
  return { steps, next };
}

/** Research age in days, or null when never researched. */
export function researchAgeDays(investigatedAt: string | null | undefined): number | null {
  if (!investigatedAt) return null;
  return Math.floor((Date.now() - new Date(investigatedAt).getTime()) / 86_400_000);
}
export function isResearchStale(investigatedAt: string | null | undefined): boolean {
  const age = researchAgeDays(investigatedAt);
  return age != null && age >= getConfig().RESEARCH_STALE_DAYS;
}

export function defaultTabFor(next: NextActionKind): string {
  switch (next) {
    case "review_email":
    case "send":
    case "await_reply":
    case "answer":
      return "outreach";
    default:
      return "opportunities";
  }
}
