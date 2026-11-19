/**
 * Campaigns are batches: each workspace has one open at any time, which collects
 * the emails that are written; "Send approved" closes it and the next email opens a new one.
 * There is nothing to manage: the batch exists so that what was sent together
 * can be seen together afterwards. A batch of another workspace is "not found".
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaigns } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { workspaceId } from "@/lib/workspace";

export type Campaign = typeof campaigns.$inferSelect;

export function campaignName(d = new Date()): string {
  return `Outreach ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

/** The acting workspace's open batch, created when there is none. */
export async function openCampaign(): Promise<Campaign> {
  const db = await getDb();
  const ws = await workspaceId();
  const existing = await db.select().from(campaigns).where(and(eq(campaigns.workspaceId, ws), eq(campaigns.status, "open"))).orderBy(desc(campaigns.createdAt)).limit(1).get();
  if (existing) return existing;
  const id = newId();
  await db.insert(campaigns).values({ id, workspaceId: ws, name: campaignName(), status: "open", createdAt: nowIso() }).run();
  return (await db.select().from(campaigns).where(eq(campaigns.id, id)).get())!;
}

/** A batch by id, when it belongs to the acting workspace. */
export async function campaignInWorkspace(campaignId: string | null): Promise<Campaign | null> {
  if (!campaignId) return null;
  const db = await getDb();
  return (await db.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, await workspaceId()))).get()) ?? null;
}

export async function listCampaigns(limit = 30) {
  const db = await getDb();
  return db.select().from(campaigns).where(eq(campaigns.workspaceId, await workspaceId())).orderBy(desc(campaigns.createdAt)).limit(limit).all();
}
