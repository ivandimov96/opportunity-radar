/**
 * Central runtime configuration. Everything is read from the environment once,
 * validated, and exposed with sane defaults so the app runs with zero config
 * (demo mode) and degrades explicitly when credentials are missing.
 */
import { z } from "zod";

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
  AI_SPEND_LIMIT_USD: z.coerce.number().positive().default(25),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  /** Web search used to locate websites for businesses that have none on record. auto = Brave when keyed, otherwise none (verified domain guesses only). duckduckgo = keyless HTML endpoint, opt-in (bot challenges observed). */
  WEB_SEARCH_PROVIDER: z.enum(["auto", "brave", "duckduckgo", "off"]).default("auto"),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  /** Optional Socrata app token (free) for higher rate limits on open-data registries. */
  SOCRATA_APP_TOKEN: z.string().optional(),
  /** Overture Maps Places (bulk open data read with DuckDB over S3; needs a long-lived host, not serverless). */
  OVERTURE_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  OVERTURE_RELEASE: z.string().default("2026-10-21.0"),
  OVERTURE_CACHE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Headless-browser rendering fallback for JavaScript-only sites (local hosts only). */
  RESEARCH_BROWSER_RENDER: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
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
  OVERPASS_ENDPOINTS: z
    .string()
    .default(
      "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ),
  NOMINATIM_ENDPOINT: z.string().default("https://nominatim.openstreetmap.org"),
  OSM_USER_AGENT: z.string().default("opportunity-radar/0.1 (unconfigured contact)"),
  RESEARCH_MAX_PAGES: z.coerce.number().int().min(1).max(12).default(5),
  RESEARCH_PAGE_BYTES_LIMIT: z.coerce.number().int().default(1_500_000),
  RESEARCH_FETCH_TIMEOUT_MS: z.coerce.number().int().default(10_000),
  RESEARCH_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(4),
  DATABASE_PATH: z.string().default("./data/radar.db"),
  /** Hosted libSQL/Turso database (persistent in the cloud). When set, DATABASE_PATH is ignored. */
  TURSO_DATABASE_URL: z.string().optional(),
  TURSO_AUTH_TOKEN: z.string().optional(),
  EMBEDDED_WORKER: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  NODE_ENV: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  ai: { enabled: boolean; provider: "anthropic" | "openai" | null };
  googlePlaces: { enabled: boolean };
  webSearch: { provider: "brave" | "duckduckgo" | null };
  overture: { enabled: boolean };
  browserRender: { enabled: boolean };
  overpassEndpoints: string[];
  /** Running on Vercel serverless: storage is ephemeral and no long-lived worker exists. */
  serverless: boolean;
};

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  const env = parsed.data;
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const hasOpenAi = Boolean(env.OPENAI_API_KEY?.trim());
  const provider = env.AI_PROVIDER === "anthropic" ? (hasAnthropic ? "anthropic" : null) : env.AI_PROVIDER === "openai" ? (hasOpenAi ? "openai" : null) : hasAnthropic ? "anthropic" : hasOpenAi ? "openai" : null;
  const serverless = Boolean(process.env.VERCEL);
  if (!env.TURSO_DATABASE_URL?.trim()) env.TURSO_DATABASE_URL = undefined;
  // On Vercel the project directory is read-only; /tmp is the only writable location.
  if (serverless && !process.env.DATABASE_PATH) env.DATABASE_PATH = "/tmp/radar.db";
  cached = {
    ...env,
    serverless,
    ai: { enabled: provider !== null, provider },
    googlePlaces: { enabled: Boolean(env.GOOGLE_PLACES_API_KEY?.trim()) },
    overture: { enabled: env.OVERTURE_ENABLED && !serverless },
    browserRender: { enabled: env.RESEARCH_BROWSER_RENDER && !serverless },
    webSearch: { provider: env.WEB_SEARCH_PROVIDER === "brave" || (env.WEB_SEARCH_PROVIDER === "auto" && env.BRAVE_SEARCH_API_KEY?.trim()) ? "brave" : env.WEB_SEARCH_PROVIDER === "duckduckgo" ? "duckduckgo" : null },
    overpassEndpoints: env.OVERPASS_ENDPOINTS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  return cached;
}

/** Test helper: reset cached config after mutating process.env. */
export function resetConfigForTests() {
  cached = null;
}

