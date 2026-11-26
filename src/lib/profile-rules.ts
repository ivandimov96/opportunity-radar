/**
 * What the profile fields accept. One list, used twice: the form gives each field its limits so the browser
 * stops a wrong value before it is sent, and the save action checks the same rules again and refuses what fails.
 * Everything here ends up in an email (the signature) or steers what is written and searched for, so a value
 * that would make an email look careless or fake is not taken. Pure: no database, safe to import anywhere.
 */

/** The shortest answer accepted for what is sold and what the customer gets: a sentence, not a letter. */
export const OFFER_MIN_CHARS = 20;
export const OFFER_MAX_CHARS = 500;
/** How many kinds of business (to look for, or to leave out) a profile holds, and how long one may be. */
export const MAX_KINDS = 15;
export const KIND_MAX_CHARS = 60;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const words = (text: string) => oneLine(text).split(" ").filter((w) => /\p{L}{2,}/u.test(w));

/** Whether a description says something: long enough, and made of several words. */
export function saysEnough(text: string): boolean {
  return oneLine(text).length >= OFFER_MIN_CHARS && words(text).length >= 3;
}

/** A web address or an email address inside running text. */
const hasLink = (text: string) => /https?:\/\/|www\.|\S+@\S+\.\S+|\b[a-z0-9-]+\.(com|net|org|io|co|uk|de|bg|eu|app|dev)\b/i.test(text);
/** Mostly capital letters: reads as shouting, and spam filters count it. */
const shouts = (text: string) => {
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 12 && letters.replace(/[^\p{Lu}]/gu, "").length / letters.length > 0.6;
};
/** The same letter many times in a row, or a row of exclamation or question marks. */
const padded = (text: string) => /(\p{L})\1{3,}/iu.test(text) || /[!?]{3,}/.test(text);

export type ProfileRule = {
  /** How the field is named when a value is refused. */
  label: string;
  /** What a good value looks like, in a few words; shown by the browser and in the refusal. */
  say: string;
  min?: number;
  max: number;
  /** Several lines are allowed (a text area). */
  lines?: boolean;
  /** The whole value must match (the HTML `pattern` attribute, so the browser checks it too). */
  pattern?: string;
  /** What the browser cannot check. */
  ok?: (value: string) => boolean;
};

const LETTERS = String.raw`\p{L}\p{M}`;

export const PROFILE_RULES = {
  senderName: {
    label: "Your name",
    say: "your own name in letters, without numbers or symbols",
    min: 2,
    max: 60,
    pattern: String.raw`[${LETTERS}][${LETTERS} .'’\-]*[${LETTERS}.]`,
    ok: (v) => !shouts(v) && !padded(v),
  },
  senderCompany: { label: "Company", say: "the company's name, without a web or email address", min: 2, max: 80, pattern: String.raw`.*[${LETTERS}\d].*`, ok: (v) => !hasLink(v) && !padded(v) },
  senderTitle: { label: "Your title", say: "a job title such as Founder", min: 2, max: 60, pattern: String.raw`[${LETTERS}][${LETTERS}\d &,.'’\/\-]*`, ok: (v) => !hasLink(v) && !padded(v) },
  senderWebsite: { label: "Website", say: "an address like yourcompany.com", max: 100, pattern: String.raw`(https?:\/\/)?([A-Za-z0-9\-]+\.)+[A-Za-z]{2,}(\/\S*)?` },
  postalAddress: {
    label: "Postal address",
    say: "a full address: street and number, city, postal code, country",
    min: 12,
    max: 200,
    pattern: String.raw`.*[\d,].*`,
    ok: (v) => words(v).length >= 2 && !hasLink(v) && !padded(v) && !shouts(v),
  },
  signature: { label: "Your signature", say: "at most 8 lines and 600 characters", max: 600, lines: true, ok: (v) => v.trim().split("\n").length <= 8 && !padded(v) },
  offer: { label: "What you offer", say: `a full sentence of at least ${OFFER_MIN_CHARS} characters, in normal writing and without links`, min: OFFER_MIN_CHARS, max: OFFER_MAX_CHARS, lines: true, ok: (v) => saysEnough(v) && !hasLink(v) && !shouts(v) && !padded(v) },
  offerResult: { label: "What your customer gets", say: `a full sentence of at least ${OFFER_MIN_CHARS} characters, in normal writing and without links`, min: OFFER_MIN_CHARS, max: OFFER_MAX_CHARS, lines: true, ok: (v) => saysEnough(v) && !hasLink(v) && !shouts(v) && !padded(v) },
  fitSigns: { label: "Signs of a good fit", say: "a few plain sentences, at most 600 characters", min: 10, max: 600, lines: true, ok: (v) => words(v).length >= 2 && !padded(v) },
  bookingLink: { label: "Booking link", say: "a full address that starts with https://", max: 200, pattern: String.raw`https:\/\/[^\s.\/]+\.\S+` },
  proofPoints: { label: "Results you can back up", say: "a full sentence, at most 800 characters", min: OFFER_MIN_CHARS, max: 800, lines: true, ok: (v) => words(v).length >= 3 && !shouts(v) && !padded(v) },
  voiceSamples: { label: "How you write", say: "an email or two you wrote, between 80 and 6,000 characters", min: 80, max: 6000, lines: true, ok: (v) => words(v).length >= 12 },
} satisfies Record<string, ProfileRule>;

