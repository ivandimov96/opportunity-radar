/**
 * In-process worker loop. Bounded concurrency, isolated failures, retries
 * with backoff for retryable errors, and a global singleton guard so dev-mode
 * module reloads never start a second loop.
 */
import { getConfig } from "@/lib/config";
import { ProviderError } from "@/lib/discovery/types";
import { claimNextJob, completeJob, failJob, recoverStaleJobs, typesRunning, updateJobProgress, type JobRow, type JobType } from "./queue";
import os from "node:os";
import { handleDiscoverSearch, handleGenerateOutreach, handleInvestigateBusiness, markJobTimedOut, NonRetryableError, RetryableError, type ProgressFn } from "./handlers";
import { handleProcessReply, handleSendEmail, handleSyncMailbox } from "./mail-handlers";
import { runScheduler } from "./scheduler";
import { FIRST_WORKSPACE_ID } from "@/db/schema";
import { runInWorkspace } from "@/lib/workspace";

const HANDLERS: Record<JobType, (job: JobRow, progress: ProgressFn, signal: AbortSignal) => Promise<void>> = {
  discover_search: handleDiscoverSearch,
  investigate_business: handleInvestigateBusiness,
  generate_outreach: handleGenerateOutreach,
  send_email: handleSendEmail,
  sync_mailbox: handleSyncMailbox,
  process_reply: handleProcessReply,
};

/** Jobs that must not run side by side: one email leaves at a time, one inbox read at a time. */
const TYPE_LIMITS: Partial<Record<JobType, number>> = { send_email: 1, sync_mailbox: 1 };
const SCHEDULER_EVERY_MS = 60_000;

type WorkerState = { running: boolean; active: number; byType: Record<string, number>; lastSchedule: number; timer?: NodeJS.Timeout; id: string; stop?: () => void };
const g = globalThis as unknown as { __radarWorker?: WorkerState };

function isRetryable(err: unknown) {
  if (err instanceof NonRetryableError) return false;
  if (err instanceof RetryableError) return true;
  if (err instanceof ProviderError) return err.retryable;
  const msg = err instanceof Error ? err.message : "";
  return /timeout|ECONN|ENOTFOUND|EAI_AGAIN|429|5\d\d|overloaded|rate limit|fetch failed/i.test(msg);
}

/** Runs one claimed job as the workspace it was queued in (the embedded worker, the serverless drain and the scripts all come through here). */
export function runJob(job: JobRow) {
  return runInWorkspace(job.workspaceId, () => runJobHere(job));
}

async function runJobHere(job: JobRow) {
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
export const JOB_TIMEOUT_MS: Record<string, number> = { discover_search: 20 * 60_000, investigate_business: 10 * 60_000, generate_outreach: 6 * 60_000, send_email: 2 * 60_000, sync_mailbox: 5 * 60_000, process_reply: 3 * 60_000 };
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

export interface DrainOptions {
  /** Stop taking new jobs after this long: a serverless function has a fixed time to live. */
  budgetMs?: number;
  /** Jobs run side by side (a hosted database only: the local file has one connection and tests run one at a time). */
  lanes?: number;
  /** Other processes may be draining the same queue: keep "one send, one inbox read at a time" across all of them. */
  shared?: boolean;
}

/**
 * Process queued jobs until none are claimable. Used by tests, the scripts and, where no worker lives
 * (serverless), by the request that queued the work and by the regular tick (`tick.ts`).
 */
export async function drainQueue(types: JobType[] = Object.keys(HANDLERS) as JobType[], max = 100, opts: DrainOptions = {}) {
  const until = opts.budgetMs ? Date.now() + opts.budgetMs : Number.POSITIVE_INFINITY;
  const limited = types.filter((t) => TYPE_LIMITS[t] !== undefined);
  let n = 0;
  const lane = async (mine: JobType[]) => {
    while (n < max && Date.now() < until) {
      const busy = opts.shared ? await typesRunning(mine.filter((t) => limited.includes(t)), JOB_TIMEOUT_MS) : [];
      const free = mine.filter((t) => !busy.includes(t));
      const job = free.length ? await claimNextJob("drain", free) : null;
      if (!job) break;
      n++;
      await runJob(job);
    }
  };
  // Only the first lane takes the jobs that must not run side by side.
  await Promise.all([lane(types), ...Array.from({ length: Math.max(1, opts.lanes ?? 1) - 1 }, () => lane(types.filter((t) => !limited.includes(t))))]);
  return n;
}

export function startWorker(opts: { pollMs?: number } = {}) {
  if (g.__radarWorker?.running) return g.__radarWorker;
  const cfg = getConfig();
  const state: WorkerState = { running: true, active: 0, byType: {}, lastSchedule: 0, id: `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}@${os.hostname()}` };
  g.__radarWorker = state;
  const maxConcurrent = cfg.RESEARCH_CONCURRENCY;
  void recoverStaleJobs().catch((err) => console.warn("[worker] stale recovery failed", err));
  let ticking = false;
  const tick = async () => {
    if (!state.running || ticking) return;
    ticking = true;
    try {
      if (Date.now() - state.lastSchedule >= SCHEDULER_EVERY_MS) {
        state.lastSchedule = Date.now();
        // The scheduler is the system's own: it looks across workspaces and queues each job as the workspace of its business.
        await runInWorkspace(FIRST_WORKSPACE_ID, () => runScheduler()).catch((err) => console.warn("[worker] scheduler failed", err));
      }
      while (state.active < maxConcurrent) {
        const types = (Object.keys(HANDLERS) as JobType[]).filter((t) => (state.byType[t] ?? 0) < (TYPE_LIMITS[t] ?? Number.POSITIVE_INFINITY));
        const job = await claimNextJob(state.id, types);
        if (!job) break;
        state.active++;
        state.byType[job.type] = (state.byType[job.type] ?? 0) + 1;
        void runJob(job).finally(() => {
          state.active--;
          state.byType[job.type] = Math.max(0, (state.byType[job.type] ?? 1) - 1);
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
