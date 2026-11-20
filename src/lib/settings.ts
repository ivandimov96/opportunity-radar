/**
 * Operator settings kept in the database, one set per workspace: who the emails
 * come from, how many go out, and what the system may do on its own. API keys
 * are NOT settings: they stay in the environment and never reach the browser
 * (a workspace's mailbox has its own table, with the password encrypted).
 * Every value has a default, so the app runs before anything is set.
 */
import { and, eq, inArray } from "drizzle-orm";
import { MAX_KINDS, saysEnough, tidyKind } from "./profile-rules";
import { getDb } from "@/db/client";
import { FIRST_WORKSPACE_ID, settings as settingsTable } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { nowIso } from "@/lib/ids";
import { runInWorkspace, workspaceId } from "@/lib/workspace";

/** Where the operator sells: a country, or one region of it. */
export interface TargetPlace {
  /** ISO country code. */
  country: string;
  /** Region code inside the country (a US state, a UK nation); empty = the whole country. */
  region: string;
}
export const OFFER_KINDS = ["service", "product", "software"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number] | "";
/** How big a business the operator sells to. */
export const TARGET_SIZES = ["solo", "small", "medium", "large"] as const;
export type TargetSize = (typeof TARGET_SIZES)[number];
export const TARGET_SIZE_LABEL: Record<TargetSize, string> = { solo: "One person", small: "Small (2 to 10 people)", medium: "Medium (11 to 50)", large: "Larger" };

