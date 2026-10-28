/**
 * Metered third-party calls: a per-provider monthly counter (budget guard) and
 * a response cache keyed by the exact request, so a repeated search never
 * spends a second call. Periods are UTC calendar months (YYYY-MM).
 */
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { providerCache, providerUsage } from "@/db/schema";

export const currentPeriod = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export async function usageThisMonth(provider: string): Promise<{ used: number; period: string }> {
  const db = await getDb();
  const period = currentPeriod();
  const row = await db.select().from(providerUsage).where(and(eq(providerUsage.provider, provider), eq(providerUsage.period, period))).get();
  return { used: row?.used ?? 0, period };
}

export async function recordUsage(provider: string, n = 1): Promise<number> {
  const db = await getDb();
  const period = currentPeriod();
  const now = new Date().toISOString();
  const row = await db.select().from(providerUsage).where(and(eq(providerUsage.provider, provider), eq(providerUsage.period, period))).get();
  const used = (row?.used ?? 0) + n;
  if (row) await db.update(providerUsage).set({ used, updatedAt: now }).where(and(eq(providerUsage.provider, provider), eq(providerUsage.period, period))).run();
  else await db.insert(providerUsage).values({ provider, period, used, updatedAt: now }).run();
  return used;
}

export async function cacheGet<T>(key: string, maxAgeDays: number): Promise<{ value: T; fetchedAt: string } | null> {
  const db = await getDb();
  const since = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  const row = await db.select().from(providerCache).where(and(eq(providerCache.key, key), gt(providerCache.fetchedAt, since))).get();
  return row ? { value: row.value as T, fetchedAt: row.fetchedAt } : null;
}

export async function cachePut(key: string, provider: string, value: unknown): Promise<void> {
  const db = await getDb();
  const fetchedAt = new Date().toISOString();
  const v = value as Record<string, unknown>;
  await db.insert(providerCache).values({ key, provider, value: v, fetchedAt }).onConflictDoUpdate({ target: providerCache.key, set: { value: v, fetchedAt } }).run();
}
