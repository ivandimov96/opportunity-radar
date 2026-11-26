/**
 * Central runtime configuration. Everything is read from the environment once,
 * validated, and exposed with sane defaults so the app runs with zero config
 * and degrades explicitly when credentials are missing.
 */
import { z } from "zod";
import { checkEnvironment, type AppEnv } from "@/lib/app-env";

const Effort = z.enum(["low", "medium", "high", "xhigh", "max"]);

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  /** auto = first configured provider (Anthropic, then OpenAI). */
  AI_PROVIDER: z.enum(["auto", "anthropic", "openai"]).default("auto"),
  /** Model overrides; empty = the provider's default for the stage. */
  AI_INVESTIGATE_MODEL: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  AI_INVESTIGATE_EFFORT: Effort.default("medium"),
  AI_OUTREACH_MODEL: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  AI_OUTREACH_EFFORT: Effort.default("medium"),
  /** AI spend allowed per calendar month (Settings can override it). */
  AI_SPEND_LIMIT_USD: z.coerce.number().positive().default(30),
  /** Serper (google.serper.dev): Google Maps listings. Free sign-up credits (2,500) do not renew; a maps page costs 3 credits. */
  /** A SQLite file bundled with the deployment. On a serverless host without Turso it is copied to the temporary database on every cold start, so the deployment shows a fixed data set (read-mostly showcase). */
  DATABASE_SNAPSHOT: z.string().default("./data/snapshot/radar.db"),
  SERPER_API_KEY: z.string().optional(),
  SERPER_CREDIT_BUDGET: z.coerce.number().int().min(1).default(2500),
  SERPER_MAX_PAGES: z.coerce.number().int().min(1).max(6).default(3),
  SERPER_CACHE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Web search used to locate websites for businesses that have none on record. auto = Brave when keyed, otherwise none (verified domain guesses only). duckduckgo = keyless HTML endpoint, opt-in (bot challenges observed). */
  WEB_SEARCH_PROVIDER: z.enum(["auto", "brave", "duckduckgo", "off"]).default("auto"),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  /** Firecrawl: the only way website pages are fetched. Key from firecrawl.dev (free plan: 1,000 credits/month). */
  FIRECRAWL_API_KEY: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  /** Cloud API by default; point at a self-hosted instance to avoid credits entirely. */
  FIRECRAWL_API_URL: z.string().default("https://api.firecrawl.dev"),
  /** Plan limits (free: 2 concurrent, 10 scrapes/min). The limiter is process-wide. */
  FIRECRAWL_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
  FIRECRAWL_RPM: z.coerce.number().int().min(1).max(5000).default(10),
  FIRECRAWL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  /** New crawls stop when credits recorded this calendar month reach this (the free plan renews 1,000). */
  FIRECRAWL_MONTHLY_CREDIT_BUDGET: z.coerce.number().int().min(1).default(1000),
  /** Research older than this is shown as stale and re-investigated when the operator asks. */
  RESEARCH_STALE_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  /** Off-site lookups (RDAP, DNS, Internet Archive) during investigation. */
  RESEARCH_FOOTPRINT: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  /** Try to locate a website (search + verified domain guesses) when a business has none. */
  RESEARCH_FIND_WEBSITE: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  /** Stop research (before the remaining pages and the model call) when no public email is found on the homepage and contact page. */
  RESEARCH_REQUIRE_EMAIL: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  NOMINATIM_ENDPOINT: z.string().default("https://nominatim.openstreetmap.org"),
  OSM_USER_AGENT: z.string().default("opportunity-radar/0.1 (unconfigured contact)"),
  /** Pages per business including the homepage; each is one Firecrawl credit. */
  RESEARCH_MAX_PAGES: z.coerce.number().int().min(1).max(12).default(6),
  RESEARCH_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(4),
  DATABASE_PATH: z.string().default("./data/radar.db"),
  /** Hosted libSQL/Turso database (persistent in the cloud). When set, DATABASE_PATH is ignored. */
  TURSO_DATABASE_URL: z.string().optional(),
  TURSO_AUTH_TOKEN: z.string().optional(),
  EMBEDDED_WORKER: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  /**
   * The mailbox outreach is sent from and replies are read from. gmail | yahoo | icloud | zoho | fastmail | outlook
   * fill in the servers; custom needs MAIL_SMTP_HOST and MAIL_IMAP_HOST; fake keeps everything in memory (tests).
   * MAIL_PASSWORD is an app password created in the mailbox's security settings, never the account password.
   */
  MAIL_PROVIDER: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() || undefined),
  MAIL_USER: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  MAIL_PASSWORD: z.string().optional(),
  /** The address in From; defaults to MAIL_USER. */
  MAIL_FROM: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() || undefined),
  MAIL_SMTP_HOST: z.string().optional(),
  MAIL_SMTP_PORT: z.coerce.number().int().optional(),
  MAIL_IMAP_HOST: z.string().optional(),
  MAIL_IMAP_PORT: z.coerce.number().int().optional(),
  NODE_ENV: z.string().optional(),
});

