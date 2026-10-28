/**
 * In-process worker loop. Bounded concurrency, isolated failures, retries
 * with backoff for retryable errors, and a global singleton guard so dev-mode
 * module reloads never start a second loop.
 */
import { getConfig } from "@/lib/config";
import { ProviderError } from "@/lib/discovery/types";
import { claimNextJob, completeJob, failJob, recoverStaleJobs, updateJobProgress, type JobRow, type JobType } from "./queue";
import os from "node:os";
import { handleDiscoverSearch, handleGenerateOutreach, handleInvestigateBusiness, markJobTimedOut, NonRetryableError, type ProgressFn } from "./handlers";

const HANDLERS: Record<JobType, (job: JobRow, progress: ProgressFn, signal: AbortSignal) => Promise<void>> = {
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
    const limit = JOB_TIMEOUT_MS[job.type] ?? 10 * 60_000;
    // The timeout aborts the handler's network work through the signal; handlers check it before persisting.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = handler(job, progress, controller.signal);
    void run.catch(() => {}); // an abandoned run that later rejects must not become an unhandled rejection
    await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const err = new JobTimeoutError(`Job exceeded ${Math.round(limit / 60_000)} min and was abandoned`);
          controller.abort(err);
          reject(err);
        }, limit);
      }),
    ]).finally(() => clearTimeout(timer));
    await completeJob(job.id);
  } catch (err) {
    const msg = describeError(err);
    const outcome = await failJob(job, msg, isRetryable(err));
    if (err instanceof JobTimeoutError) await markJobTimedOut(job, msg).catch(() => {});
    console.warn(`[worker] job ${job.type}/${job.id} ${outcome}: ${msg}`);
  }
}

/** Upper bound per job type; a hung external call must not hold a worker slot forever. */
export const JOB_TIMEOUT_MS: Record<string, number> = { discover_search: 20 * 60_000, investigate_business: 10 * 60_000, generate_outreach: 5 * 60_000 };
export class JobTimeoutError extends Error {}

/** Message plus the cause chain (database driver errors hide the real reason in `cause`). */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    parts.push(cur instanceof Error ? cur.message : String(cur));
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return parts.filter((p, i) => p && parts.indexOf(p) === i).join(" ← ");
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
  const state: WorkerState = { running: true, active: 0, id: `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}@${os.hostname()}` };
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
