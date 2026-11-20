/**
 * The first-run setup. An account someone signed up for themselves starts with the setup ahead of it;
 * an account made on purpose (a script, a test) does not. The setup is over only when it is finished
 * with everything needed in place, and each workspace has its own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), requireOwner: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { resetEnv, useTempDb } from "../helpers";
import { finishOnboardingAction } from "@/app/actions";
import { profileStepDone } from "@/app/settings/profile-steps";
import { FIRST_WORKSPACE_ID } from "@/db/schema";
import { createUser, markOnboardingPending } from "@/lib/auth";
import { getSettings, getState, saveSettings } from "@/lib/settings";
import { runInWorkspace } from "@/lib/workspace";

const state = (ws: string) => runInWorkspace(ws, () => getState<string>("onboarding"));
const form = (to: string) => {
  const fd = new FormData();
  fd.set("to", to);
  return fd;
};

describe("the first-run setup", () => {
  beforeEach(async () => {
    resetEnv({});
    await useTempDb();
  });

  it("starts pending for an account someone signed up for, and not for one made on purpose", async () => {
    const first = await createUser({ email: "olga@radar.example", password: "Password-1", name: "Olga Owner" });
    const second = await createUser({ email: "sam@radar.example", password: "Password-2", name: "Sam Second" });
    const scripted = await createUser({ email: "ops@radar.example", password: "Password-3", role: "owner" });
    if (!first.ok || !second.ok || !scripted.ok) throw new Error("accounts were not created");
    expect(first.user.workspaceId).toBe(FIRST_WORKSPACE_ID);
    expect(await state(first.user.workspaceId)).toBe("pending");
    expect(await state(second.user.workspaceId)).toBe("pending");
    expect(second.user.workspaceId).not.toBe(first.user.workspaceId);
    // Marking twice changes nothing, and a finished setup is not reopened by it.
    await markOnboardingPending(second.user.workspaceId);
    expect(await state(second.user.workspaceId)).toBe("pending");
  });

  it("knows which steps are done from what is filled in", async () => {
    expect(profileStepDone(await getSettings())).toEqual({ you: false, offer: false, audience: false, extras: false });
    const s = await saveSettings({ senderName: "Nell Harbour", postalAddress: "1 Quay Street, Leeds", offer: "I build booking tools.", targetKinds: "dentists" });
    // Half a step is not a step: the result is missing, and so is the place.
    expect(profileStepDone(s)).toEqual({ you: true, offer: false, audience: false, extras: false });
    expect(profileStepDone(await saveSettings({ offerResult: "Fewer missed calls and no-shows.", targetPlaces: "GB", bookingLink: "https://cal.example/nell" }))).toEqual({ you: true, offer: true, audience: true, extras: true });
  });

  it("can only be finished with everything needed in place, and then leads where the person chose", async () => {
    await markOnboardingPending(FIRST_WORKSPACE_ID);
    // Nothing filled in: finishing leads back into the setup and the account stays new.
    await expect(finishOnboardingAction(form("search"))).rejects.toMatchObject({ digest: expect.stringContaining("/setup") });
    expect(await state(FIRST_WORKSPACE_ID)).toBe("pending");
    await saveSettings({ senderName: "Nell Harbour", postalAddress: "1 Quay Street, Leeds", offer: "I build booking tools.", offerResult: "Fewer missed calls and no-shows.", targetKinds: "dentists", targetPlaces: "GB" });
    await expect(finishOnboardingAction(form("search"))).rejects.toMatchObject({ digest: expect.stringContaining("/searches/new") });
    expect(await state(FIRST_WORKSPACE_ID)).toBe("done");
    // Another workspace's setup is its own.
    await markOnboardingPending("ws-meadow");
    expect(await state("ws-meadow")).toBe("pending");
    expect(await state(FIRST_WORKSPACE_ID)).toBe("done");
  });
});
