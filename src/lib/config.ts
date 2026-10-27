/**
 * Central runtime configuration. Everything is read from the environment once,
 * validated, and exposed with sane defaults so the app runs with zero config
 * (demo mode) and degrades explicitly when credentials are missing.
 */
import { z } from "zod";

const Effort = z.enum(["low", "medium", "high", "xhigh", "max"]);

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_EXTRACTION_MODEL: z.string().default("claude-opus-5-5"),
  AI_EXTRACTION_EFFORT: Effort.default("low"),
  AI_ANALYSIS_MODEL: z.string().default("claude-opus-5-5"),
  AI_ANALYSIS_EFFORT: Effort.default("high"),
  AI_OUTREACH_MODEL: z.string().default("claude-opus-5-5"),
  AI_OUTREACH_EFFORT: Effort.default("medium"),
  AI_SPEND_LIMIT_USD: z.coerce.number().positive().default(25),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  OVERPASS_ENDPOINTS: z
    .string()
    .default(
      "https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter",
    ),
  NOMINATIM_ENDPOINT: z.string().default("https://nominatim.openstreetmap.org"),
  OSM_USER_AGENT: z.string().default("opportunity-radar/0.1 (unconfigured contact)"),
  RESEARCH_MAX_PAGES: z.coerce.number().int().min(1).max(20).default(6),
  RESEARCH_PAGE_BYTES_LIMIT: z.coerce.number().int().default(1_500_000),
  RESEARCH_FETCH_TIMEOUT_MS: z.coerce.number().int().default(15_000),
  RESEARCH_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  DATABASE_PATH: z.string().default("./data/radar.db"),
  EMBEDDED_WORKER: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  NODE_ENV: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  ai: { enabled: boolean };
  googlePlaces: { enabled: boolean };
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
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  const serverless = Boolean(process.env.VERCEL);
  // On Vercel the project directory is read-only; /tmp is the only writable location.
  if (serverless && !process.env.DATABASE_PATH) env.DATABASE_PATH = "/tmp/radar.db";
  cached = {
    ...env,
    serverless,
    ai: { enabled: Boolean(apiKey) },
    googlePlaces: { enabled: Boolean(env.GOOGLE_PLACES_API_KEY?.trim()) },
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
    anthropic: {
      label: "Anthropic Claude (research extraction, analysis, outreach)",
      status: c.ai.enabled ? ("live" as const) : ("missing_credentials" as const),
      detail: c.ai.enabled
        ? `Models: extraction=${c.AI_EXTRACTION_MODEL}/${c.AI_EXTRACTION_EFFORT}, analysis=${c.AI_ANALYSIS_MODEL}/${c.AI_ANALYSIS_EFFORT}, outreach=${c.AI_OUTREACH_MODEL}/${c.AI_OUTREACH_EFFORT}. Spend guard $${c.AI_SPEND_LIMIT_USD}.`
        : "Set ANTHROPIC_API_KEY to enable AI stages. Discovery and website fetching still work; demo data illustrates the full workflow.",
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
    csvImport: {
      label: "CSV import",
      status: "live" as const,
      detail: "Import your own business lists (name, website, phone, address, city, region, country).",
    },
    websiteResearch: {
      label: "Website research (bounded crawler)",
      status: "live" as const,
      detail: `Fetches up to ${c.RESEARCH_MAX_PAGES} pages per business, respects robots.txt, ${c.RESEARCH_FETCH_TIMEOUT_MS}ms timeout, SSRF-guarded.`,
    },
    demo: {
      label: "Demo data (synthetic)",
      status: "demo" as const,
      detail: "Synthetic sample businesses, findings, and opportunities. Clearly labeled; never real company data.",
    },
    storage: {
      label: "Storage",
      status: c.serverless ? ("demo" as const) : ("live" as const),
      detail: c.serverless
        ? "Ephemeral serverless deployment: the SQLite database lives in /tmp and resets whenever the function instance is recycled. Demo data is re-seeded automatically. For persistent use, run the app on a VM or container with a disk (see docs/OPERATIONS.md)."
        : `SQLite file at ${c.DATABASE_PATH} (persistent).`,
    },
    outreachSending: {
      label: "Outreach sending",
      status: "not_implemented" as const,
      detail: "Deliberately not implemented in the MVP. Drafts are generated for human review and manual sending.",
    },
  };
}
