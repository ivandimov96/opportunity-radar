/**
 * Operator settings kept in the database: who the emails come from, how many
 * go out, and what the system may do on its own. API keys and the mailbox
 * password are NOT settings: they stay in the environment and never reach the
 * browser. Every value has a default, so the app runs before anything is set.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings as settingsTable } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { nowIso } from "@/lib/ids";

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
  autoSearch: false,
  searchTargets: [],
  searchesPerDay: 1,
  autoDraft: true,
  autoResearch: true,
  researchPerDay: 15,
  readyBuffer: 20,
  monthlyAiBudgetUsd: null,
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const rows = await db.select().from(settingsTable).all();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue;
    const key = r.key as keyof AppSettings;
    const def = DEFAULT_SETTINGS[key];
    const v = r.value;
    // A stored value of the wrong type (a hand-edited row) falls back to the default.
    const ok = key === "monthlyAiBudgetUsd" ? v === null || typeof v === "number" : key === "sendMode" ? SEND_MODES.includes(v as SendMode) : v !== null && typeof v === typeof def && Array.isArray(v) === Array.isArray(def);
    if (ok) out[key] = key === "searchTargets" ? parseSearchTargets(v) : v;
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
      case "autoSearch":
        clean[key] = v === true || v === "on" || v === "true";
        break;
      case "allowedCountries":
        clean[key] = (Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/)).map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
        break;
      default:
        clean[key] = String(v ?? "").trim().slice(0, key === "voiceSamples" ? 8000 : key === "offer" || key === "signature" ? 600 : 300);
    }
  }
  for (const [key, value] of Object.entries(clean)) {
    await db.insert(settingsTable).values({ key, value, updatedAt: nowIso() }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: nowIso() } }).run();
  }
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
  const s = await getSettings();
  return s.monthlyAiBudgetUsd ?? getConfig().AI_SPEND_LIMIT_USD;
}

/** Small pieces of system state kept beside the settings (the inbox cursor). Not operator settings. */
export async function getState<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.select().from(settingsTable).where(eq(settingsTable.key, `state:${key}`)).get();
  return (row?.value as T | undefined) ?? null;
}
export async function setState(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.insert(settingsTable).values({ key: `state:${key}`, value, updatedAt: nowIso() }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: nowIso() } }).run();
}
