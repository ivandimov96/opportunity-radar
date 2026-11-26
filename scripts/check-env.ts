/**
 * Checks the settings file of one environment without starting anything:
 *
 *   pnpm env:check               # development (.env.development.local)
 *   pnpm env:check production    # production (.env.production.local, when production is run from a file)
 *
 * It prints which settings are filled in (names only, never a value), what does not fit the environment,
 * and any secret that has the same value in both files. It opens no database and calls no service.
 */
import fs from "node:fs";
import { parseEnv } from "node:util";
import { checkEnvironment, type AppEnv } from "../src/lib/app-env";

const which = (process.argv[2] ?? "development") as AppEnv;
if (which !== "development" && which !== "production") {
  console.error("Use: pnpm env:check [development|production]");
  process.exit(2);
}
const fileOf = (env: string) => `.env.${env}.local`;
const read = (file: string): Record<string, string> | null => (fs.existsSync(file) ? (parseEnv(fs.readFileSync(file, "utf8")) as Record<string, string>) : null);

const file = fileOf(which);
const values = read(file);
if (!values) {
  console.log(`${file} does not exist.`);
  console.log(which === "production" ? "That is fine when production runs on a host that keeps its own settings (Vercel: Project, Settings, Environment Variables). Start from .env.production.example for the list." : "Copy .env.example to .env.development.local and fill in what you have.");
  process.exit(which === "production" ? 0 : 1);
}
if (fs.existsSync(".env")) console.log("Note: a plain .env file exists. It is read in BOTH environments; move what is in it to the file of the environment it belongs to.\n");

const GROUPS: [string, string[]][] = [
  ["Database", ["DATABASE_PATH", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]],
  ["Secrets", ["AUTH_SECRET", "MAILBOX_SECRET", "CRON_SECRET"]],
  ["Address", ["APP_URL"]],
  ["AI, search, research", ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "SERPER_API_KEY", "FIRECRAWL_API_KEY", "BRAVE_SEARCH_API_KEY"]],
  ["Sign-in", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "SIGNUP_MODE"]],
  ["The product's own emails", ["ACCOUNT_EMAILS", "ACCOUNT_SMTP_HOST", "ACCOUNT_SMTP_USER", "ACCOUNT_SMTP_PASSWORD", "ACCOUNT_MAIL_FROM"]],
  ["Mailbox from the file", ["MAIL_PROVIDER", "MAIL_USER", "MAIL_PASSWORD"]],
];
const filled = (k: string) => Boolean(values[k]?.trim());
console.log(`${which} · ${file}\n`);
for (const [title, keys] of GROUPS) console.log(`${title.padEnd(26)} ${keys.map((k) => `${filled(k) ? "+" : "-"} ${k}`).join("   ")}`);

const check = checkEnvironment({ ...values, APP_ENV: values.APP_ENV ?? which, NODE_ENV: which });
const other = read(fileOf(which === "production" ? "development" : "production"));
const shared = other ? ["AUTH_SECRET", "MAILBOX_SECRET", "CRON_SECRET", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "ACCOUNT_SMTP_PASSWORD"].filter((k) => filled(k) && values[k] === other[k]) : [];
const lines = [...check.blocking.map((t) => `STOP  ${t}`), ...check.warnings.map((t) => `LOOK  ${t}`), ...shared.map((k) => `LOOK  ${k} has the same value in development and production: give each environment its own.`)];
console.log(lines.length ? `\n${lines.join("\n")}` : "\nThe settings fit this environment.");
process.exit(check.blocking.length ? 1 : 0);
