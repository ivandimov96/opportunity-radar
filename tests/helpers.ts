import { closeDatabase, openDatabase } from "@/db/client";
import { resetConfigForTests } from "@/lib/config";

export async function useTempDb() {
  process.env.DATABASE_PATH = ":memory:";
  resetConfigForTests();
  closeDatabase();
  return openDatabase(":memory:");
}

export function resetEnv(overrides: Record<string, string | undefined> = {}) {
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "AI_PROVIDER", "SIGNUP_MODE", "ACCOUNT_EMAILS", "ACCOUNT_SMTP_HOST", "ACCOUNT_SMTP_USER", "ACCOUNT_SMTP_PASSWORD", "ACCOUNT_MAIL_FROM", "ACCOUNT_SMTP_PORT", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "AI_INVESTIGATE_MODEL", "AI_OUTREACH_MODEL", "SERPER_API_KEY", "SERPER_CREDIT_BUDGET", "SERPER_MAX_PAGES", "SERPER_CACHE_DAYS", "AI_SPEND_LIMIT_USD", "RESEARCH_MAX_PAGES", "TURSO_DATABASE_URL", "BRAVE_SEARCH_API_KEY", "FIRECRAWL_API_KEY", "FIRECRAWL_API_URL", "FIRECRAWL_MONTHLY_CREDIT_BUDGET", "RESEARCH_REQUIRE_EMAIL", "MAIL_PROVIDER", "MAIL_USER", "MAIL_PASSWORD", "MAIL_FROM", "MAIL_SMTP_HOST", "MAIL_IMAP_HOST"]) delete process.env[k];
  // Tests never touch the network: no off-site lookups, no web search provider.
  process.env.RESEARCH_FOOTPRINT = "false";
  process.env.WEB_SEARCH_PROVIDER = "off";
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
}
