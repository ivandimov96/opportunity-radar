/**
 * Fast, bounded website crawl: homepage first, then the best few internal
 * pages fetched in parallel (one of each kind before a second of any kind).
 * Same-site only, robots.txt respected, per-page failures isolated.
 *
 * Homepage fallbacks, in order: the URL as given → site root (dead deep link)
 * → scheme/www variants (stale OSM URLs often miss a redirect) → sitemap.xml
 * for link discovery when the homepage exposes almost no internal links
 * (JS-rendered menus).
 */
import { getConfig } from "@/lib/config";
import { FetchBlockedError, safeFetch } from "./fetcher";
import { classifyLink, extractPage, KIND_PRIORITY, type PageContent, type PageKind } from "./html";
import { isAllowedByRobots } from "./robots";
import { looksJsRendered, renderPage } from "./render";

export interface CrawledPage {
  url: string;
  finalUrl: string;
  kind: PageKind;
  status: number | null;
  content: PageContent | null;
  bytes: number;
  ms: number;
  error: string | null;
  renderer: "static" | "browser";
}

export interface CrawlResult {
  pages: CrawledPage[];
  notes: string[];
  durationMs: number;
  /** The homepage that actually worked (may differ from the URL on record). */
  home: CrawledPage | null;
}

function sameSite(a: URL, b: URL) {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}

export async function fetchOne(url: string, kind: PageKind, notes: string[], signal?: AbortSignal): Promise<CrawledPage> {
  const started = Date.now();
  try {
    if (!(await isAllowedByRobots(url))) {
      notes.push(`robots.txt disallows ${url}`);
      return { url, finalUrl: url, kind, status: null, content: null, bytes: 0, ms: Date.now() - started, error: "Disallowed by robots.txt", renderer: "static" };
    }
    const res = await safeFetch(url, { signal });
    const ms = Date.now() - started;
    if (res.status >= 400) return { url, finalUrl: res.finalUrl, kind, status: res.status, content: null, bytes: res.bytes, ms, error: `HTTP ${res.status}`, renderer: "static" };
    if (!res.body) return { url, finalUrl: res.finalUrl, kind, status: res.status, content: null, bytes: res.bytes, ms, error: `Unsupported content type ${res.contentType ?? "unknown"}`, renderer: "static" };
    return { url, finalUrl: res.finalUrl, kind, status: res.status, content: extractPage(res.body, res.finalUrl), bytes: res.bytes, ms, error: null, renderer: "static", rawHtml: res.body } as CrawledPage & { rawHtml: string };
  } catch (err) {
    const msg = err instanceof FetchBlockedError ? `Blocked: ${err.message}` : (err as Error).message;
    return { url, finalUrl: url, kind, status: null, content: null, bytes: 0, ms: Date.now() - started, error: msg, renderer: "static" };
  }
}

/** Re-fetch a thin, script-heavy page with a headless browser; returns null when not applicable or it fails. */
async function renderIfJsOnly(page: CrawledPage & { rawHtml?: string }, notes: string[], signal?: AbortSignal): Promise<CrawledPage | null> {
  const cfg = getConfig();
  if (!cfg.browserRender.enabled || !page.content || !page.rawHtml || signal?.aborted) return null;
  if (!looksJsRendered(page.rawHtml, page.content.text.length)) return null;
  try {
    const r = await renderPage(page.finalUrl);
    const content = extractPage(r.html, r.finalUrl);
    if (content.text.length <= page.content.text.length) {
      notes.push(`Browser rendering of ${page.finalUrl} did not add text`);
      return null;
    }
    notes.push(`Rendered ${page.finalUrl} in a headless browser (${content.text.length} chars vs ${page.content.text.length} static)`);
    return { ...page, finalUrl: r.finalUrl, content, ms: page.ms + r.ms, renderer: "browser" };
  } catch (err) {
    notes.push(`Browser rendering failed for ${page.finalUrl}: ${(err as Error).message.split("\n")[0]}`);
    return null;
  }
}