/** Servers of the common mailbox providers (app-password sign-in). */
export const MAIL_PRESETS: Record<string, { label: string; smtp: { host: string; port: number }; imap: { host: string; port: number } }> = {
  gmail: { label: "Gmail / Google Workspace", smtp: { host: "smtp.gmail.com", port: 465 }, imap: { host: "imap.gmail.com", port: 993 } },
  yahoo: { label: "Yahoo Mail", smtp: { host: "smtp.mail.yahoo.com", port: 465 }, imap: { host: "imap.mail.yahoo.com", port: 993 } },
  icloud: { label: "iCloud Mail", smtp: { host: "smtp.mail.me.com", port: 587 }, imap: { host: "imap.mail.me.com", port: 993 } },
  zoho: { label: "Zoho Mail", smtp: { host: "smtp.zoho.com", port: 465 }, imap: { host: "imap.zoho.com", port: 993 } },
  fastmail: { label: "Fastmail", smtp: { host: "smtp.fastmail.com", port: 465 }, imap: { host: "imap.fastmail.com", port: 993 } },
  outlook: { label: "Outlook / Microsoft 365", smtp: { host: "smtp.office365.com", port: 587 }, imap: { host: "outlook.office365.com", port: 993 } },
};

export interface MailConfig {
  enabled: boolean;
  provider: string | null;
  /** Why the mailbox is not usable, in plain words; null when it is. */
  reason: string | null;
  address: string | null;
  user: string | null;
  password: string | null;
  smtp: { host: string; port: number; secure: boolean } | null;
  imap: { host: string; port: number } | null;
}

function resolveMail(env: z.infer<typeof EnvSchema>, serverless: boolean): MailConfig {
  const off = (reason: string, provider: string | null = null): MailConfig => ({ enabled: false, provider, reason, address: null, user: null, password: null, smtp: null, imap: null });
  const provider = env.MAIL_PROVIDER ?? null;
  if (!provider) return off("No mailbox is connected (set MAIL_PROVIDER, MAIL_USER and MAIL_PASSWORD in .env).");
  if (serverless) return off("Sending is switched off on a serverless deployment.", provider);
  if (provider === "fake") return { enabled: true, provider, reason: null, address: env.MAIL_FROM ?? env.MAIL_USER ?? "me@fake.local", user: env.MAIL_USER ?? "me@fake.local", password: null, smtp: null, imap: null };
  const preset = MAIL_PRESETS[provider];
  if (!preset && provider !== "custom") return off(`Unknown MAIL_PROVIDER "${provider}" (use ${Object.keys(MAIL_PRESETS).join(", ")} or custom).`, provider);
  const smtpHost = env.MAIL_SMTP_HOST?.trim() || preset?.smtp.host;
  const imapHost = env.MAIL_IMAP_HOST?.trim() || preset?.imap.host;
  if (!smtpHost || !imapHost) return off("MAIL_PROVIDER=custom needs MAIL_SMTP_HOST and MAIL_IMAP_HOST.", provider);
  if (!env.MAIL_USER || !env.MAIL_PASSWORD?.trim()) return off("MAIL_USER and MAIL_PASSWORD (an app password) are not set.", provider);
  const smtpPort = env.MAIL_SMTP_PORT ?? preset?.smtp.port ?? 465;
  return { enabled: true, provider, reason: null, address: env.MAIL_FROM ?? env.MAIL_USER.toLowerCase(), user: env.MAIL_USER, password: env.MAIL_PASSWORD.trim(), smtp: { host: smtpHost, port: smtpPort, secure: smtpPort === 465 }, imap: { host: imapHost, port: env.MAIL_IMAP_PORT ?? preset?.imap.port ?? 993 } };
}

