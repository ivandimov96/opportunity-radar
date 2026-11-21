/**
 * Fixed quality checks on an outreach email. No model is involved: these are
 * the rules that can be decided by reading the text. A "block" issue keeps the
 * email out of the ready queue until it is regenerated, edited or explicitly
 * approved by the operator; a "warn" issue is shown but does not hold it back.
 */
import type { DraftIssue } from "@/db/schema";
import { listPlaybooks } from "@/lib/industries";
import { TOOL_SIGNATURES } from "@/lib/research/detect";
import type { EvidencePack } from "./evidence";

export interface EmailText {
  subject: string;
  body: string;
  claims: { text: string; factKeys: string[] }[];
}

export interface CheckContext {
  pack: EvidencePack;
  /** The only link an email may contain. */
  bookingLink?: string | null;
  /** 0 = first email, 1 = follow-up. */
  step: number;
  /** Other emails in the same batch: subjects must differ and the text should not repeat. */
  others: { subject: string; body: string; label: string }[];
  /** What the sender said about themselves in their profile (offer, result, proof): a figure from there is theirs to use. */
  senderSays?: string | null;
  /** The seller chose a short call as what a first email asks for: proposing one is then the point, not a fault. */
  callIsTheAsk?: boolean;
}

const BANNED_PHRASES = [
  "hope this email finds you",
  "hope this message finds you",
  "hope you're doing well",
  "hope you are doing well",
  "i hope this finds you",
  "leading software",
  "leading provider",
  "leading company",
  "innovative solution",
  "cutting-edge",
  "cutting edge",
  "state-of-the-art",
  "state of the art",
  "synergy",
  "revolutionize",
  "game-changer",
  "game changer",
  "to the next level",
  "touch base",
  "circle back",
  "just following up",
  "just bumping",
  "did you see my",
];
const PLACEHOLDER_RE = /\[[^\]\n]{1,40}\]|\{\{[^}]*\}\}|<[a-z_ ]{2,30}>|\bX{3,}\b|\bTBD\b|lorem ipsum/i;
/** States as a fact that the business lacks something: nothing on a website can prove that. */
const ABSENCE_RE = /\byou (?:currently |still )?(?:don[’']t|do not|didn[’']t|did not) (?:seem to |appear to )?(?:have|offer|use|provide|accept|take|do)\b|\byou(?:r (?:site|website|business|company|team|shop|practice))? (?:lacks?|is missing|are missing|has no|have no)\b|\bthere(?:[’']s| is) no (?:way|option)\b/i;
const NOT_SEEN_RE = /\bI (?:didn[’']t|did not|couldn[’']t|could not) (?:see|find|spot|notice)\b/i;
/** A remark on the recipient's size or reach ("small businesses like yours", "local shops"): it can read as a slight. */
const SIZE_REMARK_RE = /\b(small|smaller|little|tiny|modest|local|mom[- ]and[- ]pop)\s+(?:[a-z-]+\s+)?(business(?:es)?|firms?|compan(?:y|ies)|shops?|outfits?|operations?|workshops?|practices?|players?)\b/i;
/** Subject words that read like an advert and are known to send mail to the spam folder. */
const SUBJECT_ADWORD_RE = /\b(free|offers?|discounts?|deals?|save|savings|guarantee[ds]?|cheap|cheapest|urgent|act now|limited time|winner|bonus)\b|[$£€%]/i;
/** A subject dressed up as a reply or a forward: misleading, and against the rules for commercial email. */
const SUBJECT_FAKE_THREAD_RE = /^\s*(re|fw|fwd)\s*:/i;
const CRITICISM_RE = /\b(outdated|old-fashioned|clunky|unprofessional|poorly|sloppy|amateurish|behind the times|badly)\b/i;
/** A call or meeting proposed in the text. In a first email the only ask is one question that takes a word to answer. */
const CALL_OFFER_RE = /\b(?:\d+|ten|fifteen|twenty|thirty)[- ]minute (?:call|chat|meeting|conversation)\b|\b(?:a|quick|short|brief) (?:(?:quick|short|brief|video|phone|zoom) )?(?:call|chat|meeting|zoom)\b|\b(?:hop|jump|get) on a\b|\bbook a (?:time|slot)\b/i;
/** The opening sentence of a first email: one specific thing, not a tour of their website. */
export const OPENING_MAX_WORDS = 20;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>)"']+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const NUMBER_RE = /\d[\d.,:/-]*\d|\d/g;
const SIGNOFF_RE = /^(best|all the best|best regards|kind regards|regards|sincerely|cheers|thanks|many thanks|thank you|warm regards|warmly|talk soon|take care),?$/i;
/** Product names that are also ordinary words: not treated as tool mentions. */
const AMBIGUOUS_TOOLS = new Set(["drift", "affirm", "weave", "aspire", "lmn", "steer", "curve", "podium"]);

let toolNames: string[] | null = null;
function knownTools(): string[] {
  if (toolNames) return toolNames;
  const names = [...TOOL_SIGNATURES.map((t) => t.name.replace(/\s*\(.*\)$/, "")), ...listPlaybooks().flatMap((p) => p.commonTools)];
  toolNames = [...new Set(names.map((n) => n.trim()))].filter((n) => n.length >= 4 && !AMBIGUOUS_TOOLS.has(n.toLowerCase()));
  return toolNames;
}

/**
 * Words in the body. A first email is a short, friendly note: long enough to
 * say one specific thing, short enough to be read at a glance on a phone.
 * Outside the soft range is a remark; outside the hard range holds the email
 * back.
 */
export const EMAIL_LENGTH = {
  first: { hardMin: 25, softMin: 40, softMax: 75, hardMax: 95 },
  followUp: { hardMin: 20, softMin: 25, softMax: 60, hardMax: 80 },
  /** The last note of a sequence: two or three sentences. */
  lastNote: { hardMin: 10, softMin: 15, softMax: 40, hardMax: 60 },
  /** An answer to a reply: as long as the question needs, never an essay. */
  answer: { hardMin: 3, softMin: 8, softMax: 110, hardMax: 180 },
} as const;

/** Which length range applies to an email of this step (see steps.ts). */
export function lengthFor(step: number) {
  return EMAIL_LENGTH[step === 0 ? "first" : step === 2 ? "lastNote" : step === 9 ? "answer" : "followUp"];
}

export function wordCount(body: string): number {
  return body.trim() ? body.trim().split(/\s+/).length : 0;
}

/** The first sentence after the greeting line: what the reader sees first. */
export function openingLine(body: string): string {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const start = lines.length > 1 && lines[0].length <= 60 && /,$|^(hi|hello|dear|good (morning|afternoon))\b/i.test(lines[0]) ? 1 : 0;
  return (lines.slice(start).join(" ").match(/^.*?[.?!](?=\s|$)/)?.[0] ?? lines.slice(start).join(" ")).slice(0, 200);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** The body as sentences (greeting line excluded), for comparing emails within a batch. */
export function sentences(body: string): string[] {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const start = lines.length > 1 && lines[0].length <= 60 && /,$/.test(lines[0]) ? 1 : 0;
  return lines.slice(start).flatMap((l) => l.match(/[^.?!]+[.?!]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** The sentence in which the writer says who they are ("I'm Ivan, and I build ..."), when there is one. */
export function introLine(body: string): string | null {
  return sentences(body).find((s) => /^(i['’]m|i am|my name is)\b/i.test(s)) ?? null;
}

/** Jaccard similarity of word trigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const w = norm(s).split(" ");
    const out = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Removes a sign-off the writer added anyway ("Best," / the sender's name): the signature is appended by code. */
export function stripSignoff(body: string, senderName?: string | null): string {
  const lines = body.replace(/\r/g, "").split("\n");
  const first = (senderName ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  const full = (senderName ?? "").trim().toLowerCase();
  const isName = (l: string) => Boolean(l) && (l.toLowerCase() === full || l.toLowerCase() === first);
  for (let i = 0; i < 3; i++) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const last = lines[lines.length - 1]?.trim() ?? "";
    if (SIGNOFF_RE.test(last) || isName(last)) lines.pop();
    else break;
  }
  return lines.join("\n").trim();
}

/** A subject starts with a capital letter: "an idea for your proofs" → "An idea for your proofs". Nothing else is changed. */
export function capitalizeSubject(subject: string): string {
  const s = subject.trim();
  return s.replace(/^(["“'‘]*)([a-zà-ÿ])/, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** Would this subject pass the fixed checks without a remark? Used to filter suggested subjects before they are offered. */
export function subjectIsClean(subject: string, others: { subject: string }[] = []): boolean {
  const s = subject.trim();
  if (!s || s.split(/\s+/).length > 6 || s.length > 60) return false;
  if (SUBJECT_ADWORD_RE.test(s) || SUBJECT_FAKE_THREAD_RE.test(s) || /!/.test(s) || (s.match(/\?/g) ?? []).length > 1) return false;
  if (s.length > 6 && s === s.toUpperCase() && /[A-Z]/.test(s)) return false;
  return !others.some((o) => norm(o.subject) === norm(s));
}

export function checkEmailText(email: EmailText, ctx: CheckContext): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const block = (code: string, message: string) => issues.push({ severity: "block", code, message });
  const warn = (code: string, message: string) => issues.push({ severity: "warn", code, message });
  const body = email.body;
  const lower = body.toLowerCase();
  const subject = email.subject.trim();

  // Subject
  if (!subject) block("subject_missing", "The email has no subject.");
  else {
    const subjectWords = subject.split(/\s+/).length;
    if (subjectWords > 6 || subject.length > 60) warn("subject_long", `The subject is long (${subjectWords} words). Two to five words get opened most.`);
    if (ctx.step === 0) {
      const ad = SUBJECT_ADWORD_RE.exec(subject);
      if (ad) block("subject_adword", `The subject contains "${ad[0]}", which reads like an advert and can land the email in spam.`);
      if (SUBJECT_FAKE_THREAD_RE.test(subject)) block("subject_fake_thread", "The subject pretends to be a reply or a forward.");
    }
    if (ctx.step === 0 && capitalizeSubject(subject) !== subject) warn("subject_lowercase", "The subject does not start with a capital letter.");
    if (/!/.test(subject)) warn("subject_exclamation", "The subject contains an exclamation mark.");
    if ((subject.match(/\?/g) ?? []).length > 1) warn("subject_questions", "The subject contains more than one question mark.");
    if (subject.length > 6 && subject === subject.toUpperCase() && /[A-Z]/.test(subject)) warn("subject_caps", "The subject is in capitals.");
    if (ctx.step === 0) {
      const dup = ctx.others.find((o) => norm(o.subject) === norm(subject));
      if (dup) block("subject_duplicate", `The subject is the same as the email for ${dup.label}.`);
    }
  }

  // Length
  const words = wordCount(body);
  const { hardMin, softMin, softMax, hardMax } = lengthFor(ctx.step);
  if (words < hardMin) block("too_short", `The email is too short (${words} words).`);
  else if (words > hardMax) block("too_long", `The email is too long (${words} words; aim for ${softMin}-${softMax}).`);
  else if (words < softMin || words > softMax) warn("length", `The email has ${words} words (aim for ${softMin}-${softMax}).`);

  // Things that must never go out
  if (PLACEHOLDER_RE.test(body) || PLACEHOLDER_RE.test(subject)) block("placeholder", "The email contains a placeholder that was not filled in.");
  for (const p of BANNED_PHRASES) if (lower.includes(p)) block("stock_phrase", `Contains a stock phrase: "${p}".`);
  const absence = ABSENCE_RE.exec(body);
  if (absence) block("absence_stated", `States as a fact that the business lacks something ("${absence[0]}"). A website cannot prove that: ask it as a question.`);
  if (NOT_SEEN_RE.test(body)) warn("not_seen", "Mentions something that was not found on their site; make sure it reads as a question, not as a gap.");
  // Their own words are fine ("our small family business" on their site); the writer's are not.
  const size = SIZE_REMARK_RE.exec(body);
  if (size && !ctx.pack.haystack.includes(size[0].toLowerCase())) block("size_remark", `Calls a business small or local ("${size[0]}"). That can read as a slight: leave their size out.`);
  const crit = CRITICISM_RE.exec(body);
  if (crit) warn("criticism", `May read as criticism ("${crit[0]}").`);
  if ((body.match(/!/g) ?? []).length > 1) warn("exclamation", "Contains more than one exclamation mark.");
  if (ctx.step === 0) {
    // One small ask: a single question that can be answered in a word, and no call to agree to.
    const questions = (body.match(/\?/g) ?? []).length;
    if (questions === 0) block("no_question", "The email does not end with a question. One easy question gives them something to answer.");
    else if (questions > 1) warn("several_questions", `The email asks ${questions} questions. One easy question gets more answers.`);
    const call = CALL_OFFER_RE.exec(body);
    if (call && !ctx.callIsTheAsk) warn("call_offer", `Proposes a call ("${call[0]}"). In a first email, a question that takes one word to answer is easier to say yes to.`);
    const openingWords = wordCount(openingLine(body));
    if (openingWords > OPENING_MAX_WORDS) warn("long_opening", `The opening sentence is long (${openingWords} words). One short, specific line is enough.`);
  }
  if (!/^(hi|hello|dear|good (morning|afternoon))\b/i.test(body.trim())) warn("greeting", "The email does not start with a greeting.");

  // Links and addresses: only the operator's booking link may appear.
  const allowed = (ctx.bookingLink ?? "").trim().replace(/\/$/, "").toLowerCase();
  for (const url of body.match(URL_RE) ?? []) {
    const u = url.replace(/[.,;]$/, "").replace(/\/$/, "").toLowerCase();
    if (!allowed || !(u === allowed || allowed.endsWith(u.replace(/^https?:\/\//, "")))) block("link", `Contains a link that is not your booking link (${url}).`);
  }
  if (EMAIL_RE.test(body)) block("email_address", "Contains an email address.");

  // Numbers: every figure must be in the evidence (durations of the proposed call are fine).
  for (const m of body.matchAll(NUMBER_RE)) {
    const token = m[0].replace(/[.,:/-]+$/, "");
    const after = body.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 14);
    if (/^\s*-?\s*(minutes?|mins?\b|min\b)/i.test(after)) continue;
    if (ctx.pack.haystack.includes(token.toLowerCase()) || ctx.pack.haystack.includes(token.replace(/,/g, ""))) continue;
    if (ctx.senderSays && ctx.senderSays.toLowerCase().includes(token.toLowerCase())) continue;
    block("number_not_in_evidence", `Contains a number that is not in the research or in your own details (${token}).`);
  }

  // Tools: naming a product they supposedly use needs evidence.
  for (const tool of knownTools()) {
    const re = new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(body) && !ctx.pack.haystack.includes(tool.toLowerCase())) block("tool_not_verified", `Names a product (${tool}) that the research did not verify.`);
  }

  // Claims: each one must point at something in the evidence pack and appear in the text.
  const refs = new Set([...ctx.pack.verified.map((v) => v.ref), ...ctx.pack.notSeen.map((v) => v.ref)]);
  const normBody = norm(body);
  for (const c of email.claims) {
    if (!c.factKeys.some((k) => refs.has(k))) block("claim_unsupported", `A statement about the business cites nothing from the research: "${c.text.slice(0, 90)}".`);
    if (!normBody.includes(norm(c.text))) warn("claim_text", `A listed claim is not in the email text: "${c.text.slice(0, 80)}".`);
  }

  // Sameness within the batch, one remark per other email: the same opening, a body that is mostly the same,
  // or a single sentence repeated word for word (typically the self-introduction).
  const long = (s: string) => norm(s).split(" ").length >= 7;
  const mine = new Set(sentences(body).filter(long).map(norm));
  const opening = norm(openingLine(body)).split(" ").slice(0, 6).join(" ");
  for (const o of ctx.others) {
    const shared = sentences(o.body).filter(long).find((s) => mine.has(norm(s)));
    if (opening && norm(openingLine(o.body)).split(" ").slice(0, 6).join(" ") === opening) warn("same_opening", `Opens the same way as the email for ${o.label}.`);
    else if (similarity(body, o.body) > 0.5) warn("similar", `Reads very similar to the email for ${o.label}.`);
    else if (shared) warn("same_sentence", `Repeats a sentence from the email for ${o.label}: "${shared.slice(0, 90)}".`);
  }
  return issues;
}

export const hasBlock = (issues: DraftIssue[]) => issues.some((i) => i.severity === "block");

/**
 * The fixed checks for an answer to a reply. An answer says nothing new about
 * their business, so there is no evidence to hold it against; what must never
 * go out is a gap left for the operator to fill in ("[time]"), a link that is
 * not the booking link, or an essay.
 */
export function checkAnswerText(body: string, ctx: { bookingLink?: string | null }): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const block = (code: string, message: string) => issues.push({ severity: "block", code, message });
  const words = wordCount(body);
  const { hardMin, softMax, hardMax } = EMAIL_LENGTH.answer;
  if (words < hardMin) block("too_short", "The answer is empty.");
  else if (words > hardMax) block("too_long", `The answer is too long (${words} words).`);
  else if (words > softMax) issues.push({ severity: "warn", code: "length", message: `The answer has ${words} words. A short answer is easier to reply to.` });
  if (PLACEHOLDER_RE.test(body)) block("placeholder", "The answer has a gap for you to fill in (a date, a time or a detail in square brackets).");
  for (const p of BANNED_PHRASES) if (body.toLowerCase().includes(p)) block("stock_phrase", `Contains a stock phrase: "${p}".`);
  const allowed = (ctx.bookingLink ?? "").trim().replace(/\/$/, "").toLowerCase();
  for (const url of body.match(URL_RE) ?? []) {
    const u = url.replace(/[.,;]$/, "").replace(/\/$/, "").toLowerCase();
    if (!allowed || !(u === allowed || allowed.endsWith(u.replace(/^https?:\/\//, "")))) block("link", `Contains a link that is not your booking link (${url}).`);
  }
  return issues;
}