/** Run fetches with at most `limit` in flight (politeness per site). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Alternative homepage URLs worth trying when the recorded one fails: root, scheme and www variants. */
export function homepageVariants(website: string): string[] {
  const out: string[] = [];
  let u: URL;
  try {
    u = new URL(website);
  } catch {
    return out;
  }
  const host = u.hostname.toLowerCase();
  const bare = host.replace(/^www\./, "");
  const hosts = host.startsWith("www.") ? [host, bare] : [host, `www.${bare}`];
  for (const scheme of ["https:", "http:"]) for (const h of hosts) out.push(`${scheme}//${h}/`);
  const given = website.replace(/\/$/, "");
  return [...new Set(out.map((x) => x.replace(/\/$/, "")))].filter((x) => x.toLowerCase() !== given.toLowerCase());
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

/** URLs from sitemap.xml (or a sitemap index's first child), same site only. */
export async function sitemapLinks(origin: string, notes: string[], signal?: AbortSignal): Promise<{ href: string; text: string }[]> {
  const read = async (url: string) => {
    try {
      const res = await safeFetch(url, { accept: "application/xml,text/xml;q=0.9,*/*;q=0.5", maxBytes: 400_000, timeoutMs: 8000, signal });
      if (res.status >= 400 || !res.body || !/<(urlset|sitemapindex)/i.test(res.body)) return null;
      return res.body;
    } catch {
      return null;
    }
  };
  let xml = await read(`${origin}/sitemap.xml`);
  if (!xml) xml = await read(`${origin}/sitemap_index.xml`);
  if (!xml) return [];
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  if (/<sitemapindex/i.test(xml) && locs.length) {
    const child = await read(locs.find((l) => /page|post|sitemap/i.test(l)) ?? locs[0]);
    if (!child) return [];
    const childLocs = [...child.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    notes.push(`Sitemap index: ${childLocs.length} URLs from first child sitemap`);
    return childLocs.slice(0, 300).map((href) => ({ href, text: "" }));
  }
  notes.push(`Sitemap: ${locs.length} URLs`);
  return locs.slice(0, 300).map((href) => ({ href, text: "" }));
}

export async function crawlWebsite(website: string, opts: { maxPages?: number; onProgress?: (m: string) => void; signal?: AbortSignal } = {}): Promise<CrawlResult> {
  const cfg = getConfig();
  const maxPages = opts.maxPages ?? cfg.RESEARCH_MAX_PAGES;
  const started = Date.now();
  const notes: string[] = [];
  const pages: CrawledPage[] = [];

  opts.onProgress?.("Fetching homepage");
  const { signal } = opts;
  let home = await fetchOne(website, "home", notes, signal);
  pages.push(home);
  if (!home.content) {
    // 1. Dead deep link → site root.
    let root: string | null = null;
    try {
      const u = new URL(website);
      if (u.pathname !== "/" || u.search) root = u.origin;
    } catch {
      /* ignore */
    }
    if (root && home.status && home.status >= 400 && home.status < 500) {
      notes.push(`Deep link returned ${home.error}; retrying site root ${root}`);
      home = await fetchOne(root, "home", notes, signal);
      pages.push(home);
    }
  }
  if (!home.content && !/robots\.txt|Blocked:/.test(home.error ?? "")) {
    // 2. Scheme / www variants, tried in parallel (connection errors, stale OSM URLs).
    const variants = homepageVariants(website).slice(0, 3);
    if (variants.length) {
      notes.push(`Homepage failed (${home.error}); trying ${variants.length} URL variant(s)`);
      const tries = await Promise.all(variants.map((v) => fetchOne(v, "home", notes, signal)));
      const ok = tries.find((t) => t.content);
      if (ok) {
        home = ok;
        pages.push(ok);
        notes.push(`Homepage reachable at ${ok.finalUrl}`);
      }
    }
  }
  if (!home.content) {
    notes.push(`Homepage unavailable: ${home.error}`);
    return { pages, notes, durationMs: Date.now() - started, home: null };
  }
  const rendered = await renderIfJsOnly(home, notes, signal);
  if (rendered) {
    pages[pages.indexOf(home)] = rendered;
    home = rendered;
  }
  const homeContent = home.content as PageContent;

  const base = new URL(home.finalUrl);
  let picks = chooseLinks(homeContent, base, Math.max(0, maxPages - 1));
  if (picks.length < 2 && maxPages > 2) {
    // 3. JS-rendered menus expose few links in HTML; the sitemap usually lists the key pages.
    const extra = await sitemapLinks(base.origin, notes, signal);
    if (extra.length) picks = chooseLinks({ ...homeContent, links: [...homeContent.links, ...extra] }, base, Math.max(0, maxPages - 1));
  }
  if (picks.length) {
    opts.onProgress?.(`Fetching ${picks.length} key pages`);
    const results = await mapLimit(picks, 2, async (p) => {
      const page = await fetchOne(p.url, p.kind, notes, signal);
      return home.renderer === "browser" ? ((await renderIfJsOnly(page, notes, signal)) ?? page) : page;
    });
    const seenText = new Set<string>([homeContent.text.slice(0, 2000)]);
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
  return { pages, notes, durationMs: Date.now() - started, home };
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
