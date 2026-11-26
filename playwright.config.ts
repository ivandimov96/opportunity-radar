import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3100", headless: true },
  webServer: {
    // Fresh database every run (the server opens it before any global setup could delete it).
    command: "rm -f data/e2e.db data/e2e.db-shm data/e2e.db-wal && pnpm exec tsx tests/fixtures/seed-e2e.ts && pnpm exec next build && pnpm exec next start -p 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 120_000,
    // Offline: no model provider, no crawling, no search credits, and an in-memory mailbox (nothing is ever sent).
    // APP_ENV says this built app is a test, and the hosted database is blanked, so a production settings file on this computer is never used.
    env: { APP_ENV: "test", TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", MICROSOFT_CLIENT_ID: "", MICROSOFT_CLIENT_SECRET: "", ACCOUNT_EMAILS: "", ACCOUNT_SMTP_HOST: "", AUTH_SECRET: "browser-test-secret-not-used-anywhere-else", DATABASE_PATH: "./data/e2e.db", EMBEDDED_WORKER: "true", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", FIRECRAWL_API_KEY: "", SERPER_API_KEY: "", MAIL_PROVIDER: "fake", MAIL_USER: "ivan@dimov.example", MAIL_PASSWORD: "" },
  },
});
