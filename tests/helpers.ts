import { closeDatabase, openDatabase } from "@/db/client";
import { resetConfigForTests } from "@/lib/config";

export function useTempDb() {
  process.env.DATABASE_PATH = ":memory:";
  resetConfigForTests();
  closeDatabase();
  return openDatabase(":memory:");
}

export function resetEnv(overrides: Record<string, string | undefined> = {}) {
  for (const k of ["ANTHROPIC_API_KEY", "GOOGLE_PLACES_API_KEY", "AI_SPEND_LIMIT_USD", "RESEARCH_MAX_PAGES"]) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
}