/** A list a person typed: one entry per line (or an array), trimmed, without repeats. */
function parseList(input: unknown, maxItems = 30, maxLength = 80): string[] {
  const rows: unknown[] = Array.isArray(input) ? input : String(input ?? "").split(/\r?\n/);
  const out: string[] = [];
  for (const row of rows) {
    const v = String(row ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** "GB" or "US | TX", one per line (or objects). A line without a country code is dropped. */
export function parseTargetPlaces(input: unknown): TargetPlace[] {
  const rows: unknown[] = Array.isArray(input) ? input : String(input ?? "").split(/\r?\n/);
  const out: TargetPlace[] = [];
  for (const row of rows) {
    const [country, region] = typeof row === "string" ? row.split("|").map((p) => p.trim()) : [String((row as TargetPlace)?.country ?? "").trim(), String((row as TargetPlace)?.region ?? "").trim()];
    if (!/^[a-z]{2}$/i.test(country ?? "")) continue;
    const p = { country: country.toUpperCase(), region: (region ?? "").toUpperCase().slice(0, 12) };
    if (!out.some((o) => o.country === p.country && o.region === p.region)) out.push(p);
    if (out.length >= 30) break;
  }
  return out;
}

/** The kinds of reply an answer can be written to. (An opt-out and an out-of-office reply are never answered.) */
export const REPLY_KINDS = ["wants_meeting", "not_now", "interested", "wants_info", "wrong_person"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];
/** "send": the answer goes out on its own. "review": it is written and waits for the operator. "none": no answer is written. */
export const REPLY_ACTIONS = ["send", "review", "none"] as const;
export type ReplyAction = (typeof REPLY_ACTIONS)[number];
export interface ReplyRule {
  action: ReplyAction;
  /** The operator's own instruction for answering this kind of reply; empty = none. */
  note: string;
}
export type ReplyRules = Record<ReplyKind, ReplyRule>;

/** Stored rules, made whole: an unknown kind is dropped, a missing or odd one is "review" without a note. */
export function parseReplyRules(input: unknown): ReplyRules | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, Partial<ReplyRule> | undefined>;
  const out = {} as ReplyRules;
  for (const kind of REPLY_KINDS) {
    const r = raw[kind];
    out[kind] = { action: REPLY_ACTIONS.includes(r?.action as ReplyAction) ? (r!.action as ReplyAction) : "review", note: String(r?.note ?? "").trim().slice(0, 400) };
  }
  return out;
}

/**
 * What happens to each kind of reply. While the operator has not set it, it is what the app always did:
 * every answer waits for them, except that with "answers on autopilot" on, the two that need no decision
 * (a call is asked for, "not now") go out on their own.
 */
export function replyRulesOf(s: Pick<AppSettings, "replyRules" | "autoAnswer">): ReplyRules {
  if (s.replyRules) return s.replyRules;
  const routine: ReplyAction = s.autoAnswer ? "send" : "review";
  return { wants_meeting: { action: routine, note: "" }, not_now: { action: routine, note: "" }, interested: { action: "review", note: "" }, wants_info: { action: "review", note: "" }, wrong_person: { action: "review", note: "" } };
}

export interface AppSettings {
  /** Sender identity: appended to every email by code, never written by the model. */
  senderName: string;
  senderTitle: string;
  senderCompany: string;
  senderWebsite: string;
  /** Postal address: required in commercial email (CAN-SPAM) and shown in the footer. */
  postalAddress: string;
  /** One or two sentences on what the consultancy does, for the email writer. */
  offer: string;
  /** What the customer gets out of it, in their words ("fewer missed calls"). With `offer`, this is what a good fit is judged against. */
  offerResult: string;
  /** A service, a product or software: it changes how an email speaks of it. Empty = not said. */
  offerKind: OfferKind;
  /**
   * Who the operator sells to. The search takes its kind of business and its place from here, and the
   * automatic search works through every kind in every place (see `searchTargetsOf`).
   */
  targetKinds: string[];
  targetPlaces: TargetPlace[];
  /** Sizes of business that fit; empty = any size. */
  targetSizes: TargetSize[];
  /** Only businesses with a website / a phone number are worth finding. */
  targetNeedsWebsite: boolean;
  targetNeedsPhone: boolean;
  /** What shows that a business is a good fit, in the operator's words. */
  fitSigns: string;
  /** Kinds of business never to find. */
  excludeKinds: string[];
  /** Results and customers the operator can back up; the only source for a claim about past work. */
  proofPoints: string;
  /** Optional link to book a call; the only URL an email may contain. */
  bookingLink: string;
  /** A few emails the operator wrote, so the writer can match the voice. */
  voiceSamples: string;
  /** The operator's own signature, used as written. Empty = built from the name, title, company, website and address above. */
  signature: string;
  /** An opt-out sentence added after the signature. Empty (the default) = none: the signature is sent exactly as shown. */
  optOutLine: string;
  /** Emails sent per day at most, the pause between two sends, and the hours (local time) sending may happen. */
  dailySendCap: number;
  sendSpacingSeconds: number;
  sendWindowStart: number;
  sendWindowEnd: number;
  /** Optional limit: when not empty, only businesses in these ISO countries may be emailed. Empty (the default) = every country. */
  allowedCountries: string[];
  /** Each next email of the sequence is drafted this many working days after the previous one went unanswered (0 = never). */
  followUpDays: number;
  /** How many emails follow an unanswered first email: 0, 1 (a follow-up) or 2 (a follow-up, then a short last note). */
  followUpCount: number;
  /** Someone who answered "not now" gets one check-back email after this many days (0 = never). */
  recontactDays: number;
  /**
   * Who presses Send. "manual": the operator approves and sends every email. "hold": an email whose checks all
   * passed goes out on its own once it has waited `holdHours` without being excluded. "auto": it goes out at the next run.
   */
  sendMode: SendMode;
  holdHours: number;
  /** Answers to replies that need no decision (a meeting link, a polite "noted") are written and sent the same way. */
  autoAnswer: boolean;
  /** What happens to each kind of reply, once the operator has set it; null = the defaults (see `replyRulesOf`). */
  replyRules: ReplyRules | null;
  /** Days the next email waits after an out-of-office reply. */
  outOfOfficeDays: number;
  /**
   * What automatic sending may pass on, for the operator who wants it for some emails only. All of these
   * narrow it: an email they leave out stays under Outreach for the operator, exactly as in manual mode.
   */
  /** First emails to a new business. */
  autoSendFirst: boolean;
  /** The emails after an unanswered first one (follow-up, last note) and the check-back after a "not now". */
  autoSendFollowUps: boolean;
  /** Only for businesses whose score is at least this (0 = every business). */
  autoSendMinScore: number;
  /** Nothing is passed on on a Saturday or Sunday (by the clock of the computer the app runs on). */
  autoSendWeekdaysOnly: boolean;
  /** Start searches on its own from the targets below when few businesses are left to research. */
  autoSearch: boolean;
  searchTargets: SearchTarget[];
  /** Searches the app may start on its own per day. */
  searchesPerDay: number;
  /** Write an email automatically for every qualified business with a usable address. */
  autoDraft: boolean;
  /** Research saved businesses on its own, best leads first, to keep emails ready. */
  autoResearch: boolean;
  researchPerDay: number;
  /** Stop automatic research while this many emails already wait for review. */
  readyBuffer: number;
  /** AI spend allowed per calendar month in USD; null = AI_SPEND_LIMIT_USD from the environment. */
  monthlyAiBudgetUsd: number | null;
}

export const SEND_MODES = ["manual", "hold", "auto"] as const;
export type SendMode = (typeof SEND_MODES)[number];

/** One line of "who to look for": a kind of business in plain words and where. The app walks the cities of that area itself. */
export interface SearchTarget {
  what: string;
  /** ISO country code. */
  country: string;
  /** Region code inside the country (a US state, a UK nation); empty = the whole country. */
  region: string;
}

/** "sign makers | GB" or "roofers | US | TX", one per line. Lines that name no business type or no country are dropped. */
export function parseSearchTargets(input: unknown): SearchTarget[] {
  const rows: unknown[] = Array.isArray(input) ? input : String(input ?? "").split(/\r?\n/);
  const out: SearchTarget[] = [];
  for (const row of rows) {
    const [what, country, region] = typeof row === "string" ? row.split("|").map((p) => p.trim()) : [String((row as SearchTarget)?.what ?? "").trim(), String((row as SearchTarget)?.country ?? "").trim(), String((row as SearchTarget)?.region ?? "").trim()];
    if (!what || !/^[a-z]{2}$/i.test(country ?? "")) continue;
    const t = { what: what.slice(0, 80), country: country.toUpperCase(), region: (region ?? "").toUpperCase().slice(0, 12) };
    if (!out.some((o) => o.what.toLowerCase() === t.what.toLowerCase() && o.country === t.country && o.region === t.region)) out.push(t);
  }
  return out.slice(0, 20);
}

export const searchTargetsText = (targets: SearchTarget[]) => targets.map((t) => [t.what, t.country, t.region].filter(Boolean).join(" | ")).join("\n");

export const DEFAULT_SETTINGS: AppSettings = {
  senderName: "",
  senderTitle: "",
  senderCompany: "",
  senderWebsite: "",
  postalAddress: "",
  offer: "",
  offerResult: "",
  offerKind: "",
  targetKinds: [],
  targetPlaces: [],
  targetSizes: [],
  targetNeedsWebsite: false,
  targetNeedsPhone: false,
  fitSigns: "",
  excludeKinds: [],
  proofPoints: "",
  bookingLink: "",
  voiceSamples: "",
  signature: "",
  optOutLine: "",
  dailySendCap: 20,
  sendSpacingSeconds: 120,
  sendWindowStart: 8,
  sendWindowEnd: 18,
  allowedCountries: [],
  followUpDays: 5,
  followUpCount: 2,
  recontactDays: 90,
  sendMode: "manual",
  holdHours: 4,
  autoAnswer: false,
  replyRules: null,
  outOfOfficeDays: 7,
  autoSendFirst: true,
  autoSendFollowUps: true,
  autoSendMinScore: 0,
  autoSendWeekdaysOnly: false,
  autoSearch: false,
  searchTargets: [],
  searchesPerDay: 5,
  autoDraft: true,
  autoResearch: true,
  researchPerDay: 15,
  readyBuffer: 20,
  monthlyAiBudgetUsd: null,
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.workspaceId, await workspaceId())).all();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue;
    const key = r.key as keyof AppSettings;
    const def = DEFAULT_SETTINGS[key];
    const v = r.value;
    // A stored value of the wrong type (a hand-edited row) falls back to the default.
    const ok = key === "replyRules" ? parseReplyRules(v) !== null : key === "monthlyAiBudgetUsd" ? v === null || typeof v === "number" : key === "sendMode" ? SEND_MODES.includes(v as SendMode) : v !== null && typeof v === typeof def && Array.isArray(v) === Array.isArray(def);
    if (ok) out[key] = key === "searchTargets" ? parseSearchTargets(v) : key === "replyRules" ? parseReplyRules(v) : key === "targetPlaces" ? parseTargetPlaces(v) : v;
  }
  return out as unknown as AppSettings;
}

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** Validates and stores a partial update; returns the full settings afterwards. */
export async function saveSettings(patch: Partial<Record<keyof AppSettings, unknown>>): Promise<AppSettings> {
  const db = await getDb();
  const ws = await workspaceId();
  const clean: Partial<Record<keyof AppSettings, unknown>> = {};
  for (const key of KEYS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    switch (key) {
      case "dailySendCap":
        clean[key] = clampInt(v, 1, 200, DEFAULT_SETTINGS.dailySendCap);
        break;
      case "sendSpacingSeconds":
        clean[key] = clampInt(v, 20, 3600, DEFAULT_SETTINGS.sendSpacingSeconds);
        break;
      case "sendWindowStart":
        clean[key] = clampInt(v, 0, 23, DEFAULT_SETTINGS.sendWindowStart);
        break;
      case "sendWindowEnd":
        clean[key] = clampInt(v, 1, 24, DEFAULT_SETTINGS.sendWindowEnd);
        break;
      case "followUpDays":
        clean[key] = clampInt(v, 0, 30, DEFAULT_SETTINGS.followUpDays);
        break;
      case "followUpCount":
        clean[key] = clampInt(v, 0, 2, DEFAULT_SETTINGS.followUpCount);
        break;
      case "recontactDays":
        clean[key] = clampInt(v, 0, 365, DEFAULT_SETTINGS.recontactDays);
        break;
      case "holdHours":
        clean[key] = clampInt(v, 1, 72, DEFAULT_SETTINGS.holdHours);
        break;
      case "searchesPerDay":
        clean[key] = clampInt(v, 1, 5, DEFAULT_SETTINGS.searchesPerDay);
        break;
      case "sendMode":
        clean[key] = SEND_MODES.includes(v as SendMode) ? v : DEFAULT_SETTINGS.sendMode;
        break;
      case "searchTargets":
        clean[key] = parseSearchTargets(v);
        break;
      case "researchPerDay":
        clean[key] = clampInt(v, 0, 200, DEFAULT_SETTINGS.researchPerDay);
        break;
      case "targetKinds":
      case "excludeKinds":
        // Only what reads as a kind of business, and not more of them than a search can work through.
        clean[key] = parseList(v).map(tidyKind).filter(Boolean).slice(0, MAX_KINDS);
        break;
      case "targetPlaces":
        clean[key] = parseTargetPlaces(v);
        break;
      case "targetSizes":
        clean[key] = (Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/)).map((x) => String(x).trim()).filter((x): x is TargetSize => (TARGET_SIZES as readonly string[]).includes(x));
        break;
      case "offerKind":
        clean[key] = (OFFER_KINDS as readonly string[]).includes(String(v)) ? v : "";
        break;
      case "targetNeedsWebsite":
      case "targetNeedsPhone":
        clean[key] = v === true || v === "on" || v === "true";
        break;
      case "replyRules":
        clean[key] = parseReplyRules(v);
        break;
      case "outOfOfficeDays":
        clean[key] = clampInt(v, 1, 30, DEFAULT_SETTINGS.outOfOfficeDays);
        break;
      case "autoSendMinScore":
        clean[key] = clampInt(v, 0, 100, DEFAULT_SETTINGS.autoSendMinScore);
        break;
      case "readyBuffer":
        clean[key] = clampInt(v, 1, 500, DEFAULT_SETTINGS.readyBuffer);
        break;
      case "monthlyAiBudgetUsd": {
        const n = Number(v);
        clean[key] = v === null || v === "" || !Number.isFinite(n) || n <= 0 ? null : Math.round(n * 100) / 100;
        break;
      }
      case "autoDraft":
      case "autoResearch":
      case "autoAnswer":
      case "autoSendFirst":
      case "autoSendFollowUps":
      case "autoSendWeekdaysOnly":
      case "autoSearch":
        clean[key] = v === true || v === "on" || v === "true";
        break;
      case "allowedCountries":
        clean[key] = (Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/)).map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
        break;
      default:
        clean[key] = String(v ?? "").trim().slice(0, key === "voiceSamples" ? 8000 : key === "fitSigns" || key === "proofPoints" ? 1000 : key === "offer" || key === "signature" ? 600 : 300);
    }
  }
  for (const [key, value] of Object.entries(clean)) {
    await db.insert(settingsTable).values({ workspaceId: ws, key, value, updatedAt: nowIso() }).onConflictDoUpdate({ target: [settingsTable.workspaceId, settingsTable.key], set: { value, updatedAt: nowIso() } }).run();
  }
  return getSettings();
}