/**
 * Status of every external capability, surfaced in the UI so the operator
 * always knows what is live, what is demo, and what needs credentials.
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
    overture: {
      label: "Overture Maps Places (bulk open data)",
      status: c.overture.enabled ? ("live" as const) : ("demo" as const),
      detail: c.overture.enabled
        ? `Release ${c.OVERTURE_RELEASE}, read with DuckDB directly from the public S3 bucket, no key. Names, categories, websites, phones, emails, socials, brand and open/closed status for ~50M places worldwide (CDLA-Permissive 2.0). Results are cached ${c.OVERTURE_CACHE_DAYS} days per area and category set.`
        : "Disabled on serverless hosts (needs the native DuckDB binary and a long-lived process) or by OVERTURE_ENABLED=false. OpenStreetMap is used instead.",
    },
    osm: {
      label: "OpenStreetMap discovery (Overpass + Nominatim)",
      status: "live" as const,
      detail: `No credentials needed. Data © OpenStreetMap contributors (ODbL). Endpoints: ${c.overpassEndpoints.join(", ")}. Shared public instances are rate-limited and sometimes overloaded; use a paid or self-hosted instance for sustained volume.`,
    },
    googlePlaces: {
      label: "Google Places API (New)",
      status: c.googlePlaces.enabled ? ("live" as const) : ("missing_credentials" as const),
      detail: c.googlePlaces.enabled
        ? "Enabled. Only place IDs are stored indefinitely per Google's Places policies; other fields are refreshed from the API."
        : "Set GOOGLE_PLACES_API_KEY to enable. Review Google Maps Platform terms (caching limits, attribution) before use.",
    },
    txPermits: {
      label: "Texas sales tax permit holders (Comptroller open data)",
      status: "live" as const,
      detail: `Free public registry of active Texas businesses by NAICS code and city (names, addresses, permit dates; no phone or website). Updated by the Comptroller; no key needed${c.SOCRATA_APP_TOKEN ? " (app token set)" : " (set SOCRATA_APP_TOKEN, free, for higher rate limits)"}. Texas only.`,
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
      label: "Website research (bounded crawler)",
      status: "live" as const,
      detail: `Fetches the homepage plus up to ${c.RESEARCH_MAX_PAGES - 1} key pages per business in parallel (root/scheme/www fallbacks, sitemap for JS-rendered menus), respects robots.txt, ${c.RESEARCH_FETCH_TIMEOUT_MS}ms timeout, SSRF-guarded. Deterministic facts from page resources, schema.org data and text cues.`,
    },
    footprint: {
      label: "Off-site footprint (RDAP, DNS, Internet Archive)",
      status: c.RESEARCH_FOOTPRINT ? ("live" as const) : ("demo" as const),
      detail: c.RESEARCH_FOOTPRINT ? "Keyless public records: domain registration year, email hosting and authorized senders (MX/SPF), first archived capture. Each lookup is bounded and optional." : "Disabled (RESEARCH_FOOTPRINT=false).",
    },
    webSearch: {
      label: "Web search (website finder)",
      status: c.webSearch.provider ? ("live" as const) : ("missing_credentials" as const),
      detail: c.webSearch.provider === "brave" ? "Brave Search API (keyed). Used only to locate a website for businesses without one; every candidate is verified against the business phone/name before being stored." : c.webSearch.provider === "duckduckgo" ? "DuckDuckGo HTML results (no key, opt-in, throttled to one query per 3 s). Automated queries were met with a bot challenge in live checks; set BRAVE_SEARCH_API_KEY for a supported provider. Candidates are verified against the business phone/name before being stored." : "No web search provider. The website finder still tries verified domain guesses (name-based .com/.net, accepted only when the business phone or name + city appear on the page). Set BRAVE_SEARCH_API_KEY (free tier) to also search the web.",
    },
    demo: {
      label: "Demo data (synthetic)",
      status: "demo" as const,
      detail: "Synthetic sample businesses, findings, and opportunities. Clearly labeled; never real company data.",
    },
    storage: {
      label: "Storage",
      status: c.TURSO_DATABASE_URL ? ("live" as const) : c.serverless ? ("demo" as const) : ("live" as const),
      detail: c.TURSO_DATABASE_URL
        ? "Hosted libSQL (Turso) database: persistent and shared across all server instances."
        : c.serverless
          ? "Ephemeral serverless deployment: each server instance has its own temporary SQLite file, so changes are not reliably kept between requests. Demo data is re-seeded automatically. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for persistence."
          : `Local SQLite file at ${c.DATABASE_PATH} (persistent).`,
    },
    outreachSending: {
      label: "Outreach sending",
      status: "not_implemented" as const,
      detail: "Deliberately not implemented in the MVP. Drafts are generated for human review and manual sending.",
    },
  };
}