export type AppConfig = z.infer<typeof EnvSchema> & {
  ai: { enabled: boolean; provider: "anthropic" | "openai" | null };
  googleMaps: { enabled: boolean };
  webSearch: { provider: "brave" | "duckduckgo" | null };
  firecrawl: { enabled: boolean };
  mail: MailConfig;
  /** Running on Vercel serverless: storage is ephemeral and no long-lived worker exists. */
  serverless: boolean;
  /** Development, production or test (src/lib/app-env.ts). */
  appEnv: AppEnv;
  /** What is not yet as it should be for this environment; shown on the System page. */
  envWarnings: string[];
};

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  const env = parsed.data;
  // Settings of one environment used in the other (the production database opened from development, the test
  // mailbox in production) stop the app here, before anything is read or written.
  const check = checkEnvironment(process.env);
  if (check.blocking.length) throw new Error(`The settings do not fit the ${check.env} environment:\n- ${check.blocking.join("\n- ")}`);
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const hasOpenAi = Boolean(env.OPENAI_API_KEY?.trim());
  const provider = env.AI_PROVIDER === "anthropic" ? (hasAnthropic ? "anthropic" : null) : env.AI_PROVIDER === "openai" ? (hasOpenAi ? "openai" : null) : hasAnthropic ? "anthropic" : hasOpenAi ? "openai" : null;
  const serverless = Boolean(process.env.VERCEL);
  if (!env.TURSO_DATABASE_URL?.trim()) env.TURSO_DATABASE_URL = undefined;
  // On Vercel the project directory is read-only; /tmp is the only writable location.
  // Only /tmp is writable there, whatever DATABASE_PATH says (measured: the default "./data/radar.db" resolved
  // under the read-only function directory and every page failed with ENOENT on mkdir).
  if (serverless && !env.DATABASE_PATH.startsWith("/tmp/") && env.DATABASE_PATH !== ":memory:") env.DATABASE_PATH = "/tmp/radar.db";
  cached = {
    ...env,
    serverless,
    appEnv: check.env,
    envWarnings: check.warnings,
    ai: { enabled: provider !== null, provider },
    googleMaps: { enabled: Boolean(env.SERPER_API_KEY?.trim()) },
    firecrawl: { enabled: Boolean(env.FIRECRAWL_API_KEY) },
    mail: resolveMail(env, serverless),
    webSearch: { provider: env.WEB_SEARCH_PROVIDER === "brave" || (env.WEB_SEARCH_PROVIDER === "auto" && env.BRAVE_SEARCH_API_KEY?.trim()) ? "brave" : env.WEB_SEARCH_PROVIDER === "duckduckgo" ? "duckduckgo" : null },
  };
  return cached;
}

/** Test helper: reset cached config after mutating process.env. */
export function resetConfigForTests() {
  cached = null;
}

/**
 * Status of every external capability, surfaced in the UI so the operator
 * always knows what is live and what needs credentials.
 */
