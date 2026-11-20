/**
 * Usage per workspace and plan limits. HOME is the product's own workspace
 * (plan "owner", no limits); AWAY is a customer on the trial (3 searches and
 * 10 researched businesses a month). What is checked: each workspace's use is
 * counted for itself, a full plan refuses in plain words before anything is
 * queued or spent, and the owner sees every account and can change its plan.
 * No network: nothing here runs a search or research for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/jobs/kick", () => ({ kickWorker: () => {} }));

import { resetEnv, useTempDb } from "../helpers";
import { FIRST_WORKSPACE_ID, aiUsage, businesses, jobs, searches, workspaceUsage, workspaces } from "@/db/schema";
import { recordUsage as recordSearchCredits } from "@/lib/discovery/usage";
import { newId, nowIso } from "@/lib/ids";
import { enqueueInvestigation, tryInvestigation } from "@/lib/jobs/handlers";
import { drainQueue } from "@/lib/jobs/worker";
import { enqueueJob } from "@/lib/jobs/queue";
import { PLANS, UsageLimitError, assertRoom, count, countOrRefuse, resetsOn, room, setWorkspacePlan, usageByWorkspace, usageOf, usagePeriod } from "@/lib/usage";
import { runInWorkspace } from "@/lib/workspace";

const HOME = FIRST_WORKSPACE_ID;
const AWAY = "ws-meadow";

describe("usage per workspace and plan limits", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  const business = async (ws: string, name: string) => {
    const id = newId();
    await db.insert(businesses).values({ id, workspaceId: ws, name, nameNormalized: name.toLowerCase(), industry: "generic", firstProvider: "csv", country: "GB", status: "new", website: `https://${name.toLowerCase().replace(/\W+/g, "-")}.example` }).run();
    return id;
  };

  beforeEach(async () => {
    resetEnv({});
    db = await useTempDb();
    await db.insert(workspaces).values([{ id: HOME, name: "Harbour", plan: "owner", createdAt: nowIso() }, { id: AWAY, name: "Meadow", plan: "trial", createdAt: nowIso() }]).onConflictDoUpdate({ target: workspaces.id, set: { plan: "owner" } }).run();
    await db.update(workspaces).set({ plan: "trial" }).where(eq(workspaces.id, AWAY)).run();
  });

  it("counts each workspace's use for itself, month by month", async () => {
    await runInWorkspace(AWAY, async () => {
      await count("research");
      await count("research", 2);
      await count("emails");
      await recordSearchCredits("serper", 6);
    });
    await runInWorkspace(HOME, () => count("research"));
    await db.insert(aiUsage).values([{ id: newId(), workspaceId: AWAY, stage: "investigate", model: "m", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.4 }, { id: newId(), workspaceId: HOME, stage: "investigate", model: "m", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 1.5 }]).run();

    const away = await usageOf(AWAY);
    expect(away).toMatchObject({ research: { used: 3, limit: 10 }, searches: { used: 0, limit: 3 }, emails: 1, cost: { aiUsd: 0.4, searchCredits: 6 } });
    expect(away.plan.key).toBe("trial");
    expect(await usageOf(HOME)).toMatchObject({ research: { used: 1, limit: null }, searches: { limit: null }, emails: 0, cost: { aiUsd: 1.5, searchCredits: 0 } });
    // Last month's use does not count against this month.
    await db.insert(workspaceUsage).values({ workspaceId: AWAY, period: "2020-01", metric: "research", used: 99 }).run();
    expect((await usageOf(AWAY)).research.used).toBe(3);
    expect((await db.select().from(workspaceUsage).where(eq(workspaceUsage.period, usagePeriod())).all()).length).toBe(4);
  });

  it("refuses, in plain words, what goes over the plan, and never limits the product's own workspace", async () => {
    await runInWorkspace(AWAY, async () => {
      await count("searches", 2);
      expect(await room("searches")).toMatchObject({ used: 2, limit: 3, left: 1, reason: null });
      await assertRoom("searches");
      await expect(assertRoom("searches", 2)).rejects.toThrow("has room for 1 more search this month, not 2");
      await countOrRefuse("searches");
      const full = await room("searches");
      expect(full.left).toBe(0);
      expect(full.reason).toBe(`Your Trial plan includes 3 searches a month and all of them are used. The count starts again on ${resetsOn()}.`);
      await expect(countOrRefuse("searches")).rejects.toBeInstanceOf(UsageLimitError);
      expect((await usageOf()).searches.used).toBe(3); // a refusal counts nothing
    });
    await runInWorkspace(HOME, async () => {
      await count("searches", 500);
      expect(await room("searches")).toMatchObject({ limit: null, left: Infinity, reason: null });
      await countOrRefuse("searches");
    });
  });

  it("does not queue research beyond the plan, counting what is already waiting", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(await business(AWAY, `Shop ${i}`));
    await runInWorkspace(AWAY, async () => {
      await count("research", 7);
      // Three fit; they are queued (not yet counted) and take up the room.
      for (const id of ids.slice(0, 3)) expect(await tryInvestigation(id)).toBeNull();
      expect((await room("research")).left).toBe(0);
      const refused = await tryInvestigation(ids[3]);
      expect(refused).toContain("Your Trial plan includes 10 researched businesses a month");
      await expect(enqueueInvestigation(ids[4])).rejects.toBeInstanceOf(UsageLimitError);
    });
    expect((await db.select().from(jobs).all()).length).toBe(3);
    // The refused businesses were left exactly as they were.
    expect((await db.select().from(businesses).where(eq(businesses.id, ids[3])).get())!.status).toBe("new");
    // The product's own workspace queues as many as it likes.
    const mine = await business(HOME, "Fernhill");
    expect(await runInWorkspace(HOME, () => tryInvestigation(mine))).toBeNull();
  });

  it("stops a search that was queued before the month filled up, and says why on the search", async () => {
    const id = newId();
    await db.insert(searches).values({ id, workspaceId: AWAY, name: "Sign makers, Leeds", industry: "generic", country: "GB", city: "Leeds", maxResults: 20, providers: ["google_maps"], status: "queued" }).run();
    await runInWorkspace(AWAY, async () => {
      await enqueueJob("discover_search", { searchId: id });
      await count("searches", 3); // the plan was used up meanwhile
    });
    await drainQueue(["discover_search"]);
    const s = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
    expect(s.status).toBe("failed");
    expect(s.error).toContain("Your Trial plan includes 3 searches a month");
    expect((await usageOf(AWAY)).searches.used).toBe(3);
  });

  it("shows the owner every account and lets a plan be changed, with effect at once", async () => {
    await runInWorkspace(AWAY, () => count("research", 10));
    expect((await runInWorkspace(AWAY, () => room("research"))).left).toBe(0);
    const table = await usageByWorkspace();
    expect(table.map((a) => [a.id, a.plan.key, a.research.used])).toEqual([[HOME, "owner", 0], [AWAY, "trial", 10]]);

    expect(await setWorkspacePlan(AWAY, "starter")).toBe(true);
    expect(await runInWorkspace(AWAY, () => room("research"))).toMatchObject({ limit: PLANS.starter.limits.research, left: PLANS.starter.limits.research! - 10 });
    // "owner" is the product's own workspace and only that one; an unknown plan or account changes nothing.
    expect(await setWorkspacePlan(AWAY, "owner")).toBe(false);
    expect(await setWorkspacePlan(HOME, "trial")).toBe(false);
    expect(await setWorkspacePlan(AWAY, "platinum")).toBe(false);
    expect(await setWorkspacePlan("ws-nobody", "starter")).toBe(false);
    expect((await usageOf(AWAY)).plan.key).toBe("starter");
  });
});
