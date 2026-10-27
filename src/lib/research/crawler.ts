/**
 * Fast, bounded website crawl: homepage first, then the best few internal
 * pages fetched in parallel (one of each kind before a second of any kind).
 * Same-site only, robots.txt respected, per-page failures isolated.
 */
import { getConfig } from "@/lib/config";
import { FetchBlockedError, safeFetch } from "./fetcher";
import { classifyLink, extractPage, KIND_PRIORITY, type PageContent, type PageKind } from "./html";
import { isAllowedByRobots } from "./robots";

export interface CrawledPage {
  url: string;
  finalUrl: string;
  kind: PageKind;
  status: number | null;
  content: PageContent | null;
  bytes: number;
  error: string | null;
}

export interface CrawlResult {
  pages: CrawledPage[];
  notes: string[];
  durationMs: number;
}

function sameSite(a: URL, b: URL) {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}

export async function fetchOne(url: string, kind: PageKind, notes: string[]): Promise<CrawledPage> {
  try {
    if (!(await isAllowedByRobots(url))) {
      notes.push(`robots.txt disallows ${url}`);
      return { url, finalUrl: url, kind, status: null, content: null, bytes: 0, error: "Disallowed by robots.txt" };
    }
    const res = await safeFetch(url);
    if (res.status >= 400) return { url, finalUrl: res.finalUrl, kind, status: res.status, content: null, bytes: res.bytes, error: `HTTP ${res.status}` };
    if (!res.body) return { url, finalUrl: res.finalUrl, kind, status: res.status, content: null, bytes: res.bytes, error: `Unsupported content type ${res.contentType ?? "unknown"}` };
    return { url, finalUrl: res.finalUrl, kind, status: res.status, content: extractPage(res.body, res.finalUrl), bytes: res.bytes, error: null };
  } catch (err) {
    const msg = err instanceof FetchBlockedError ? `Blocked: ${err.message}` : (err as Error).message;
    return { url, finalUrl: url, kind, status: null, content: null, bytes: 0, error: msg };
  }
}

/** Pick internal links to crawl: one page per kind in priority order, then a second round. */
export function chooseLinks(home: PageContent, base: URL, budget: number): { url: string; kind: PageKind }[] {
  const seen = new Set<string>([normalizeUrl(base.toString())]);
  const byKind = new Map<PageKind, { url: string; kind: PageKind; score: number }[]>();
  for (const l of home.links) {
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    if (!sameSite(u, base)) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|zip|mp4|webp|css|js|xml)$/i.test(u.pathname)) continue;
    if (/\/(wp-json|wp-admin|feed|tag|category|author|page\/\d+|blog\/)/i.test(u.pathname)) continue;
    const key = normalizeUrl(u.toString());
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = classifyLink(u.pathname + u.search, l.text);
    if (kind === "other") continue;
    const list = byKind.get(kind) ?? [];
    list.push({ url: u.toString(), kind, score: u.pathname.length });
    byKind.set(kind, list);
  }
  const kinds = [...byKind.keys()].sort((a, b) => KIND_PRIORITY[a] - KIND_PRIORITY[b]);
  for (const k of kinds) byKind.get(k)!.sort((a, b) => a.score - b.score);
  const chosen: { url: string; kind: PageKind }[] = [];
  for (let round = 0; chosen.length < budget; round++) {
    let added = false;
    for (const k of kinds) {
      const e = byKind.get(k)?.[round];
      if (e && chosen.length < budget) {
        chosen.push({ url: e.url, kind: e.kind });
        added = true;
      }
    }
    if (!added) break;
  }
  return chosen;
}

export async function crawlWebsite(website: string, opts: { maxPages?: number; onProgress?: (m: string) => void } = {}): Promise<CrawlResult> {
  const cfg = getConfig();
  const maxPages = opts.maxPages ?? cfg.RESEARCH_MAX_PAGES;
  const started = Date.now();
  const notes: string[] = [];
  const pages: CrawledPage[] = [];

  opts.onProgress?.("Fetching homepage");
  let home = await fetchOne(website, "home", notes);
  pages.push(home);
  if (!home.content) {
    let root: string | null = null;
    try {
      const u = new URL(website);
      if (u.pathname !== "/" || u.search) root = u.origin;
    } catch {
      /* ignore */
    }
    if (root && home.status && home.status >= 400 && home.status < 500) {
      notes.push(`Deep link returned ${home.error}; retrying site root ${root}`);
      home = await fetchOne(root, "home", notes);
      pages.push(home);
    }
  }
  if (!home.content) {
    notes.push(`Homepage unavailable: ${home.error}`);
    return { pages, notes, durationMs: Date.now() - started };
  }

  const picks = chooseLinks(home.content, new URL(home.finalUrl), Math.max(0, maxPages - 1));
  if (picks.length) {
    opts.onProgress?.(`Fetching ${picks.length} key pages`);
    const results = await Promise.all(picks.map((p) => fetchOne(p.url, p.kind, notes)));
    const seenText = new Set<string>([home.content.text.slice(0, 2000)]);
    for (const p of results) {
      const sig = p.content?.text.slice(0, 2000);
      if (sig && seenText.has(sig)) {
        notes.push(`Skipped duplicate content at ${p.url}`);
        continue;
      }
      if (sig) seenText.add(sig);
      pages.push(p);
    }
  }
  return { pages, notes, durationMs: Date.now() - started };
}

function normalizeUrl(u: string) {
  try {
    const x = new URL(u);
    x.hash = "";
    let s = x.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return u;
  }
}