export function integrationStatus() {
  const c = getConfig();
  return {
    ai: {
      label: "Model provider (profile extraction, opportunity analysis, outreach drafts)",
      status: c.ai.enabled ? ("live" as const) : ("missing_credentials" as const),
      detail: c.ai.enabled
        ? `${c.ai.provider === "openai" ? "OpenAI" : "Anthropic Claude"} · investigate=${c.AI_INVESTIGATE_MODEL ?? "provider default"}/${c.AI_INVESTIGATE_EFFORT}, outreach=${c.AI_OUTREACH_MODEL ?? "provider default"}/${c.AI_OUTREACH_EFFORT}. Spend guard $${c.AI_SPEND_LIMIT_USD}. One structured-output contract for both providers; outputs are schema-validated and quote-grounded in code.`
        : "Set ANTHROPIC_API_KEY or OPENAI_API_KEY (AI_PROVIDER picks when both exist). Without a key: discovery, website research, deterministic facts, rule-based hypotheses, scoring and template drafts all work; the model adds subtler facts and hypotheses and personalized drafts.",
    },
    googleMaps: {
      label: "Google Maps listings (Serper)",
      status: c.googleMaps.enabled ? ("live" as const) : ("missing_credentials" as const),
      detail: c.googleMaps.enabled
        ? `The only active discovery source. Up to ${c.SERPER_MAX_PAGES} pages of 20 listings per query, 3 credits per page, budget ${c.SERPER_CREDIT_BUDGET} credits in total (sign-up gives 2,500 that do not renew, about 830 pages), pages cached for ${c.SERPER_CACHE_DAYS} days. Name, category, address, phone, website, rating, reviews.`
        : "Set SERPER_API_KEY (serper.dev; 2,500 free credits on sign-up, no card) to enable. Without it no search can run.",
    },
    places: {
      label: "City suggestions (bundled GeoNames places)",
      status: "live" as const,
      detail: "16,000 US places with population and coordinates bundled from GeoNames (CC BY 4.0). Powers the state → city typeahead on the search form and radius centers; no network call.",
    },
    csvImport: {
      label: "CSV import",
      status: "live" as const,
      detail: "Import your own business lists (name, website, phone, address, city, region, country).",
    },
    websiteResearch: {
      label: "Website research (Firecrawl)",
      status: c.firecrawl.enabled ? ("live" as const) : ("missing_credentials" as const),
      detail: c.firecrawl.enabled
        ? `Firecrawl at ${c.FIRECRAWL_API_URL}: the homepage plus up to ${c.RESEARCH_MAX_PAGES - 1} key pages per business (1 credit per page; 1 more for a site map when the menu is script-rendered), ${c.FIRECRAWL_CONCURRENCY} in flight, ${c.FIRECRAWL_RPM} requests/min, monthly budget ${c.FIRECRAWL_MONTHLY_CREDIT_BUDGET} credits. robots.txt respected, bot-protection pages recorded rather than bypassed, every URL guarded. Pages are stored and reused for ${c.RESEARCH_STALE_DAYS} days; re-analysis never costs credits.`
        : "Set FIRECRAWL_API_KEY (firecrawl.dev; the free plan includes 1,000 credits a month, roughly 150 businesses at 5–6 pages each). Without it: discovery and re-analysis of stored pages work; new website research does not run.",
    },
    footprint: {
      label: "Off-site footprint (RDAP, DNS, Internet Archive)",
      status: c.RESEARCH_FOOTPRINT ? ("live" as const) : ("disabled" as const),
      detail: c.RESEARCH_FOOTPRINT ? "Keyless public records: domain registration year, email hosting and authorized senders (MX/SPF), first archived capture. Each lookup is bounded and optional." : "Disabled (RESEARCH_FOOTPRINT=false).",
    },
    webSearch: {
      label: "Web search (website finder)",
      status: c.webSearch.provider ? ("live" as const) : ("missing_credentials" as const),
      detail: c.webSearch.provider === "brave" ? "Brave Search API (keyed). Used only to locate a website for businesses without one; every candidate is verified against the business phone/name before being stored." : c.webSearch.provider === "duckduckgo" ? "DuckDuckGo HTML results (no key, opt-in, throttled to one query per 3 s). Automated queries were met with a bot challenge in live checks; set BRAVE_SEARCH_API_KEY for a supported provider. Candidates are verified against the business phone/name before being stored." : "No web search provider. The website finder still tries verified domain guesses (name-based .com/.net, accepted only when the business phone or name + city appear on the page). Set BRAVE_SEARCH_API_KEY to also search the web (paid by use since 2026, with a small monthly credit).",
    },
    storage: {
      label: "Storage",
      status: c.TURSO_DATABASE_URL ? ("live" as const) : c.serverless ? ("missing_credentials" as const) : ("live" as const),
      detail: c.TURSO_DATABASE_URL
        ? "Hosted libSQL (Turso) database: persistent and shared across all server instances."
        : c.serverless
          ? "Ephemeral serverless deployment: each server instance has its own temporary SQLite file, so changes are not reliably kept between requests. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for persistence."
          : `Local SQLite file at ${c.DATABASE_PATH} (persistent).`,
    },
    outreachSending: {
      label: "Outreach sending",
      status: "not_implemented" as const,
      detail: "Deliberately not implemented in the MVP. Drafts are generated for human review and manual sending.",
    },
  };
}