export type ProfileField = keyof typeof PROFILE_RULES;

/** What a form field needs so the browser applies the rule: limits, the pattern, and what to say when it fails. */
export function fieldLimits(field: ProfileField): { minLength?: number; maxLength: number; pattern?: string; title: string } {
  const r: ProfileRule = PROFILE_RULES[field];
  return { minLength: r.min, maxLength: r.max, pattern: r.pattern, title: r.say[0].toUpperCase() + r.say.slice(1) };
}

/** A value as it is stored: no stray spaces, no invisible characters; a single-line field on one line. */
export function tidy(field: ProfileField, value: string): string {
  const r: ProfileRule = PROFILE_RULES[field];
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b-\u001f​-‍﻿]/g, "");
  return r.lines
    ? v
        .split("\n")
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : oneLine(v);
}

/** Why a (tidied) value is not taken, or null when it is fine. Empty is fine here: what must be filled in is decided elsewhere. */
export function refusal(field: ProfileField, value: string): string | null {
  if (!value) return null;
  const r: ProfileRule = PROFILE_RULES[field];
  const fits = value.length >= (r.min ?? 0) && value.length <= r.max && (!r.pattern || new RegExp(`^(?:${r.pattern})$`, "v").test(value)) && (!r.ok || r.ok(value));
  return fits ? null : `${r.label}: ${r.say}.`;
}

/**
 * Tidies the profile fields of what is about to be saved and takes out the ones that break their rule:
 * those keep the value they had. Returns what was refused, in plain words.
 */
export function applyProfileRules(patch: Record<string, unknown>): string[] {
  const refused: string[] = [];
  for (const field of Object.keys(PROFILE_RULES) as ProfileField[]) {
    if (typeof patch[field] !== "string") continue;
    const value = tidy(field, patch[field] as string);
    const why = refusal(field, value);
    if (why) {
      refused.push(why);
      delete patch[field];
    } else patch[field] = value;
  }
  return refused;
}

/** One kind of business as typed into a list: a few words in letters, or nothing when it is not that. */
export function tidyKind(raw: string): string {
  const v = oneLine(raw).replace(/^[\s,.;:!?-]+|[\s,;:!?-]+$/g, "");
  return v.length >= 3 && v.length <= KIND_MAX_CHARS && /\p{L}{3,}/u.test(v) && !/[@<>{}[\]|\\=_#*^~]|\d{3,}/.test(v) && !hasLink(v) && !padded(v) ? v : "";
}
