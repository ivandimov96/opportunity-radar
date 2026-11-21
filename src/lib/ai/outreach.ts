/**
 * Outreach emails: one call writes the email from an evidence pack, fixed
 * checks read the text, and a second, independent call lists every statement
 * the email makes about the recipient and whether the evidence supports it.
 * An email with an unsupported statement is rewritten once with the problems
 * named; if it still fails it goes to "needs review", never to "ready".
 * Nothing is sent from here.
 */
import type { DraftIssue, DraftValidation } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { nowIso } from "@/lib/ids";
import { renderEvidencePack, type EvidencePack } from "@/lib/outreach/evidence";
import { capitalizeSubject, checkEmailText, hasBlock, introLine, openingLine, stripSignoff, subjectIsClean, type EmailText } from "@/lib/outreach/validate";
import { callStructured } from "./client";
import { CHECK_BACK_SYSTEM, CHECK_SYSTEM, FOLLOWUP_SYSTEM, LAST_NOTE_SYSTEM, OUTREACH_SYSTEM, SUBJECTS_SYSTEM } from "./prompts";
import { stepNoun, type WrittenStep } from "@/lib/outreach/steps";
import { FIRST_STEPS, type FirstStep } from "@/lib/seller";
import { EmailCheckSchema, OutreachSchema, SubjectsSchema } from "./schemas";

export interface OutreachContext {
  business: { id: string; name: string; city?: string | null; region?: string | null; category?: string | null };
  /** The first line of the email, decided in code: always the company ("Hi Northside Air team,"). */
  greeting: string;
  sender: {
    name: string;
    company: string;
    offer: string;
    bookingLink: string;
    voiceSamples: string;
    /** What the sender's customers get out of it, a result they can back up, and what a first email asks for: all from the profile. */
    result?: string;
    proof?: string;
    firstStep?: FirstStep;
  };
  opportunity: {
    title: string;
    problemHypothesis: string;
    proposedSolution: string;
    whyRelevant: string | null;
    /** The idea in plain words, as the research phrased it for the owner; null when no model wrote it. */
    pitch?: string | null;
    expectedValue?: string | null;
    /** existing | new_for_customers | internal: decides how sure the email may sound. */
    scope?: string | null;
    components: { name: string; description: string }[];
    validationQuestions: string[];
  };
  /** A different idea from the research. The first email raises one idea only; this one can be the new angle of the follow-up. */
  also?: { inPlainWords: string; scope?: string | null } | null;
  pack: EvidencePack;
  /** 0 = first email; 1 follow-up, 2 last note, 3 check-back: all in the first email's thread (steps.ts). */
  step: WrittenStep;
  firstEmail?: { subject: string; body: string } | null;
  /** The follow-up that also went unanswered (for the last note). */
  followUpEmail?: { body: string } | null;
  /** What they answered and when (for the check-back after a "not now"). */
  theirReply?: { receivedAt: string; summary: string } | null;
  /** Other emails in the batch, so this one does not repeat them. */
  others: { subject: string; body: string; label: string }[];
  /** What the operator asked for when regenerating. */
  feedback?: string | null;
}

/** How the writer should carry each kind of idea: the less a website can show, the more the email asks. */
const SCOPE_NOTE: Record<string, string> = {
  existing: "It improves something their website shows they already offer. You may refer to that thing as it is described in the evidence.",
  new_for_customers: "It is something new for their customers that their website does not show. They may already have it out of sight: never say or imply they are missing it; say in a few words that you could not see it from outside, and state what you offer plainly.",
  internal: "It is about how they work behind the scenes. You cannot see from outside how they handle this today: say that in a few words, state what you offer plainly, and base everything else only on what the evidence says about the work they do.",
};

/**
 * The first line of every email: the company, never a person. A name found on
 * a website may be out of date, misspelled or simply not the one who reads the
 * inbox, and a wrong name is worse than none. Only a legal form (Ltd, LLC,
 * Inc) is dropped: "Co." stays, because it is part of how a company is called
 * ("The Harbour Sign Co.").
 */
export function greetingFor(businessName: string): string {
  const name = businessName.replace(/\s*(,?\s*(LLC|L\.L\.C\.|Inc\.?|L\.P\.|LP|LLP|PLC|Corp\.?|Ltd\.?|Limited))+$/i, "").trim();
  return name && name.length <= 60 ? `Hi ${name} team,` : "Hello,";
}

/** How many of the sender's other emails the writer is shown in full. */
export const FULL_PEERS = 5;

