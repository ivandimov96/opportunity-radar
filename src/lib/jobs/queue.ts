/**
 * libSQL-backed job queue. Claiming is one atomic UPDATE so two workers
 * never take the same job; a lockedBy column plus stale-lock recovery handles
 * crashed processes.
 */
import os from "node:os";
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { getConfig } from "@/lib/config";
import { jobs } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";

export type JobType = "discover_search" | "investigate_business" | "generate_outreach";
export type JobRow = typeof jobs.$inferSelect;

export async function enqueueJob(type: JobType, payload: Record<string, unknown>, opts: { idempotencyKey?: string; maxAttempts?: number; delayMs?: number } = {}): Promise<{ id: string; created: boolean }> {
  const db = await getDb();
  if (opts.idempotencyKey) {
    const existing = await db.select({ id: jobs.id, status: jobs.status }).from(jobs).where(eq(jobs.idempotencyKey, opts.idempotencyKey)).get();
    if (existing && (existing.status === "queued" || existing.status === "running")) return { id: existing.id, created: false };
    if (existing) await db.delete(jobs).where(eq(jobs.id, existing.id)).run(); // allow re-run after completion/failure
  }
  const id = newId();
  const scheduledAt = new Date(Date.now() + (opts.delayMs ?? 0)).toISOString();
  await db.insert(jobs).values({ id, type, payload, idempotencyKey: opts.idempotencyKey ?? null, maxAttempts: opts.maxAttempts ?? 3, scheduledAt }).run();
  return { id, created: true };
}

/** Claims the next runnable job in ONE atomic statement (no transaction; see src/db/client.ts). */
export async function claimNextJob(workerId: string, types: JobType[]): Promise<JobRow | null> {
  const db = await getDb();
  const now = nowIso();
  const next = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), inArray(jobs.type, types), lte(jobs.scheduledAt, now)))
    .orderBy(asc(jobs.scheduledAt), asc(jobs.createdAt))
    .limit(1);
  const row = await db
    .update(jobs)
    .set({ status: "running", lockedBy: workerId, startedAt: now, attempts: sql`${jobs.attempts} + 1` })
    .where(and(inArray(jobs.id, next), eq(jobs.status, "queued")))
    .returning()
    .get();
  return row ?? null;
}

export async function updateJobProgress(id: string, progress: { message?: string; done?: number; total?: number }) {
  const db = await getDb();
  await db.update(jobs).set({ progress }).where(eq(jobs.id, id)).run();
}

export async function completeJob(id: string) {
  const db = await getDb();
  await db.update(jobs).set({ status: "done", finishedAt: nowIso(), lockedBy: null, error: null }).where(eq(jobs.id, id)).run();
}

export async function failJob(job: JobRow, error: string, retryable: boolean): Promise<"requeued" | "failed"> {
  const db = await getDb();
  if (retryable && job.attempts < job.maxAttempts) {
    const backoffMs = Math.min(5 * 60_000, 10_000 * 2 ** (job.attempts - 1));
    await db
      .update(jobs)
      .set({ status: "queued", lockedBy: null, error, scheduledAt: new Date(Date.now() + backoffMs).toISOString() })
      .where(eq(jobs.id, job.id))
      .run();
    return "requeued";
  }
  await db.update(jobs).set({ status: "failed", finishedAt: nowIso(), lockedBy: null, error }).where(eq(jobs.id, job.id)).run();
  return "failed";
}

/**
 * Jobs left "running" by a crashed worker are requeued: immediately when the lock
 * belongs to a worker process that no longer exists on this machine (restarts),
 * otherwise after a grace period.
 */
export async function recoverStaleJobs(staleMs = 15 * 60_000): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  let recovered = (await db.update(jobs).set({ status: "queued", lockedBy: null, error: "Recovered from stale lock" }).where(and(eq(jobs.status, "running"), lt(jobs.startedAt, cutoff))).run()).rowsAffected;
  if (!getConfig().serverless) {
    const running = await db.select({ id: jobs.id, lockedBy: jobs.lockedBy }).from(jobs).where(eq(jobs.status, "running")).all();
    for (const j of running) {
      const m = /^worker-(\d+)-[a-z0-9]+@(.+)$/.exec(j.lockedBy ?? "");
      if (!m || m[2] !== os.hostname()) continue; // another machine's worker (shared database): only the time cutoff applies
      const pid = Number(m[1]);
      if (!pid || pid === process.pid || processAlive(pid)) continue;
      await db.update(jobs).set({ status: "queued", lockedBy: null, error: `Recovered: worker process ${pid} is gone` }).where(and(eq(jobs.id, j.id), eq(jobs.status, "running"))).run();
      recovered++;
    }
  }
  return recovered;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function jobCounts() {
  const db = await getDb();
  return db.select({ status: jobs.status, type: jobs.type, n: sql<number>`count(*)` }).from(jobs).groupBy(jobs.status, jobs.type).all();
}

export async function getJob(id: string) {
  const db = await getDb();
  return (await db.select().from(jobs).where(eq(jobs.id, id)).get()) ?? null;
}

export async function cancelQueuedJob(id: string) {
  const db = await getDb();
  const res = await db.update(jobs).set({ status: "cancelled", finishedAt: nowIso() }).where(and(eq(jobs.id, id), eq(jobs.status, "queued"))).run();
  return res.rowsAffected > 0;
}
