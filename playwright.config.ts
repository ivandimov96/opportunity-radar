import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3100", headless: true },
  webServer: {
    command: "pnpm exec next build && pnpm exec next start -p 3100",
    url: "http://127.0.0.1:3100/settings",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_PATH: "./data/e2e.db", EMBEDDED_WORKER: "true", ANTHROPIC_API_KEY: "" },
  },
});
