/**
 * In-process worker loop. Bounded concurrency, isolated failures, retries
 * with backoff for retryable errors, and a global singleton guard so dev-mode
 * module reloads never start a second loop.
 */
import { getConfig } from "@/lib/config";
import { ProviderError } from "@/lib/discovery/types";
import { claimNextJob, completeJob, failJob, recoverStaleJobs, updateJobProgress, type JobRow, type JobType } from "./queue";
import { handleDiscoverSearch, handleGenerateOutreach, handleInvestigateBusiness, NonRetryableError, type ProgressFn } from "./handlers";

const HANDLERS: Record<JobType, (job: JobRow, progress: ProgressFn) => Promise<void>> = {
  discover_search: handleDiscoverSearch,
  investigate_business: handleInvestigateBusiness,
  generate_outreach: handleGenerateOutreach,
};

type WorkerState = { running: boolean; active: number; timer?: NodeJS.Timeout; id: string; stop?: () => void };
const g = globalThis as unknown as { __radarWorker?: WorkerState };

function isRetryable(err: unknown) {
  if (err instanceof NonRetryableError) return false;
  if (err instanceof ProviderError) return err.retryable;
  const msg = err instanceof Error ? err.message : "";
  return /timeout|ECONN|ENOTFOUND|EAI_AGAIN|429|5\d\d|overloaded|rate limit|fetch failed/i.test(msg);
}

export async function runJob(job: JobRow) {
  const handler = HANDLERS[job.type as JobType];
  const progress: ProgressFn = (p) => {
    void updateJobProgress(job.id, p).catch(() => {});
  };
  if (!handler) {
    await failJob(job, `Unknown job type ${job.type}`, false);
    return;
  }
  try {
    await handler(job, progress);
    await completeJob(job.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const outcome = await failJob(job, msg, isRetryable(err));
    console.warn(`[worker] job ${job.type}/${job.id} ${outcome}: ${msg}`);
  }
}

/** Process queued jobs until none are claimable. Used by tests and the CLI. */
export async function drainQueue(types: JobType[] = Object.keys(HANDLERS) as JobType[], max = 100) {
  let n = 0;
  while (n < max) {
    const job = await claimNextJob("drain", types);
    if (!job) break;
    await runJob(job);
    n++;
  }
  return n;
}

export function startWorker(opts: { pollMs?: number } = {}) {
  if (g.__radarWorker?.running) return g.__radarWorker;
  const cfg = getConfig();
  const state: WorkerState = { running: true, active: 0, id: `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}` };
  g.__radarWorker = state;
  const maxConcurrent = cfg.RESEARCH_CONCURRENCY;
  void recoverStaleJobs().catch((err) => console.warn("[worker] stale recovery failed", err));
  let ticking = false;
  const tick = async () => {
    if (!state.running || ticking) return;
    ticking = true;
    try {
      while (state.active < maxConcurrent) {
        const job = await claimNextJob(state.id, Object.keys(HANDLERS) as JobType[]);
        if (!job) break;
        state.active++;
        void runJob(job).finally(() => {
          state.active--;
        });
      }
    } catch (err) {
      console.warn("[worker] tick failed", err);
    } finally {
      ticking = false;
    }
  };
  state.timer = setInterval(tick, opts.pollMs ?? 1500);
  state.timer.unref?.();
  state.stop = () => {
    state.running = false;
    if (state.timer) clearInterval(state.timer);
  };
  console.log(`[worker] started (${state.id}), concurrency ${maxConcurrent}`);
  void tick();
  return state;
}

export function stopWorker() {
  g.__radarWorker?.stop?.();
  g.__radarWorker = undefined;
}

export function workerStatus() {
  return g.__radarWorker ? { running: g.__radarWorker.running, active: g.__radarWorker.active, id: g.__radarWorker.id } : { running: false, active: 0, id: null };
}
