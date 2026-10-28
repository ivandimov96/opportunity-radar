import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3100", headless: true },
  webServer: {
    // Fresh database every run (the server opens it before any global setup could delete it).
    command: "rm -f data/e2e.db data/e2e.db-shm data/e2e.db-wal && pnpm exec next build && pnpm exec next start -p 3100",
    url: "http://127.0.0.1:3100/settings",
    reuseExistingServer: false,
    timeout: 120_000,
    // Offline: no bulk data pulls, no browser rendering, no model provider.
    env: { DATABASE_PATH: "./data/e2e.db", EMBEDDED_WORKER: "true", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", OVERTURE_ENABLED: "false", RESEARCH_BROWSER_RENDER: "false" },
  },
});
