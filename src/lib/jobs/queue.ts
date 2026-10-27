/**
 * SQLite-backed job queue. Single-writer semantics via better-sqlite3's
 * synchronous transactions make claiming race-free within a process; a
 * lockedBy column plus stale-lock recovery handles multiple worker processes.
 */
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";

export type JobType = "discover_search" | "research_business" | "analyze_business" | "generate_outreach";
export type JobRow = typeof jobs.$inferSelect;

export function enqueueJob(type: JobType, payload: Record<string, unknown>, opts: { idempotencyKey?: string; maxAttempts?: number; delayMs?: number } = {}): { id: string; created: boolean } {
  const db = getDb();
  if (opts.idempotencyKey) {
    const existing = db.select({ id: jobs.id, status: jobs.status }).from(jobs).where(eq(jobs.idempotencyKey, opts.idempotencyKey)).get();
    if (existing && (existing.status === "queued" || existing.status === "running")) return { id: existing.id, created: false };
    if (existing) db.delete(jobs).where(eq(jobs.id, existing.id)).run(); // allow re-run after completion/failure
  }
  const id = newId();
  const scheduledAt = new Date(Date.now() + (opts.delayMs ?? 0)).toISOString();
  db.insert(jobs).values({ id, type, payload, idempotencyKey: opts.idempotencyKey ?? null, maxAttempts: opts.maxAttempts ?? 3, scheduledAt }).run();
  return { id, created: true };
}

export function claimNextJob(workerId: string, types: JobType[]): JobRow | null {
  const db = getDb();
  return db.transaction((tx) => {
    const now = nowIso();
    const row = tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), inArray(jobs.type, types), lte(jobs.scheduledAt, now)))
      .orderBy(asc(jobs.scheduledAt), asc(jobs.createdAt))
      .limit(1)
      .get();
    if (!row) return null;
    tx.update(jobs)
      .set({ status: "running", lockedBy: workerId, startedAt: now, attempts: row.attempts + 1 })
      .where(and(eq(jobs.id, row.id), eq(jobs.status, "queued")))
      .run();
    return { ...row, status: "running", lockedBy: workerId, startedAt: now, attempts: row.attempts + 1 };
  });
}

export function updateJobProgress(id: string, progress: { message?: string; done?: number; total?: number }) {
  getDb().update(jobs).set({ progress }).where(eq(jobs.id, id)).run();
}

export function completeJob(id: string) {
  getDb().update(jobs).set({ status: "done", finishedAt: nowIso(), lockedBy: null, error: null }).where(eq(jobs.id, id)).run();
}

export function failJob(job: JobRow, error: string, retryable: boolean) {
  const db = getDb();
  if (retryable && job.attempts < job.maxAttempts) {
    const backoffMs = Math.min(5 * 60_000, 10_000 * 2 ** (job.attempts - 1));
    db.update(jobs)
      .set({ status: "queued", lockedBy: null, error, scheduledAt: new Date(Date.now() + backoffMs).toISOString() })
      .where(eq(jobs.id, job.id))
      .run();
    return "requeued" as const;
  }
  db.update(jobs).set({ status: "failed", finishedAt: nowIso(), lockedBy: null, error }).where(eq(jobs.id, job.id)).run();
  return "failed" as const;
}

/** Jobs left "running" by a crashed worker are requeued after a grace period. */
export function recoverStaleJobs(staleMs = 15 * 60_000) {
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  return getDb()
    .update(jobs)
    .set({ status: "queued", lockedBy: null, error: "Recovered from stale lock" })
    .where(and(eq(jobs.status, "running"), lt(jobs.startedAt, cutoff)))
    .run().changes;
}

export function jobCounts() {
  const rows = getDb().select({ status: jobs.status, type: jobs.type, n: sql<number>`count(*)` }).from(jobs).groupBy(jobs.status, jobs.type).all();
  return rows;
}

export function getJob(id: string) {
  return getDb().select().from(jobs).where(eq(jobs.id, id)).get() ?? null;
}

export function cancelQueuedJob(id: string) {
  return getDb().update(jobs).set({ status: "cancelled", finishedAt: nowIso() }).where(and(eq(jobs.id, id), eq(jobs.status, "queued"))).run().changes > 0;
}