export function buildOutreachInput(ctx: OutreachContext, problems: string[] = []): string {
  const o = ctx.opportunity;
  // The seller without a profile offered a mock-up; that stays the ask when none is chosen.
  const step = FIRST_STEPS[ctx.sender.firstStep ?? "example"];
  const others = ctx.others
    .slice(0, 12)
    .map((x) => `- Subject: ${x.subject} | Opens: ${openingLine(x.body).slice(0, 140)}${introLine(x.body) ? ` | Introduces the sender with: ${introLine(x.body)!.slice(0, 140)}` : ""}`)
    .join("\n");
  // A few of them in full: sameness hides in the middle of an email, not only in its first line.
  const recent = ctx.others
    .slice(0, FULL_PEERS)
    .map((x, i) => `<other_email n="${i + 1}">\n${x.body.trim().slice(0, 900)}\n</other_email>`)
    .join("\n");
  return `Recipient: ${ctx.business.name}${ctx.business.category ? ` (${ctx.business.category})` : ""}, ${[ctx.business.city, ctx.business.region].filter(Boolean).join(", ") || "location unknown"}
Greeting to use as the first line: ${ctx.greeting}

Sender: ${ctx.sender.name || "the owner"}${ctx.sender.company ? ` of ${ctx.sender.company}` : ""}. What the sender offers, in the sender's own words: ${ctx.sender.offer || "custom software, integrations and automation"}.${ctx.sender.result?.trim() ? `\nWhat the sender's customers get out of it: ${ctx.sender.result.trim()}` : ""}
${ctx.step === 0 ? `What to ask for (the one question that ends this email): ${step.ask}.` : ctx.step === 2 ? "" : `What the first email asked for: ${step.ask}. ${step.renew}`}${ctx.step === 1 && ctx.sender.proof?.trim() ? `\nA result the sender can back up (use at most one, in the sender's terms, adding nothing): ${ctx.sender.proof.trim().slice(0, 800)}` : ""}
Booking link: ${ctx.step === 1 || ctx.step === 3 ? ctx.sender.bookingLink || "(none: include no links)" : ctx.step === 2 ? "(not used in a last note: include no links)" : "(not used in a first email: include no links)"}
${ctx.sender.voiceSamples.trim() ? `\nVoice samples written by the sender (match rhythm and word choice only):\n<voice>\n${ctx.sender.voiceSamples.trim().slice(0, 4000)}\n</voice>\n` : ""}
<website_content>
${renderEvidencePack(ctx.pack)}
</website_content>

THE IDEA TO RAISE (a possibility to explore with them, not a fact about them):
Kind of idea: ${SCOPE_NOTE[o.scope ?? "existing"] ?? SCOPE_NOTE.existing}
In plain words: ${o.pitch?.trim() || o.title}
What it is called internally: ${o.title}
What might be going on (a guess, never to be stated as a fact): ${o.problemHypothesis}
What it would be worth to them: ${o.expectedValue?.trim() || "n/a"}
Why it fits this business: ${o.whyRelevant ?? "n/a"}
${ctx.step === 1 ? `A question worth asking them: ${o.validationQuestions.slice(0, 2).join(" | ") || "n/a"}\n` : ""}
${ctx.step === 1 && ctx.also?.inPlainWords.trim() ? `A SECOND IDEA (it can be the new angle of this follow-up, in one or two plain sentences; no statement about their business beyond the evidence):
${ctx.also.inPlainWords.trim()}

` : ""}Background for you only, not for the email (do not list these parts; pick at most one as an example):
What could be built: ${o.proposedSolution}
Parts: ${o.components.map((c) => `${c.name} (${c.description})`).join("; ") || "(a single thing)"}
${ctx.step > 0 && ctx.firstEmail ? `\nTHE FIRST EMAIL (${ctx.step === 3 ? "the one they answered" : "unanswered"}; do not repeat it):\nSubject: ${ctx.firstEmail.subject}\n${ctx.firstEmail.body}\n` : ""}${ctx.step === 2 && ctx.followUpEmail ? `\nTHE FOLLOW-UP (also unanswered; do not repeat it):\n${ctx.followUpEmail.body}\n` : ""}${ctx.step === 3 && ctx.theirReply ? `\nTHEIR ANSWER on ${ctx.theirReply.receivedAt.slice(0, 10)} (today is ${new Date().toISOString().slice(0, 10)}), in the words of whoever read it for you:\n<reply_summary>\n${ctx.theirReply.summary.slice(0, 400)}\n</reply_summary>\n` : ""}
Other emails in this batch (do not reuse their structure or phrasing):
${others || "(none yet)"}
${recent ? `\nThe sender's most recent emails to other companies, in full. Yours must not read like any of them: no shared sentence, a different way in, the offer fitted to this company, the closing question in other words.\n${recent}\n` : ""}${ctx.feedback?.trim() ? `\nThe sender asked for this change: ${ctx.feedback.trim().slice(0, 500)}\n` : ""}${problems.length ? `\nYour previous version was rejected. Fix every one of these and change nothing that was fine:\n${problems.map((p) => `- ${p}`).join("\n")}\n` : ""}
Write the ${stepNoun(ctx.step)}.`;
}

export function buildCheckInput(email: EmailText, pack: EvidencePack): string {
  return `<website_content>
${renderEvidencePack(pack)}
</website_content>

EMAIL TO VERIFY
Subject: ${email.subject}

${email.body}

List the statements about the recipient business and the tone problems.`;
}

export interface OutreachOutcome {
  email: EmailText;
  validation: DraftValidation;
  model: string;
  costUsd: number;
  attempts: number;
}

/** The independent claim check alone (also used after the operator edits an email and asks to re-check it). */
export async function checkEmailAgainstEvidence(email: EmailText, pack: EvidencePack, businessId: string): Promise<{ issues: DraftIssue[]; statements: NonNullable<DraftValidation["statements"]>; model: string; costUsd: number }> {
  const res = await callStructured({ stage: "check", effort: "low", system: CHECK_SYSTEM, user: buildCheckInput(email, pack), schema: EmailCheckSchema, businessId, maxTokens: 6000 });
  const issues: DraftIssue[] = [];
  for (const s of res.data.statements) if (s.verdict === "unsupported") issues.push({ severity: "block", code: "unsupported_statement", message: `Not supported by the research: "${s.text.slice(0, 140)}"${s.note ? ` (${s.note})` : ""}.` });
  for (const t of res.data.tone_problems) issues.push({ severity: "warn", code: "tone", message: `Tone: ${t}` });
  return { issues, statements: res.data.statements.map((s) => ({ text: s.text, verdict: s.verdict, evidence: s.evidence })), model: res.model, costUsd: res.usage.costUsd };
}

/**
 * Other subjects for an email that is already written: one small call. Only
 * subjects that pass the fixed checks and differ from the current one, from
 * those tried before and from the rest of the batch are returned.
 */
export async function suggestSubjects(input: { businessId: string; businessName: string; subject: string; body: string; tried: string[]; others: { subject: string }[] }): Promise<{ subjects: string[]; costUsd: number }> {
  const res = await callStructured({
    stage: "outreach",
    effort: "low",
    system: SUBJECTS_SYSTEM,
    user: `Recipient company: ${input.businessName}

Subjects already tried (do not repeat or lightly reword these):
${[input.subject, ...input.tried].filter(Boolean).map((s) => `- ${s}`).join("\n")}

Subjects of other emails in the batch (use a different shape):
${input.others.map((o) => `- ${o.subject}`).join("\n") || "(none)"}

<website_content>
THE EMAIL
${input.body}
</website_content>

Write five alternative subjects.`,
    schema: SubjectsSchema,
    businessId: input.businessId,
    maxTokens: 2000,
  });
  const seen = new Set([input.subject, ...input.tried].map((s) => s.trim().toLowerCase()));
  const subjects: string[] = [];
  for (const raw of res.data.subjects) {
    const s = capitalizeSubject(raw.trim().replace(/^["“]|["”]$/g, ""));
    if (!subjectIsClean(s, input.others) || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    subjects.push(s);
  }
  return { subjects: subjects.slice(0, 5), costUsd: res.usage.costUsd };
}

export const MAX_WRITE_ATTEMPTS = 2;

const SYSTEM_FOR_STEP: Record<WrittenStep, string> = { 0: OUTREACH_SYSTEM, 1: FOLLOWUP_SYSTEM, 2: LAST_NOTE_SYSTEM, 3: CHECK_BACK_SYSTEM };

export async function writeOutreachEmail(ctx: OutreachContext): Promise<OutreachOutcome> {
  const cfg = getConfig();
  let costUsd = 0;
  let problems: string[] = [];
  let last: OutreachOutcome | null = null;
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const res = await callStructured({ stage: "outreach", effort: cfg.AI_OUTREACH_EFFORT, system: SYSTEM_FOR_STEP[ctx.step], user: buildOutreachInput(ctx, problems), schema: OutreachSchema, businessId: ctx.business.id, maxTokens: 8000 });
    costUsd += res.usage.costUsd;
    const email: EmailText = {
      // A follow-up continues the thread, so it keeps the first email's subject.
      subject: ctx.step > 0 && ctx.firstEmail ? ctx.firstEmail.subject : capitalizeSubject(res.data.subject),
      body: stripSignoff(res.data.body, ctx.sender.name),
      claims: res.data.claims.map((c) => ({ text: c.text, factKeys: [...new Set(c.fact_keys)] })),
    };
    const issues = checkEmailText(email, { pack: ctx.pack, bookingLink: ctx.sender.bookingLink, step: ctx.step, others: ctx.others, callIsTheAsk: ctx.sender.firstStep === "call", senderSays: [ctx.sender.offer, ctx.sender.result, ctx.sender.proof].filter(Boolean).join(" ") });
    let statements: DraftValidation["statements"];
    let checkedBy: string | null = null;
    // The claim check costs a call: skip it when the fixed checks already force a rewrite.
    if (!hasBlock(issues)) {
      const chk = await checkEmailAgainstEvidence(email, ctx.pack, ctx.business.id);
      costUsd += chk.costUsd;
      issues.push(...chk.issues);
      statements = chk.statements;
      checkedBy = chk.model;
    }
    last = { email, validation: { passed: !hasBlock(issues), issues, statements, checkedBy, checkedAt: nowIso() }, model: res.model, costUsd, attempts: attempt };
    if (last.validation.passed) break;
    problems = issues.filter((i) => i.severity === "block").map((i) => i.message);
  }
  return last!;
}
