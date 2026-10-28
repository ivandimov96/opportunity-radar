/**
 * Stored pages: the raw HTML of every page read in an investigation is kept, so
 * detectors can run again ("re-analyze") and recent research can be reused
 * without spending Firecrawl credits. Also the monthly credit ledger that the
 * budget guard and the System page read.
 */
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { investigations, pages } from "@/db/schema";
import { websiteDomain } from "@/lib/discovery/normalize";
import { extractPage, type PageKind } from "./html";
import type { CrawledPage } from "./crawl";

export interface StoredPages {
  investigationId: string;
  startedAt: string;
  ageDays: number;
  pages: CrawledPage[];
}

/**
 * Pages from the latest finished investigation of this business, when they were
 * kept with their HTML, belong to the same website and are younger than `maxAgeDays`.
 */
export async function loadStoredPages(businessId: string, website: string, maxAgeDays: number): Promise<StoredPages | null> {
  const db = await getDb();
  const inv = await db
    .select({ id: investigations.id, startedAt: investigations.startedAt })
    .from(investigations)
    .where(and(eq(investigations.businessId, businessId), eq(investigations.status, "done")))
    .orderBy(desc(investigations.startedAt))
    .limit(1)
    .get();
  if (!inv) return null;
  const ageDays = (Date.now() - new Date(inv.startedAt).getTime()) / 86_400_000;
  if (!(ageDays <= maxAgeDays)) return null;
  const rows = await db.select().from(pages).where(and(eq(pages.investigationId, inv.id), isNotNull(pages.html))).all();
  const domain = websiteDomain(website);
  // The site the business record names, plus the site its homepage redirected to (a shop acquired by a
  // group, a moved domain): pages on either belong to this website. Measured once: a redirect made every
  // stored page look foreign and a second run paid for a fresh crawl.
  const home = rows.find((r) => r.kind === "home" && websiteDomain(r.url) === domain) ?? rows.find((r) => r.kind === "home");
  const allowed = new Set([domain, home ? websiteDomain(home.finalUrl ?? home.url) : null].filter(Boolean));
  const usable = rows.filter((r) => r.html && (!domain || allowed.has(websiteDomain(r.url)) || allowed.has(websiteDomain(r.finalUrl ?? r.url))));
  if (!usable.some((r) => r.kind === "home")) return null;
  const out: CrawledPage[] = usable.map((r) => ({
    url: r.url,
    finalUrl: r.finalUrl ?? r.url,
    kind: r.kind as PageKind,
    status: r.statusCode,
    content: extractPage(r.html!, r.finalUrl ?? r.url),
    markdown: r.markdown,
    rawHtml: r.html,
    bytes: r.bytes ?? r.html!.length,
    ms: 0,
    error: null,
    credits: 0,
  }));
  return { investigationId: inv.id, startedAt: inv.startedAt, ageDays: Math.floor(ageDays), pages: out };
}

/** Firecrawl credits recorded on investigations started this calendar month (UTC). */
export async function creditsUsedThisMonth(): Promise<{ credits: number; investigations: number; since: string }> {
  const db = await getDb();
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const row = await db
    .select({ credits: sql<number>`coalesce(sum(${investigations.creditsUsed}), 0)`, n: sql<number>`sum(case when ${investigations.creditsUsed} > 0 then 1 else 0 end)` })
    .from(investigations)
    .where(gte(investigations.startedAt, since))
    .get();
  return { credits: Number(row?.credits ?? 0), investigations: Number(row?.n ?? 0), since };
}
