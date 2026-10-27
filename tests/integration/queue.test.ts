import { beforeEach, describe, expect, it } from "vitest";
import { useTempDb } from "../helpers";
import { claimNextJob, completeJob, enqueueJob, failJob, recoverStaleJobs } from "@/lib/jobs/queue";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("job queue", () => {
  let db: ReturnType<typeof useTempDb>;
  beforeEach(() => {
    db = useTempDb();
  });

  it("deduplicates by idempotency key while queued and allows re-run after completion", () => {
    const a = enqueueJob("research_business", { businessId: "b" }, { idempotencyKey: "research:b" });
    const b = enqueueJob("research_business", { businessId: "b" }, { idempotencyKey: "research:b" });
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    const job = claimNextJob("w1", ["research_business"])!;
    expect(job.id).toBe(a.id);
    expect(claimNextJob("w2", ["research_business"])).toBeNull();
    completeJob(job.id);
    const c = enqueueJob("research_business", { businessId: "b" }, { idempotencyKey: "research:b" });
    expect(c.created).toBe(true);
  });

  it("retries retryable failures with backoff and fails after max attempts", () => {
    enqueueJob("research_business", { businessId: "b" }, { maxAttempts: 2 });
    const j1 = claimNextJob("w", ["research_business"])!;
    expect(failJob(j1, "timeout", true)).toBe("requeued");
    const row = db.select().from(jobs).where(eq(jobs.id, j1.id)).get()!;
    expect(row.status).toBe("queued");
    expect(new Date(row.scheduledAt).getTime()).toBeGreaterThan(Date.now());
    // Not claimable until scheduledAt passes
    expect(claimNextJob("w", ["research_business"])).toBeNull();
    db.update(jobs).set({ scheduledAt: new Date(Date.now() - 1000).toISOString() }).where(eq(jobs.id, j1.id)).run();
    const j2 = claimNextJob("w", ["research_business"])!;
    expect(j2.attempts).toBe(2);
    expect(failJob(j2, "timeout again", true)).toBe("failed");
  });

  it("does not retry non-retryable failures", () => {
    enqueueJob("analyze_business", { businessId: "b" });
    const j = claimNextJob("w", ["analyze_business"])!;
    expect(failJob(j, "bad input", false)).toBe("failed");
  });

  it("recovers stale running jobs", () => {
    enqueueJob("analyze_business", { businessId: "b" });
    const j = claimNextJob("w", ["analyze_business"])!;
    db.update(jobs).set({ startedAt: new Date(Date.now() - 60 * 60_000).toISOString() }).where(eq(jobs.id, j.id)).run();
    expect(recoverStaleJobs()).toBe(1);
    expect(claimNextJob("w", ["analyze_business"])?.id).toBe(j.id);
  });
});
