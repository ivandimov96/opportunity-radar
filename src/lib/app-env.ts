/**
 * Which environment this process is: development (the computer it is built on), production (the live
 * product with real customers) or test. The two never share a database, keys or a mailbox: each has its own
 * settings file (`.env.development.local`, `.env.production.local`, or the host's own settings), and this
 * file is where the code checks that they were not mixed up.
 * Pure: reads only the values it is given, safe to import anywhere.
 */

export type AppEnv = "development" | "production" | "test";
type Env = Record<string, string | undefined>;

const NAMES: AppEnv[] = ["development", "production", "test"];
const set = (v: string | undefined) => Boolean(v?.trim());

/**
 * The environment. APP_ENV says it outright; otherwise it follows from where the process runs: a test run,
 * the host's own name for the deployment (a Vercel preview is development), or how the app was started
 * (`next dev` is development, a built app is production).
 */
export function appEnv(env: Env = process.env): AppEnv {
  const said = env.APP_ENV?.trim().toLowerCase();
  if (said) {
    if (!NAMES.includes(said as AppEnv)) throw new Error(`APP_ENV is "${env.APP_ENV}": use development, production or test.`);
    return said as AppEnv;
  }
  if (env.VITEST || env.NODE_ENV === "test") return "test";
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production" ? "production" : "development";
  return env.NODE_ENV === "production" ? "production" : "development";
}

export const APP_ENV_LABEL: Record<AppEnv, string> = { development: "Development", production: "Production", test: "Test" };

export interface EnvironmentCheck {
  env: AppEnv;
  /** Mix-ups that must stop the app before it touches anything. */
  blocking: string[];
  /** What is not yet as it should be for this environment; the app runs, the System page lists them. */
  warnings: string[];
}

/** What is wrong with the settings for the environment they are used in. */
export function checkEnvironment(env: Env = process.env): EnvironmentCheck {
  const which = appEnv(env);
  const blocking: string[] = [];
  const warnings: string[] = [];
  const serverless = set(env.VERCEL);
  const hosted = set(env.TURSO_DATABASE_URL);

  if (which !== "production") {
    // The hosted database is where customers' data lives: only production opens it, unless a second hosted
    // database was made for development and that is said outright.
    if (hosted && env.DEV_REMOTE_DATABASE?.trim().toLowerCase() !== "allow")
      blocking.push(`TURSO_DATABASE_URL is set in ${which}. A hosted database belongs to production: remove it here (${which} uses the local file in DATABASE_PATH), or, when it is a separate database made for development, add DEV_REMOTE_DATABASE=allow.`);
    if (which === "development" && (env.ACCOUNT_EMAILS?.trim().toLowerCase() === "on" || set(env.ACCOUNT_SMTP_HOST))) warnings.push("The product's own emails are switched on: signing up or asking for a new password here sends a real email.");
    return { env: which, blocking, warnings };
  }

  if (env.MAIL_PROVIDER?.trim().toLowerCase() === "fake") blocking.push("MAIL_PROVIDER=fake in production: emails would look sent and reach nobody. The in-memory mailbox is for tests only.");
  if ((env.AUTH_SECRET ?? "").length < 16) warnings.push("AUTH_SECRET is missing or shorter than 16 characters: nobody can sign in.");
  if (!set(env.MAILBOX_SECRET)) warnings.push("MAILBOX_SECRET is not set: mailbox passwords are encrypted with AUTH_SECRET, so changing AUTH_SECRET later would make every connected mailbox unreadable.");
  const url = env.APP_URL?.trim() ?? "";
  if (!url) warnings.push("APP_URL is not set: links in emails and the sign-in redirects rely on the address each request arrived at.");
  else if (!/^https:\/\//i.test(url)) warnings.push("APP_URL does not start with https://.");
  else if (/localhost|127\.0\.0\.1/i.test(url)) warnings.push("APP_URL points at this computer.");
  if (serverless && !hosted) warnings.push("No hosted database (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN): on a serverless host nothing is kept between requests.");
  if (!serverless && !hosted && /(^|\/)(dev|e2e)\.db$/.test(env.DATABASE_PATH ?? "")) warnings.push(`DATABASE_PATH is ${env.DATABASE_PATH}: that is the development database.`);
  if (serverless && !set(env.CRON_SECRET)) warnings.push("CRON_SECRET is not set: anyone who knows the address can start the queued jobs (/api/jobs/drain).");
  if (!set(env.ACCOUNT_SMTP_HOST) && env.ACCOUNT_EMAILS?.trim().toLowerCase() !== "on") warnings.push("The product sends no emails of its own (ACCOUNT_SMTP_* or ACCOUNT_EMAILS=on): new accounts are not confirmed and a forgotten password cannot be reset.");
  return { env: which, blocking, warnings };
}
