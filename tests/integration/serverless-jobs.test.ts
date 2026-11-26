/**
 * Background work where no worker lives (a serverless host): the queue is worked through inside a fixed
 * time, "one email at a time" holds across separate processes, the address that starts a turn is closed
 * without its secret, and a deployment with a database of its own may send. No network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetEnv, useTempDb } from "../helpers";
import { jobs } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { enqueueJob, typesRunning } from "@/lib/jobs/queue";
import { JOB_TIMEOUT_MS, drainQueue } from "@/lib/jobs/worker";
import { GET as tick } from "@/app/api/jobs/drain/route";

const call = (secret?: string) => tick(new Request("http://radar.example/api/jobs/drain", { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

describe("background work without a worker", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    resetEnv();
    db = await useTempDb();
  });
  afterEach(() => resetEnv());

  const running = async (type: "send_email" | "sync_mailbox", startedMsAgo: number) => {
    const { id } = await enqueueJob(type, { draftId: "none" }, { idempotencyKey: `held-${type}` });
    await db.update(jobs).set({ status: "running", lockedBy: "drain", startedAt: new Date(Date.now() - startedMsAgo).toISOString() }).where(eq(jobs.id, id)).run();
  };

  it("takes no new job once its time is used up", async () => {
    await enqueueJob("send_email", { draftId: "none" });
    expect(await drainQueue(["send_email"], 10, { budgetMs: -1 })).toBe(0);
    expect((await db.select().from(jobs).all())[0].status).toBe("queued");
  });

  it("does not send while another process is sending, and stops waiting for one that was cut off", async () => {
    await running("send_email", 5_000);
    await enqueueJob("send_email", { draftId: "none" });
    expect(await typesRunning(["send_email", "sync_mailbox"], JOB_TIMEOUT_MS)).toEqual(["send_email"]);
    expect(await drainQueue(["send_email"], 10, { shared: true })).toBe(0);
    // Without the check across processes (a machine with one worker) the queue is simply worked through.
    await db.update(jobs).set({ startedAt: new Date(Date.now() - JOB_TIMEOUT_MS.send_email - 1_000).toISOString() }).where(eq(jobs.status, "running")).run();
    expect(await typesRunning(["send_email"], JOB_TIMEOUT_MS)).toEqual([]);
    expect(await drainQueue(["send_email"], 10, { shared: true, lanes: 3 })).toBe(1);
  });

  it("opens the address that starts a turn only to its secret, and in production not at all without one", async () => {
    resetEnv({ APP_ENV: "production" });
    expect((await call()).status).toBe(503);
    resetEnv({ APP_ENV: "production", CRON_SECRET: "a-secret-for-the-jobs-address" });
    expect((await call()).status).toBe(401);
    expect((await call("something-else")).status).toBe(401);
    const ok = await call("a-secret-for-the-jobs-address");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ scheduled: true, processed: 0 });
  });

  it("sends from a serverless deployment only when it has a database of its own", () => {
    resetEnv({ VERCEL: "1", APP_ENV: "production", MAIL_PROVIDER: "gmail", MAIL_USER: "sender@radar.example", MAIL_PASSWORD: "app-password" });
    expect(getConfig().ephemeral).toBe(true);
    expect(getConfig().mail).toMatchObject({ enabled: false, reason: expect.stringContaining("without a database of its own") });
    resetEnv({ VERCEL: "1", APP_ENV: "production", TURSO_DATABASE_URL: "libsql://radar.example", MAIL_PROVIDER: "gmail", MAIL_USER: "sender@radar.example", MAIL_PASSWORD: "app-password" });
    expect(getConfig().ephemeral).toBe(false);
    expect(getConfig().mail.enabled).toBe(true);
  });
});
