/**
 * One turn of the background work where no worker lives (a serverless host): what the embedded worker does
 * every minute on a machine of its own, done once per call. Something outside calls it every few minutes
 * (/api/jobs/drain, from a scheduled GitHub workflow and the host's daily cron), and every request that
 * queues work drains the queue itself once it has answered (`kick.ts`).
 */
import { FIRST_WORKSPACE_ID } from "@/db/schema";
import { runInWorkspace } from "@/lib/workspace";
import { recoverStaleJobs } from "./queue";
import { runScheduler } from "./scheduler";
import { drainQueue, type DrainOptions } from "./worker";

/** A function lives 300 seconds: no new job is started after 200, so the last one has time to finish. */
export const SERVERLESS_DRAIN: DrainOptions = { budgetMs: 200_000, lanes: 3, shared: true };
/** No job outlives its function there, so one still "running" after this was cut off and goes back in the queue. */
const CUT_OFF_AFTER_MS = 6 * 60_000;

export async function runTick(): Promise<{ recovered: number; scheduled: boolean; processed: number }> {
  const recovered = await recoverStaleJobs(CUT_OFF_AFTER_MS).catch(() => 0);
  // The scheduler is the system's own: it looks across workspaces and queues each job as the workspace of its business.
  const scheduled = await runInWorkspace(FIRST_WORKSPACE_ID, () => runScheduler())
    .then(() => true)
    .catch((err) => {
      console.warn("[tick] scheduler failed", err);
      return false;
    });
  const processed = await drainQueue(undefined, 40, SERVERLESS_DRAIN);
  return { recovered, scheduled, processed };
}
