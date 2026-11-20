/**
 * Which email of a conversation an outbound email is. The number is stored in
 * `outreach_drafts.step`; everything that needs to tell the kinds apart asks here.
 *
 *  0  first email
 *  1  follow-up (may raise the second idea)
 *  2  last note (two or three sentences, then the sequence ends)
 *  3  check-back, written when someone who said "not now" comes due
 *  9  answer to a reply (one per reply; `inbound_id` says which)
 */
export const STEP = { first: 0, followUp: 1, lastNote: 2, checkBack: 3, answer: 9 } as const;

/** The steps the writer produces from the research (everything except an answer to a reply). */
export type WrittenStep = 0 | 1 | 2 | 3;
export const isWrittenStep = (n: number): n is WrittenStep => n === 0 || n === 1 || n === 2 || n === 3;

/** The unanswered-email sequence after the first email, in order. */
export const SEQUENCE_STEPS = [STEP.followUp, STEP.lastNote] as const;
/** Emails the app writes ahead of time and withdraws when the business answers. */
export const PENDING_ON_REPLY = [STEP.followUp, STEP.lastNote, STEP.checkBack] as const;

const LABEL: Record<number, string> = { 0: "First email", 1: "Follow-up", 2: "Last note", 3: "Check-back", 9: "Answer" };

/** "First email", "Follow-up", "Last note", "Check-back", "Answer". */
export function stepLabel(step: number): string {
  return LABEL[step] ?? "Email";
}

/** For a sentence: "email", "follow-up", "last note", "check-back", "answer". */
export function stepNoun(step: number): string {
  return step === 0 ? "email" : stepLabel(step).toLowerCase();
}
