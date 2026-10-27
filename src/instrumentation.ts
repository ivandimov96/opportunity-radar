export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getConfig } = await import("@/lib/config");
  const cfg = getConfig();
  if (!cfg.EMBEDDED_WORKER || cfg.serverless) return;
  const { getDb } = await import("@/db/client");
  const { startWorker } = await import("@/lib/jobs/worker");
  getDb();
  startWorker();
}
