import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const seen: { signal?: AbortSignal } = {};
vi.mock("@/lib/jobs/handlers", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/jobs/handlers")>();
  return {
    ...orig,
    handleInvestigateBusiness: (_job: unknown, _progress: unknown, signal: AbortSignal) => {
      seen.signal = signal;
      return new Promise(() => {}); // hangs forever and ignores the signal, like a stuck external call
    },
  };
});

import { useTempDb, resetEnv } from "../helpers";
import { businesses, jobs } from "@/db/schema";
import { enqueueJob } from "@/lib/jobs/queue";
import { drainQueue, JOB_TIMEOUT_MS } from "@/lib/jobs/worker";

describe("job timeout", () => {
  beforeEach(async () => {
    resetEnv({});
    await useTempDb();
  });
  it("abandons a hung job after its limit, aborts its signal, records why, and fails the business it was for", async () => {
    JOB_TIMEOUT_MS.investigate_business = 60;
    const db = await (await import("@/db/client")).getDb();
    await db.insert(businesses).values({ id: "x", name: "Hung Shop", nameNormalized: "hung shop", industry: "auto_repair", firstProvider: "csv", status: "queued" }).run();
    const { id } = await enqueueJob("investigate_business", { businessId: "x" }, { maxAttempts: 1 });
    await drainQueue(["investigate_business"]);
    const row = (await db.select().from(jobs).where(eq(jobs.id, id)).get())!;
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/exceeded .* and was abandoned/);
    expect(seen.signal?.aborted).toBe(true);
    const biz = (await db.select().from(businesses).where(eq(businesses.id, "x")).get())!;
    expect(biz.status).toBe("failed");
    expect(biz.statusMessage).toMatch(/exceeded/);
  });
});
