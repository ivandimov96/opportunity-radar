/**
 * Minimal web search abstraction used by the website finder. Two providers:
 *  - Brave Search API (keyed; supported, fast, generous free tier at the time of writing).
 *  - DuckDuckGo HTML endpoint (keyless, opt-in only: its robots.txt allows crawling,
 *    but live checks on 2026-10-27 returned a bot-challenge page for every query, so
 *    "auto" never selects it; throttled to one query per 3 s when enabled explicitly).
 * Results are candidate URLs only; nothing is stored until verified elsewhere.
 */
import * as cheerio from "cheerio";
import { getConfig } from "@/lib/config";

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

const UA = "OpportunityRadarBot/0.1 (+https://github.com/opportunity-radar; respectful research crawler)";
const TIMEOUT = 12_000;

let ddgNext = 0;
async function throttleDdg() {
  const now = Date.now();
  const wait = Math.max(0, ddgNext - now);
  ddgNext = Math.max(now, ddgNext) + 3_000;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export function decodeDdgHref(href: string): string | null {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    if (target) return target;
    if (/^https?:/.test(href) && !/duckduckgo\.com/.test(u.hostname)) return href;
    return null;
  } catch {
    return null;
  }
}

export function parseDdgHtml(html: string, limit: number): SearchHit[] {
  const $ = cheerio.load(html);
  const hits: SearchHit[] = [];
  $(".result").each((_, el) => {
    if (hits.length >= limit) return;
    const a = $(el).find("a.result__a").first();
    const url = decodeDdgHref(a.attr("href") ?? "");
    if (!url) return;
    hits.push({ url, title: a.text().trim(), snippet: $(el).find(".result__snippet").text().trim() });
  });
  return hits;
}

async function searchDuckDuckGo(query: string, limit: number): Promise<SearchHit[]> {
  await throttleDdg();
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
    body: new URLSearchParams({ q: query, kl: "us-en" }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (res.status === 429 || res.status === 403) throw new Error(`DuckDuckGo rate-limited (HTTP ${res.status})`);
  const html = await res.text();
  // Observed 2026-10-27: automated queries get HTTP 202 with a challenge page ("anomaly") instead of results.
  if (res.status === 202 || /anomaly|bot detection|challenge/i.test(html.slice(0, 20_000)) && !/result__a/.test(html)) throw new Error("DuckDuckGo blocked automated queries (challenge page)");
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  return parseDdgHtml(html, limit);
}

async function searchBrave(query: string, limit: number): Promise<SearchHit[]> {
  const cfg = getConfig();
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(20, limit)));
  url.searchParams.set("country", "us");
  const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": cfg.BRAVE_SEARCH_API_KEY ?? "", "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Brave Search HTTP ${res.status}`);
  const data = (await res.json()) as { web?: { results?: { url: string; title?: string; description?: string }[] } };
  return (data.web?.results ?? []).slice(0, limit).map((r) => ({ url: r.url, title: r.title ?? "", snippet: r.description ?? "" }));
}

export type SearchFn = (query: string, limit: number) => Promise<SearchHit[]>;

/** Returns [] (with a note) when no provider is enabled; throws on provider failure. */
export async function webSearch(query: string, limit = 8, override?: SearchFn): Promise<SearchHit[]> {
  if (override) return override(query, limit);
  const provider = getConfig().webSearch.provider;
  if (!provider) return [];
  return provider === "brave" ? searchBrave(query, limit) : searchDuckDuckGo(query, limit);
}