/**
 * What the app searches for on its own: every kind of business the operator sells to, in every place they
 * sell in. While the profile names none, the older hand-kept list is used, so nothing stops working.
 */
export function searchTargetsOf(s: Pick<AppSettings, "targetKinds" | "targetPlaces" | "searchTargets">): SearchTarget[] {
  if (!s.targetKinds.length || !s.targetPlaces.length) return s.searchTargets;
  const out: SearchTarget[] = [];
  // Kind by kind inside a place, so the first place is covered for everything before the next one starts.
  for (const p of s.targetPlaces) for (const what of s.targetKinds) out.push({ what, country: p.country, region: p.region });
  return out;
}

/**
 * What is still missing, in plain words, for the two things the profile is needed for. Empty = ready.
 * Sending needs who is writing; searching needs what is sold and to whom.
 */
export { saysEnough, OFFER_MIN_CHARS, OFFER_MAX_CHARS } from "./profile-rules";

export function profileGaps(s: AppSettings): { send: string[]; search: string[] } {
  const search: string[] = [];
  if (!saysEnough(s.offer)) search.push("what you offer");
  if (!saysEnough(s.offerResult)) search.push("what your customer gets out of it");
  if (!s.targetKinds.length) search.push("the kinds of business you sell to");
  if (!s.targetPlaces.length) search.push("where you sell");
  return { send: missingSenderDetails(s), search };
}

