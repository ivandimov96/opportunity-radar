/**
 * Removing a business for good. The business and everything researched about
 * it is deleted, and a small record of who it was stays behind so that a later
 * search or import recognises it and leaves it out. A business that has already
 * been emailed is never removed: the record of that email (and of any reply or
 * opt-out) must stay, so it is moved to "Lost" instead. What was removed is
 * remembered per workspace: one workspace's decision never hides a business
 * from another's searches.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, businessSources, outreachDrafts, removedBusinesses } from "@/db/schema";
import { normalizeCity, normalizeName, normalizePhone, websiteDomain, normalizeWebsite } from "@/lib/discovery/normalize";
import { newId } from "@/lib/ids";
import { OUTBOUND_COMMITTED } from "@/lib/outreach/eligibility";
import { workspaceId } from "@/lib/workspace";

type Db = Awaited<ReturnType<typeof getDb>>;
export type RemovedRow = typeof removedBusinesses.$inferSelect;
export type RemoveResult = { ok: true; name: string } | { ok: false; error: string };

export async function removeBusiness(id: string, note?: string | null): Promise<RemoveResult> {
  const db = await getDb();
  const ws = await workspaceId();
  const b = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.workspaceId, ws))).get();
  if (!b) return { ok: false, error: "That business no longer exists." };
  const emailed = await db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(and(eq(outreachDrafts.businessId, id), inArray(outreachDrafts.status, OUTBOUND_COMMITTED))).limit(1).get();
  if (emailed) return { ok: false, error: `${b.name} was already emailed, so its record is kept. Move it to "Lost" on the pipeline instead.` };
  const sources = await db.select({ provider: businessSources.provider, providerId: businessSources.providerId }).from(businessSources).where(eq(businessSources.businessId, id)).all();
  // One batch: the memory of the business is written and the business deleted together (see src/db/client.ts).
  await db.batch([
    db.insert(removedBusinesses).values({
      id: newId(),
      workspaceId: ws,
      name: b.name,
      nameNormalized: b.nameNormalized,
      city: b.city,
      websiteDomain: b.websiteDomain,
      phone: b.phone,
      sourceIds: sources.filter((s) => s.providerId).map((s) => `${s.provider}:${s.providerId}`),
      verdict: b.verdict,
      note: note?.trim().slice(0, 300) || null,
    }),
    db.delete(businesses).where(eq(businesses.id, id)),
  ]);
  return { ok: true, name: b.name };
}

export interface RemovedMatchInput {
  name: string;
  city?: string | null;
  website?: string | null;
  websiteDomain?: string | null;
  phone?: string | null;
  sources?: { provider: string; providerId: string | null }[];
}

/** The removed business a newly found record corresponds to, if any: same listing, same website, same phone, or same name in the same city. */
export async function findRemoved(db: Db, m: RemovedMatchInput): Promise<RemovedRow | null> {
  const all = await db.select().from(removedBusinesses).where(eq(removedBusinesses.workspaceId, await workspaceId())).all();
  if (!all.length) return null;
  const ids = new Set((m.sources ?? []).filter((s) => s.providerId).map((s) => `${s.provider}:${s.providerId}`));
  const domain = m.websiteDomain ?? websiteDomain(normalizeWebsite(m.website ?? null));
  const phone = normalizePhone(m.phone ?? null);
  const name = normalizeName(m.name);
  const city = normalizeCity(m.city);
  return (
    all.find((r) => (r.sourceIds ?? []).some((s) => ids.has(s))) ??
    all.find((r) => Boolean(domain) && r.websiteDomain === domain) ??
    all.find((r) => Boolean(phone) && r.phone === phone) ??
    all.find((r) => Boolean(name) && Boolean(city) && r.nameNormalized === name && normalizeCity(r.city) === city) ??
    null
  );
}

export async function listRemoved(limit = 200): Promise<RemovedRow[]> {
  const db = await getDb();
  return db.select().from(removedBusinesses).where(eq(removedBusinesses.workspaceId, await workspaceId())).orderBy(desc(removedBusinesses.removedAt)).limit(limit).all();
}

/** Forget that a business was removed, so a later search may find and save it again. */
export async function allowAgain(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(removedBusinesses).where(and(eq(removedBusinesses.id, id), eq(removedBusinesses.workspaceId, await workspaceId()))).run();
}
