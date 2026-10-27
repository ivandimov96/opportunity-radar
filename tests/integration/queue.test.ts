import { beforeEach, describe, expect, it } from "vitest";
import { useTempDb } from "../helpers";
import { claimNextJob, completeJob, enqueueJob, failJob, recoverStaleJobs } from "@/lib/jobs/queue";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("job queue", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    db = await useTempDb();
  });

  it("deduplicates by idempotency key while queued and allows re-run after completion", async () => {
    const a = await enqueueJob("research_business", { businessId: "b" }, { idempotencyKey: "research:b" });
    const b = await enqueueJob("research_business", { businessId: "b" }, { idempotencyKey: "research:b" });
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    const job = (await claimNextJob("w1", ["research_business"]))!;
    expect(job.id).toBe(a.id);
    expect(await claimNextJob("w2", ["research_business"])).toBeNull();
    await completeJob(job.id);
    const c = await enqueueJob("research_business", { businessId: "b" }, { idempotencyKey: "research:b" });
    expect(c.created).toBe(true);
  });

  it("retries retryable failures with backoff and fails after max attempts", async () => {
    await enqueueJob("research_business", { businessId: "b" }, { maxAttempts: 2 });
    const j1 = (await claimNextJob("w", ["research_business"]))!;
    expect(await failJob(j1, "timeout", true)).toBe("requeued");
    const row = (await db.select().from(jobs).where(eq(jobs.id, j1.id)).get())!;
    expect(row.status).toBe("queued");
    expect(new Date(row.scheduledAt).getTime()).toBeGreaterThan(Date.now());
    // Not claimable until scheduledAt passes
    expect(await claimNextJob("w", ["research_business"])).toBeNull();
    await db.update(jobs).set({ scheduledAt: new Date(Date.now() - 1000).toISOString() }).where(eq(jobs.id, j1.id)).run();
    const j2 = (await claimNextJob("w", ["research_business"]))!;
    expect(j2.attempts).toBe(2);
    expect(await failJob(j2, "timeout again", true)).toBe("failed");
  });

  it("does not retry non-retryable failures", async () => {
    await enqueueJob("analyze_business", { businessId: "b" });
    const j = (await claimNextJob("w", ["analyze_business"]))!;
    expect(await failJob(j, "bad input", false)).toBe("failed");
  });

  it("recovers stale running jobs", async () => {
    await enqueueJob("analyze_business", { businessId: "b" });
    const j = (await claimNextJob("w", ["analyze_business"]))!;
    await db.update(jobs).set({ startedAt: new Date(Date.now() - 60 * 60_000).toISOString() }).where(eq(jobs.id, j.id)).run();
    expect(await recoverStaleJobs()).toBe(1);
    expect((await claimNextJob("w", ["analyze_business"]))?.id).toBe(j.id);
  });
});
