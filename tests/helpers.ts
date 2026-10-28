import { closeDatabase, openDatabase } from "@/db/client";
import { resetConfigForTests } from "@/lib/config";

export async function useTempDb() {
  process.env.DATABASE_PATH = ":memory:";
  resetConfigForTests();
  closeDatabase();
  return openDatabase(":memory:");
}

export function resetEnv(overrides: Record<string, string | undefined> = {}) {
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "AI_PROVIDER", "AI_INVESTIGATE_MODEL", "AI_OUTREACH_MODEL", "GOOGLE_PLACES_API_KEY", "AI_SPEND_LIMIT_USD", "RESEARCH_MAX_PAGES", "TURSO_DATABASE_URL", "BRAVE_SEARCH_API_KEY", "RESEARCH_BROWSER_RENDER", "OVERTURE_ENABLED"]) delete process.env[k];
  process.env.OVERTURE_ENABLED = "false";
  process.env.RESEARCH_BROWSER_RENDER = "false";
  // Tests never touch the network: no off-site lookups, no web search provider.
  process.env.RESEARCH_FOOTPRINT = "false";
  process.env.WEB_SEARCH_PROVIDER = "off";
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
}
