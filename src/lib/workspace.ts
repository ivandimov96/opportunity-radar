/**
 * Which workspace the running code is acting for. Searches, businesses and
 * everything derived from a business belong to one workspace, and every query
 * on them asks here whose data it may touch.
 *
 * The answer comes from, in this order:
 *  1. `runInWorkspace`: a job carries the workspace it was queued in, and the
 *     worker runs its handler inside it (there is no signed-in user there);
 *  2. the signed-in user of the current request (pages, actions, API routes);
 *  3. the first workspace.
 *
 * The fallback (3) exists because some code runs with neither: the command
 * line scripts, the tests, the scheduler, and everything that was written
 * before accounts and whose data lives in the first workspace. It keeps them
 * working while the tables are scoped one slice at a time, and it goes away
 * when the last slice lands: from then on code without a workspace is an error.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import { FIRST_WORKSPACE_ID, businesses, outreachDrafts, searches } from "@/db/schema";

const g = globalThis as unknown as { __radarWorkspace?: AsyncLocalStorage<string> };
// One store per process, also across dev-mode module reloads (the worker and the pages must share it).
const store = (g.__radarWorkspace ??= new AsyncLocalStorage<string>());

/** Runs `fn` (and everything it awaits) as the given workspace. */
export function runInWorkspace<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return store.run(workspaceId, fn);
}

/**
 * The signed-in user's workspace, looked up once per page render (React's
 * `cache`; in actions and API routes, where there is no render to tie it to,
 * it is simply looked up again). Outside a request there are no cookies to
 * read and the lookup throws: that is "no user", not an error.
 */
const signedInWorkspace = cache(async (): Promise<string | null> => {
  try {
    const { currentUser } = await import("@/lib/auth");
    return (await currentUser())?.workspaceId ?? null;
  } catch (err) {
    unstable_rethrow(err); // the framework's own signals (a redirect, a page that must render per request) pass through
    return null;
  }
});

export async function workspaceId(): Promise<string> {
  return store.getStore() ?? (await signedInWorkspace()) ?? FIRST_WORKSPACE_ID;
}

/** Whether a business exists in the acting workspace. A business of another workspace is "not found". */
export async function businessInWorkspace(businessId: string): Promise<boolean> {
  if (!businessId) return false;
  const db = await getDb();
  return Boolean(await db.select({ id: businesses.id }).from(businesses).where(and(eq(businesses.id, businessId), eq(businesses.workspaceId, await workspaceId()))).get());
}

/** For actions and jobs that take a business id and then write: refuses an id that is not in the acting workspace. */
export async function assertBusinessInWorkspace(businessId: string): Promise<void> {
  if (!(await businessInWorkspace(businessId))) throw new Error("That business no longer exists.");
}

export async function searchInWorkspace(searchId: string): Promise<boolean> {
  if (!searchId) return false;
  const db = await getDb();
  return Boolean(await db.select({ id: searches.id }).from(searches).where(and(eq(searches.id, searchId), eq(searches.workspaceId, await workspaceId()))).get());
}

/**
 * Ids of the businesses of a workspace, as a subquery. Emails, replies, stages and activities have no
 * workspace of their own: they belong to the workspace of their business and are scoped with this.
 * Never awaited on its own (awaiting it would run it and hand back rows).
 */
export function businessIdsOf(db: Awaited<ReturnType<typeof getDb>>, ws: string) {
  return db.select({ id: businesses.id }).from(businesses).where(eq(businesses.workspaceId, ws));
}

/** An email by id, when it was written for a business of the acting workspace. Anyone else's email is "not found". */
export async function draftInWorkspace(draftId: string) {
  if (!draftId) return null;
  const db = await getDb();
  return (await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.id, draftId), inArray(outreachDrafts.businessId, businessIdsOf(db, await workspaceId())))).get()) ?? null;
}
