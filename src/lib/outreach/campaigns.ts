/**
 * Campaigns are batches: one is open at any time and collects the emails that
 * are written; "Send approved" closes it and the next email opens a new one.
 * There is nothing to manage: the batch exists so that what was sent together
 * can be seen together afterwards.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaigns } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";

export type Campaign = typeof campaigns.$inferSelect;

export function campaignName(d = new Date()): string {
  return `Outreach ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

/** The open batch, created when there is none. */
export async function openCampaign(): Promise<Campaign> {
  const db = await getDb();
  const existing = await db.select().from(campaigns).where(eq(campaigns.status, "open")).orderBy(desc(campaigns.createdAt)).limit(1).get();
  if (existing) return existing;
  const id = newId();
  await db.insert(campaigns).values({ id, name: campaignName(), status: "open", createdAt: nowIso() }).run();
  return (await db.select().from(campaigns).where(eq(campaigns.id, id)).get())!;
}

export async function listCampaigns(limit = 30) {
  const db = await getDb();
  return db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(limit).all();
}
