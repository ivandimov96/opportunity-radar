import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetEnv, useTempDb } from "../helpers";
import { FIRST_WORKSPACE_ID, businessSources, businesses, searches, users, workspaces } from "@/db/schema";
import { seedFixture } from "../fixtures/seed";
import { checkLogin, createUser } from "@/lib/auth";
import { newId, nowIso } from "@/lib/ids";

describe("workspaces", () => {
  let db: Awaited<ReturnType<typeof useTempDb>>;
  beforeEach(async () => {
    resetEnv({});
    db = await useTempDb();
  });

  it("exists from the start, and data saved without a workspace lands in the first one", async () => {
    expect((await db.select().from(workspaces).all()).map((w) => w.id)).toEqual([FIRST_WORKSPACE_ID]);
    const id = newId();
    await db.insert(searches).values({ id, name: "s", industry: "generic", country: "GB", city: "Leeds", providers: ["google_maps"], createdAt: nowIso(), updatedAt: nowIso() } as typeof searches.$inferInsert).run();
    expect((await db.select().from(searches).where(eq(searches.id, id)).get())!.workspaceId).toBe(FIRST_WORKSPACE_ID);
    expect(businesses.workspaceId.name).toBe("workspace_id");
  });

  it("gives the first account the first workspace and every later account an empty one of its own", async () => {
    const owner = await createUser({ email: "owner@radar.example", password: "Password-1", name: "Olga Owner" });
    const second = await createUser({ email: "second@radar.example", password: "Password-2", name: "Sam Second" });
    const third = await createUser({ email: "third@radar.example", password: "Password-3" });
    if (!owner.ok || !second.ok || !third.ok) throw new Error("accounts were not created");
    expect(owner.user).toMatchObject({ role: "owner", workspaceId: FIRST_WORKSPACE_ID });
    expect(second.user.role).toBe("member");
    expect(second.user.workspaceId).not.toBe(FIRST_WORKSPACE_ID);
    expect(third.user.workspaceId).not.toBe(second.user.workspaceId);
    expect((await db.select().from(workspaces).all()).length).toBe(3);
    expect((await db.select().from(workspaces).where(eq(workspaces.id, second.user.workspaceId)).get())!.name).toBe("Sam Second's workspace");
    // Signing in returns the same workspace that was given at sign-up.
    expect((await checkLogin("SECOND@radar.example", "Password-2"))!.workspaceId).toBe(second.user.workspaceId);
    expect((await db.select().from(users).where(eq(users.email, "second@radar.example")).get())!.workspaceId).toBe(second.user.workspaceId);
  });

  it("lets the same map listing be linked once in each workspace, and only once", async () => {
    const { businessIds } = await seedFixture();
    const link = (workspaceId: string, businessId: string) => db.insert(businessSources).values({ id: newId(), workspaceId, businessId, provider: "google_maps", providerId: "place-shared-1" }).run();
    await link("ws-a", businessIds[0]);
    await link("ws-b", businessIds[1]); // another workspace: allowed
    await expect(link("ws-a", businessIds[1])).rejects.toThrow(); // the same workspace again: refused by the database
    expect((await db.select().from(businessSources).where(eq(businessSources.providerId, "place-shared-1")).all()).map((r) => r.workspaceId).sort()).toEqual(["ws-a", "ws-b"]);
  });
});