/** Puts settings back to how the app ships: their stored values are removed, so the defaults apply again. */
export async function resetSettings(keys: (keyof AppSettings)[]): Promise<AppSettings> {
  const db = await getDb();
  const names = keys.filter((k) => KEYS.includes(k));
  if (names.length) await db.delete(settingsTable).where(and(eq(settingsTable.workspaceId, await workspaceId()), inArray(settingsTable.key, names))).run();
  return getSettings();
}

/** What must be filled in before any email may be sent, in plain words. Empty = ready. */
/** What must be known before anything is sent: who is writing and a postal address. A company is optional (a sole operator writes under their own name). */
export function missingSenderDetails(s: AppSettings): string[] {
  const missing: string[] = [];
  if (!s.senderName) missing.push("your name");
  if (!s.postalAddress) missing.push("a postal address (required in commercial email)");
  return missing;
}

/** The monthly AI spend limit in force: the setting when set, otherwise the environment default. */
export async function monthlyAiBudgetUsd(): Promise<number> {
  // One wallet pays for every workspace's AI calls: the limit is the product's own setting, whoever is acting.
  const s = await runInWorkspace(FIRST_WORKSPACE_ID, () => getSettings());
  return s.monthlyAiBudgetUsd ?? getConfig().AI_SPEND_LIMIT_USD;
}

/** Small pieces of system state kept beside the settings (the inbox cursor). Not operator settings. */
export async function getState<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.select().from(settingsTable).where(and(eq(settingsTable.workspaceId, await workspaceId()), eq(settingsTable.key, `state:${key}`))).get();
  return (row?.value as T | undefined) ?? null;
}
export async function setState(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.insert(settingsTable).values({ workspaceId: await workspaceId(), key: `state:${key}`, value, updatedAt: nowIso() }).onConflictDoUpdate({ target: [settingsTable.workspaceId, settingsTable.key], set: { value, updatedAt: nowIso() } }).run();
}
