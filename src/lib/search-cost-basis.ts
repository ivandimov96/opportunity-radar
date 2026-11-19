/**
 * The measured figures behind a search's cost estimate: credits left, and what
 * research and an email have actually cost this workspace so far. Server only;
 * the arithmetic itself is in search-cost.ts.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { getConfig } from "@/lib/config";
import { usageTotal } from "@/lib/discovery/usage";
import { creditsUsedThisMonth } from "@/lib/research/stored";
import { getSettings } from "@/lib/settings";
import { workspaceId } from "@/lib/workspace";
import { MIN_HISTORY, TYPICAL_COST, type SearchCostBasis } from "./search-cost";

/** Serper bills 3 credits for a page of 20 map listings (measured live; the provider records what each call really cost). */
const CREDITS_PER_PAGE = 3;
const LISTINGS_PER_PAGE = 20;

export async function searchCostBasis(): Promise<SearchCostBasis> {
  const cfg = getConfig();
  const db = await getDb();
  const ws = await workspaceId();
  const [serperUsed, crawl, settings, research, emails, pages] = await Promise.all([
    usageTotal("serper"),
    creditsUsedThisMonth(),
    getSettings(),
    db.get<{ n: number; avg: number | null }>(sql`select count(*) as n, avg(c) as avg from (select sum(estimated_cost_usd) as c from ai_usage where workspace_id = ${ws} and stage = 'investigate' and business_id is not null group by business_id)`),
    db.get<{ n: number; avg: number | null }>(sql`select count(*) as n, avg(c) as avg from (select sum(estimated_cost_usd) as c from ai_usage where workspace_id = ${ws} and stage in ('outreach', 'check') and business_id is not null group by business_id)`),
    db.get<{ avg: number | null }>(sql`select avg(i.credits_used) as avg from investigations i join businesses b on b.id = i.business_id where b.workspace_id = ${ws} and i.status = 'done' and i.credits_used > 0`),
  ]);
  const own = Number(research?.n ?? 0) >= MIN_HISTORY;
  const ai = cfg.ai.enabled;
  return {
    creditsPerPage: CREDITS_PER_PAGE,
    listingsPerPage: LISTINGS_PER_PAGE,
    maxPages: cfg.SERPER_MAX_PAGES,
    searchCreditsLeft: Math.max(0, cfg.SERPER_CREDIT_BUDGET - serperUsed),
    researchUsd: !ai ? 0 : own && research?.avg ? Number(research.avg) : TYPICAL_COST.researchUsd,
    emailUsd: !ai ? 0 : own && Number(emails?.n ?? 0) >= MIN_HISTORY && emails?.avg ? Number(emails.avg) : TYPICAL_COST.emailUsd,
    pageCreditsPerResearch: !cfg.firecrawl.enabled ? 0 : own && pages?.avg ? Number(pages.avg) : TYPICAL_COST.pageCreditsPerResearch,
    pageCreditsLeft: Math.max(0, cfg.FIRECRAWL_MONTHLY_CREDIT_BUDGET - crawl.credits),
    measuredFrom: own && ai ? Number(research?.n ?? 0) : 0,
    autoDraft: settings.autoDraft && ai,
  };
}
