import { describe, expect, it } from "vitest";
import { appEnv, checkEnvironment } from "@/lib/app-env";

describe("which environment a process is", () => {
  it("follows how the app was started when nothing says otherwise", () => {
    expect(appEnv({ NODE_ENV: "development" })).toBe("development");
    expect(appEnv({ NODE_ENV: "production" })).toBe("production");
    expect(appEnv({})).toBe("development");
    expect(appEnv({ NODE_ENV: "production", VITEST: "true" })).toBe("test");
  });

  it("takes the host's word: only the production deployment is production", () => {
    expect(appEnv({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" })).toBe("production");
    expect(appEnv({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview" })).toBe("development");
  });

  it("lets APP_ENV say it outright and refuses a name it does not know", () => {
    expect(appEnv({ NODE_ENV: "production", APP_ENV: "test" })).toBe("test");
    expect(appEnv({ NODE_ENV: "development", APP_ENV: " Production " })).toBe("production");
    expect(() => appEnv({ APP_ENV: "staging" })).toThrow(/development, production or test/);
  });
});

describe("settings that do not fit their environment", () => {
  const production = { NODE_ENV: "production", AUTH_SECRET: "a-long-secret-for-signing", MAILBOX_SECRET: "another-long-secret", APP_URL: "https://app.radar.example", TURSO_DATABASE_URL: "libsql://radar.example", TURSO_AUTH_TOKEN: "t", CRON_SECRET: "c", ACCOUNT_SMTP_HOST: "smtp.radar.example", VERCEL: "1", VERCEL_ENV: "production" };

  it("stops development and tests from opening the hosted database", () => {
    expect(checkEnvironment({ NODE_ENV: "development", TURSO_DATABASE_URL: "libsql://radar.example" }).blocking).toHaveLength(1);
    expect(checkEnvironment({ VITEST: "true", TURSO_DATABASE_URL: "libsql://radar.example" }).blocking).toHaveLength(1);
    expect(checkEnvironment({ NODE_ENV: "development", TURSO_DATABASE_URL: "libsql://radar-dev.example", DEV_REMOTE_DATABASE: "allow" }).blocking).toEqual([]);
    expect(checkEnvironment({ NODE_ENV: "development", DATABASE_PATH: "./data/dev.db" })).toEqual({ env: "development", blocking: [], warnings: [] });
  });

  it("says in development that the product's own emails are real", () => {
    expect(checkEnvironment({ NODE_ENV: "development", ACCOUNT_EMAILS: "on" }).warnings.join(" ")).toMatch(/real email/);
  });

  it("refuses the test mailbox in production", () => {
    expect(checkEnvironment({ ...production, MAIL_PROVIDER: "fake" }).blocking.join(" ")).toMatch(/reach nobody/);
  });

  it("has nothing to say about a complete production", () => {
    expect(checkEnvironment(production)).toEqual({ env: "production", blocking: [], warnings: [] });
  });

  it("lists what production still lacks, one line each", () => {
    const bare = checkEnvironment({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" });
    expect(bare.blocking).toEqual([]);
    for (const word of ["AUTH_SECRET", "MAILBOX_SECRET", "APP_URL", "hosted database", "CRON_SECRET", "emails of its own"]) expect(bare.warnings.join("\n")).toContain(word);
    expect(checkEnvironment({ ...production, APP_URL: "http://app.radar.example" }).warnings.join(" ")).toMatch(/https/);
    expect(checkEnvironment({ ...production, APP_URL: "https://localhost:3000" }).warnings.join(" ")).toMatch(/this computer/);
    expect(checkEnvironment({ NODE_ENV: "production", DATABASE_PATH: "./data/dev.db", AUTH_SECRET: "a-long-secret-for-signing" }).warnings.join(" ")).toMatch(/development database/);
  });
});
