/**
 * Two workspaces on one database: what one finds, saves, removes or queues is
 * never seen, matched or changed from the other. Everything runs through the
 * real queries, the search engine and the job queue; the map source is a fake.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetEnv, useTempDb } from "../helpers";
import { FIRST_WORKSPACE_ID, businesses, businessSources, jobs, removedBusinesses, searches } from "@/db/schema";
import { runDiscovery } from "@/lib/discovery/engine";
import type { BusinessCandidate, DiscoveryProvider } from "@/lib/discovery/types";
import { newId } from "@/lib/ids";
import { enqueueInvestigation } from "@/lib/jobs/handlers";
import { enqueueJob } from "@/lib/jobs/queue";
import { drainQueue } from "@/lib/jobs/worker";
import { dashboardData, funnelForPeriod } from "@/lib/outreach/queries";
import { setStage } from "@/lib/pipeline/prospects";
import { listRemoved, removeBusiness } from "@/lib/pipeline/removed";
import { boardTotals, exportBusinessesCsv, exportSearchCsv, getBusinessDetail, getSearchCandidates, getSearchOverview, listBusinesses, listSearches, navStatus, pipelineBoard, pipelineHistory, quickViewCounts } from "@/lib/queries";
import { assertBusinessInWorkspace, runInWorkspace, workspaceId } from "@/lib/workspace";

const A = "ws-harbour";
const B = "ws-meadow";

// The same two listings every time: whoever searches finds the same companies under the same place ids.
const place = (over: Partial<BusinessCandidate>): BusinessCandidate => ({ provider: "google_maps", providerId: newId(), name: "X", attribution: "Fake map source", city: "Leeds", country: "GB", ...over });
const LISTINGS = () => [place({ providerId: "place-fern", name: "Fernhill Joinery", website: "https://fernhill-joinery.example", phone: "0113 496 0101" }), place({ providerId: "place-oak", name: "Oakbeck Plumbing", website: "https://oakbeck-plumbing.example", phone: "0113 496 0102" })];
const mapSource = (): { providers: { google_maps: DiscoveryProvider } } => ({ providers: { google_maps: { key: "google_maps", label: "Fake map source", status: "active", description: "", attribution: "Fake map source", isAvailable: () => ({ available: true }), discover: async () => ({ provider: "google_maps", candidates: LISTINGS(), attribution: "Fake map source", notes: [] }) } } });

describe("workspace isolation", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    resetEnv({});
    db = await useTempDb();
  });

  /** A search stored the way the form stores it, in whatever workspace is acting. */
  const mkSearch = async (name: string) => {
    const id = newId();
    await db.insert(searches).values({ id, workspaceId: await workspaceId(), name, industry: "generic", country: "GB", city: "Leeds", maxResults: 20, requireWebsite: false, autoInvestigate: false, providers: ["google_maps"], status: "done" }).run();
    return (await db.select().from(searches).where(eq(searches.id, id)).get())!;
  };
  const searchIn = (ws: string, name: string) => runInWorkspace(ws, async () => {
    const search = await mkSearch(name);
    return { search, run: await runDiscovery(db, search, mapSource()) };
  });
  const namesIn = (ws: string) => runInWorkspace(ws, async () => (await listBusinesses()).rows.map((r) => r.business.name).sort());

  it("keeps the searches and businesses of one workspace out of every list, count and page of the other", async () => {
    const a = await searchIn(A, "Trades in Leeds");
    expect(a.run.stats.created).toBe(2);
    const fern = (await db.select().from(businesses).all()).find((x) => x.name === "Fernhill Joinery")!;
    expect(fern.workspaceId).toBe(A);
    await runInWorkspace(A, () => setStage(fern.id, "qualified", "looks right"));

    // Seen from A: all of it.
    await runInWorkspace(A, async () => {
      expect((await listSearches()).rows.map((s) => s.name)).toEqual(["Trades in Leeds"]);
      expect((await listBusinesses()).total).toBe(2);
      expect((await quickViewCounts())[""]).toBe(2);
      expect((await getBusinessDetail(fern.id))?.business.name).toBe("Fernhill Joinery");
      expect((await getSearchOverview(a.search.id))?.businessStats.saved).toBe(2);
      expect((await getSearchCandidates(a.search.id)).total).toBe(2);
      expect((await pipelineBoard()).qualified.map((r) => r.business.name)).toEqual(["Fernhill Joinery"]);
      expect((await boardTotals()).onBoard).toBe(1);
      expect((await pipelineHistory({})).total).toBe(1);
      expect((await dashboardData()).total).toBe(2);
      expect((await funnelForPeriod({ fromIso: null, toIso: null })).found).toBe(2);
      expect(await exportBusinessesCsv()).toContain("Fernhill Joinery");
      expect((await exportSearchCsv(a.search.id))?.csv).toContain("Oakbeck Plumbing");
      await expect(assertBusinessInWorkspace(fern.id)).resolves.toBeUndefined();
    });

    // Seen from B (and from the first workspace): none of it, and A's ids are "not found".
    for (const other of [B, FIRST_WORKSPACE_ID]) {
      await runInWorkspace(other, async () => {
        expect((await listSearches()).total).toBe(0);
        expect((await listBusinesses()).total).toBe(0);
        expect((await quickViewCounts())[""]).toBe(0);
        expect(await getBusinessDetail(fern.id)).toBeNull();
        expect(await getSearchOverview(a.search.id)).toBeNull();
        expect((await getSearchCandidates(a.search.id)).total).toBe(0);
        expect((await getSearchCandidates(a.search.id)).counts.total).toBe(0);
        expect((await pipelineBoard()).qualified).toEqual([]);
        expect((await boardTotals()).onBoard).toBe(0);
        expect((await pipelineHistory({})).total).toBe(0);
        expect((await navStatus()).counts.businesses).toBe(0);
        expect((await dashboardData()).total).toBe(0);
        expect((await funnelForPeriod({ fromIso: null, toIso: null })).found).toBe(0);
        expect(await exportBusinessesCsv()).not.toContain("Fernhill");
        expect(await exportSearchCsv(a.search.id)).toBeNull();
        // Anything that takes a business id and then writes refuses an id from elsewhere, and changes nothing.
        await expect(assertBusinessInWorkspace(fern.id)).rejects.toThrow(/no longer exists/);
        await expect(enqueueInvestigation(fern.id)).rejects.toThrow(/no longer exists/);
        expect(await removeBusiness(fern.id)).toMatchObject({ ok: false });
      });
    }
    expect((await db.select().from(businesses).where(eq(businesses.id, fern.id)).get())!.status).toBe("new");
    expect(await db.select().from(jobs).all()).toHaveLength(0);

    // And the other way round: what B finds stays in B.
    await searchIn(B, "Joiners");
    expect(await runInWorkspace(B, async () => (await listSearches()).rows.map((s) => s.name))).toEqual(["Joiners"]);
    expect(await runInWorkspace(A, async () => (await listSearches()).rows.map((s) => s.name))).toEqual(["Trades in Leeds"]);
    expect((await runInWorkspace(A, () => listBusinesses())).total).toBe(2);
  });

  it("lets two workspaces each save the same company, found under the same place id, as their own copy", async () => {
    const a = await searchIn(A, "A looks");
    const b = await searchIn(B, "B looks");
    // B's search does not see A's copies as "already known": both are new to B.
    expect(a.run.stats).toMatchObject({ created: 2, merged: 0 });
    expect(b.run.stats).toMatchObject({ created: 2, merged: 0 });
    const ferns = (await db.select().from(businesses).all()).filter((x) => x.name === "Fernhill Joinery");
    expect(ferns.map((x) => x.workspaceId).sort()).toEqual([A, B].sort());
    expect(new Set(ferns.map((x) => x.id)).size).toBe(2);
    expect(await namesIn(A)).toEqual(["Fernhill Joinery", "Oakbeck Plumbing"]);
    expect(await namesIn(B)).toEqual(["Fernhill Joinery", "Oakbeck Plumbing"]);

    // Each works on its own copy: a change in B is not a change in A.
    const [inA, inB] = [ferns.find((x) => x.workspaceId === A)!, ferns.find((x) => x.workspaceId === B)!];
    await runInWorkspace(B, () => setStage(inB.id, "qualified"));
    expect((await runInWorkspace(B, () => getBusinessDetail(inB.id)))?.prospect?.stage).toBe("qualified");
    expect((await runInWorkspace(A, () => getBusinessDetail(inA.id)))?.prospect?.stage).toBe("discovered");

    // Searching again inside a workspace recognises its own copy by its listing: each workspace has its own link to it.
    const again = await runInWorkspace(B, async () => runDiscovery(db, b.search, mapSource()));
    expect(again.stats).toMatchObject({ created: 0, merged: 2 });
    expect(await db.select().from(businesses).all()).toHaveLength(4);
    expect((await db.select().from(businessSources).where(eq(businessSources.providerId, "place-fern")).all()).map((s) => s.businessId).sort()).toEqual([inA.id, inB.id].sort());
  });

  it("does not let a business removed in one workspace be skipped by a search in another", async () => {
    await searchIn(A, "A looks");
    const fernA = (await db.select().from(businesses).all()).find((x) => x.name === "Fernhill Joinery")!;
    expect(await runInWorkspace(A, () => removeBusiness(fernA.id))).toEqual({ ok: true, name: "Fernhill Joinery" });
    expect((await db.select().from(removedBusinesses).all()).map((r) => r.workspaceId)).toEqual([A]);
    expect((await runInWorkspace(A, () => listRemoved())).map((r) => r.name)).toEqual(["Fernhill Joinery"]);
    expect(await runInWorkspace(B, () => listRemoved())).toEqual([]);

    // B has never removed anything: its search lists and saves both.
    const b = await searchIn(B, "B looks");
    expect(b.run.stats.skippedRemoved ?? 0).toBe(0);
    expect(await namesIn(B)).toEqual(["Fernhill Joinery", "Oakbeck Plumbing"]);
    // A's own next search still leaves it out.
    const a2 = await searchIn(A, "A looks again");
    expect(a2.run.stats.skippedRemoved).toBe(1);
    expect(await namesIn(A)).toEqual(["Oakbeck Plumbing"]);
  });

  it("runs a job as the workspace it was queued in", async () => {
    await searchIn(A, "A looks");
    const fern = (await db.select().from(businesses).all()).find((x) => x.name === "Fernhill Joinery")!;
    const oak = (await db.select().from(businesses).all()).find((x) => x.name === "Oakbeck Plumbing")!;
    const queued = await runInWorkspace(A, () => enqueueInvestigation(fern.id));
    expect((await db.select().from(jobs).where(eq(jobs.id, queued.id)).get())!.workspaceId).toBe(A);
    // The same kind of job for A's other business, but carrying B's workspace (as if queued from there).
    const foreign = await runInWorkspace(B, () => enqueueJob("investigate_business", { businessId: oak.id, mode: "auto" }));
    expect((await db.select().from(jobs).where(eq(jobs.id, foreign.id)).get())!.workspaceId).toBe(B);

    // The worker itself has no workspace; each handler gets its job's.
    expect(await drainQueue(["investigate_business"])).toBe(2);
    // A's job found its business and got as far as the first thing it needs (no research key in tests).
    const fernAfter = (await db.select().from(businesses).where(eq(businesses.id, fern.id)).get())!;
    expect(fernAfter.status).toBe("failed");
    expect(fernAfter.statusMessage).toMatch(/FIRECRAWL_API_KEY/);
    // B's job could not see A's business and left it alone.
    expect((await db.select().from(jobs).where(eq(jobs.id, foreign.id)).get())!).toMatchObject({ status: "failed", error: expect.stringMatching(/not found/) });
    expect((await db.select().from(businesses).where(eq(businesses.id, oak.id)).get())!.status).toBe("new");
  });

  it("puts everything done without a workspace into the first one", async () => {
    expect(await workspaceId()).toBe(FIRST_WORKSPACE_ID);
    const search = await mkSearch("No workspace set");
    const run = await runDiscovery(db, search, mapSource());
    expect(run.stats.created).toBe(2);
    expect((await db.select().from(searches).all()).map((s) => s.workspaceId)).toEqual([FIRST_WORKSPACE_ID]);
    expect([...new Set((await db.select().from(businesses).all()).map((x) => x.workspaceId))]).toEqual([FIRST_WORKSPACE_ID]);
    expect((await listBusinesses()).total).toBe(2);
    expect((await runInWorkspace(FIRST_WORKSPACE_ID, () => listBusinesses())).total).toBe(2);
    expect((await runInWorkspace(A, () => listBusinesses())).total).toBe(0);
    const { id } = await enqueueJob("sync_mailbox", {});
    expect((await db.select().from(jobs).where(eq(jobs.id, id)).get())!.workspaceId).toBe(FIRST_WORKSPACE_ID);
    // Inside a workspace the answer is that workspace, also across awaits and nested calls.
    expect(await runInWorkspace(A, async () => [await workspaceId(), await runInWorkspace(B, () => workspaceId()), await workspaceId()])).toEqual([A, B, A]);
  });
});
