export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getConfig } = await import("@/lib/config");
  const cfg = getConfig();
  console.log(`[env] ${cfg.appEnv}${cfg.envWarnings.length ? `, ${cfg.envWarnings.length} thing(s) to look at (System page)` : ""}`);
  for (const w of cfg.envWarnings) console.warn(`[env] ${w}`);
  if (!cfg.EMBEDDED_WORKER || cfg.serverless) return;
  const { getDb } = await import("@/db/client");
  const { startWorker } = await import("@/lib/jobs/worker");
  await getDb();
  startWorker();
}
