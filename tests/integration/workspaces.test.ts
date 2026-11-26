import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetEnv, useTempDb } from "../helpers";
import { FIRST_WORKSPACE_ID, businessSources, businesses, searches, users, workspaces } from "@/db/schema";
import { seedFixture } from "../fixtures/seed";
import { checkLogin, createUser, landingAfterSignIn } from "@/lib/auth";
import { _setMicrosoftSignInFetch, microsoftIdentity, userForMicrosoft } from "@/lib/auth/microsoft";
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
    // Someone who signs up owns their workspace and starts with the first-run setup; nothing of the first workspace is theirs.
    expect(second.user.role).toBe("owner");
    expect(await landingAfterSignIn(second.user)).toBe("/setup");
    expect((await db.select().from(workspaces).where(eq(workspaces.id, second.user.workspaceId)).get())!.plan).toBe("trial");
    expect(second.user.workspaceId).not.toBe(FIRST_WORKSPACE_ID);
    expect(third.user.workspaceId).not.toBe(second.user.workspaceId);
    expect((await db.select().from(workspaces).all()).length).toBe(3);
    expect((await db.select().from(workspaces).where(eq(workspaces.id, second.user.workspaceId)).get())!.name).toBe("Sam Second's workspace");
    // Signing in returns the same workspace that was given at sign-up.
    expect((await checkLogin("SECOND@radar.example", "Password-2"))!.workspaceId).toBe(second.user.workspaceId);
    expect((await db.select().from(users).where(eq(users.email, "second@radar.example")).get())!.workspaceId).toBe(second.user.workspaceId);
  });

  it("keeps new accounts waiting when sign-ups are set to a waiting list", async () => {
    resetEnv({ SIGNUP_MODE: "waitlist" });
    const owner = await createUser({ email: "owner@radar.example", password: "Password-1" });
    const second = await createUser({ email: "second@radar.example", password: "Password-2" });
    if (!owner.ok || !second.ok) throw new Error("accounts were not created");
    expect(owner.user.role).toBe("owner");
    expect(second.user.role).toBe("member");
    expect(await landingAfterSignIn(second.user)).toBe("/welcome");
  });

  it("signs in with Microsoft: a new account of its own, the same one next time, and never an account made another way", async () => {
    resetEnv({ MICROSOFT_CLIENT_ID: "client", MICROSOFT_CLIENT_SECRET: "secret" });
    const answers = (me: object) =>
      _setMicrosoftSignInFetch(async (url) => new Response(JSON.stringify(url.includes("/token") ? { access_token: "token" } : me), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await createUser({ email: "owner@radar.example", password: "Password-1" });
      answers({ id: "ms-1", displayName: "Mira Microsoft", mail: "Mira@Outlook.example", userPrincipalName: "mira@outlook.example" });
      const who = await microsoftIdentity("https://app.example", "code");
      expect(who).toEqual({ id: "ms-1", email: "mira@outlook.example", name: "Mira Microsoft" });
      const created = await userForMicrosoft(who);
      expect(created).toMatchObject({ role: "owner", email: "mira@outlook.example" });
      expect(created.workspaceId).not.toBe(FIRST_WORKSPACE_ID);
      expect(await landingAfterSignIn(created)).toBe("/setup");
      expect((await userForMicrosoft(who)).id).toBe(created.id);
      // No password opens it, and a different Microsoft identity reporting the same address is refused.
      expect(await checkLogin("mira@outlook.example", "microsoft:ms-1")).toBeNull();
      await expect(userForMicrosoft({ ...who, id: "ms-other" })).rejects.toThrow(/already exists/);
      // An account made with a password is not opened by a Microsoft account that reports its address.
      await expect(userForMicrosoft({ id: "ms-2", email: "owner@radar.example", name: "" })).rejects.toThrow(/already exists/);
      answers({ id: "ms-3", displayName: "No Mail" });
      await expect(microsoftIdentity("https://app.example", "code")).rejects.toThrow(/no email address/);
    } finally {
      _setMicrosoftSignInFetch(null);
    }
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
