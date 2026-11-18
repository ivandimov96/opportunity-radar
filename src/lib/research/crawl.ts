/**
 * Website research through Firecrawl: the homepage first, then the best few
 * internal pages (one of each kind before a second of any kind). Page discovery
 * is free: the homepage's own links. Firecrawl's site map (one credit) is used
 * only when the homepage exposes almost no links, which is what script-rendered
 * menus look like. Every page costs one credit, so the page budget is explicit
 * and nothing off-topic (blog archives, tag pages, media) is ever requested.
 *
 * Homepage fallbacks: a dead deep link → the site root; a connection-level
 * failure → the www/bare variant. Same site only, robots.txt respected,
 * bot-protection pages recorded as blocked (never bypassed), per-page failures
 * isolated, and an exhausted credit balance stops the crawl with what was read.
 */
import { getConfig } from "@/lib/config";
import { classifyLink, extractPage, KIND_PRIORITY, type PageContent, type PageKind } from "./html";
import { pickBusinessEmail } from "./detect";
import { isAllowedByRobots } from "./robots";
import { FirecrawlCreditsError, mapSite, scrapePage, type MapFn, type ScrapeFn, type ScrapeResult } from "./firecrawl";
import { UrlBlockedError, validateUrlShape } from "./url-guard";

export interface CrawledPage {
  url: string;
  finalUrl: string;
  kind: PageKind;
  status: number | null;
  content: PageContent | null;
  /** Firecrawl's clean main-content rendering (headings, lists, tables kept). */
  markdown: string | null;
  /** The page as delivered, kept so detectors can run again later without a new crawl. */
  rawHtml: string | null;
  bytes: number;
  ms: number;
  error: string | null;
  credits: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  notes: string[];
  durationMs: number;
  /** The homepage that actually worked (may differ from the URL on record). */
  home: CrawledPage | null;
  credits: number;
  /** Set when the crawl ended before its budget (credits exhausted, aborted). */
  stoppedEarly: string | null;
}

export interface CrawlDeps {
  scrape?: ScrapeFn;
  map?: MapFn;
  maxPages?: number;
  onProgress?: (m: string) => void;
  signal?: AbortSignal;
  /** Only follow links of these kinds after the homepage (the contact page for the email probe). */
  onlyKinds?: PageKind[];
  /** Continue an earlier crawl of the same site: its pages are kept and only the remaining key pages are fetched. */
  resume?: CrawlResult;
}

/** Raw HTML kept per page; beyond this the tail is dropped (detectors read the head and the text). */
export const MAX_STORED_HTML = 1_500_000;

const BOT_WALL_RE = /just a moment\.\.\.|checking your browser before accessing|attention required! \| cloudflare|cf-chl-|cf_chl_opt|sucuri website firewall|ddos-guard|verify you are human|enable javascript and cookies to continue|incapsula incident id|_incapsula_resource/i;

/** A challenge or firewall interstitial instead of the site. Recorded, never bypassed. */
export function looksLikeBotWall(html: string, status: number | null): boolean {
  const head = html.slice(0, 30_000);
  if (!BOT_WALL_RE.test(head)) return false;
  return status == null || status === 403 || status === 503 || status === 429 || status === 200;
}

function sameSite(a: URL, b: URL) {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
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

/** Turn a Firecrawl result into a crawled page: extraction, bot-wall detection, byte accounting. */
export function pageFromScrape(s: ScrapeResult, kind: PageKind): CrawledPage {
  const rawHtml = s.rawHtml ? s.rawHtml.slice(0, MAX_STORED_HTML) : null;
  const bytes = s.rawHtml?.length ?? s.markdown?.length ?? 0;
  if (rawHtml && looksLikeBotWall(rawHtml, s.statusCode)) {
    return { url: s.url, finalUrl: s.finalUrl, kind, status: s.statusCode, content: null, markdown: null, rawHtml: null, bytes, ms: s.ms, error: "Blocked by bot protection (challenge page; not bypassed)", credits: s.credits };
  }
  if (s.error || !rawHtml) {
    return { url: s.url, finalUrl: s.finalUrl, kind, status: s.statusCode, content: null, markdown: s.markdown, rawHtml, bytes, ms: s.ms, error: s.error ?? "Empty page", credits: s.credits };
  }
  return { url: s.url, finalUrl: s.finalUrl, kind, status: s.statusCode, content: extractPage(rawHtml, s.finalUrl), markdown: s.markdown, rawHtml, bytes, ms: s.ms, error: null, credits: s.credits };
}

/** Guard, robots, scrape. Target-site failures become an error page; credit exhaustion propagates. */
export async function fetchPage(url: string, kind: PageKind, notes: string[], deps: CrawlDeps): Promise<CrawledPage> {
  const started = Date.now();
  const fail = (error: string, status: number | null = null): CrawledPage => ({ url, finalUrl: url, kind, status, content: null, markdown: null, rawHtml: null, bytes: 0, ms: Date.now() - started, error, credits: 0 });
  try {
    validateUrlShape(url);
  } catch (err) {
    return fail(`Blocked: ${(err as Error).message}`);
  }
  if (!(await isAllowedByRobots(url))) {
    notes.push(`robots.txt disallows ${url}`);
    return fail("Disallowed by robots.txt");
  }
  try {
    const s = await (deps.scrape ?? scrapePage)(url, { signal: deps.signal });
    return pageFromScrape(s, kind);
  } catch (err) {
    if (err instanceof FirecrawlCreditsError || deps.signal?.aborted) throw err;
    if (err instanceof UrlBlockedError) return fail(`Blocked: ${err.message}`);
    return fail((err as Error).message.split("\n")[0]);
  }
}

/** Alternative homepage URLs worth trying when the recorded one fails at the connection level: www/bare variants. */
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

/** Run fetches with at most `limit` in flight per site; stops scheduling once `stop()` says so. */
async function mapLimit<T, R>(items: T[], limit: number, stop: () => boolean, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !stop()) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out.filter((r) => r !== undefined);
}

export async function crawlWebsite(website: string, deps: CrawlDeps = {}): Promise<CrawlResult> {
  const cfg = getConfig();
  const maxPages = deps.maxPages ?? cfg.RESEARCH_MAX_PAGES;
  const started = Date.now();
  const notes: string[] = [];
  const pages: CrawledPage[] = [];
  let credits = 0;
  let stoppedEarly: string | null = null;
  const add = (p: CrawledPage) => {
    pages.push(p);
    credits += p.credits;
    return p;
  };
  const done = () => ({ pages, notes, durationMs: Date.now() - started, home: pages.find((p) => p.kind === "home" && p.content) ?? null, credits, stoppedEarly });

  try {
    let home: CrawledPage;
    if (deps.resume?.home) {
      for (const p of deps.resume.pages) pages.push(p);
      credits = deps.resume.credits;
      notes.push(...deps.resume.notes.filter((n) => !n.startsWith("Firecrawl: ")));
      home = deps.resume.home;
    } else {
      deps.onProgress?.("Fetching homepage via Firecrawl");
      home = add(await fetchPage(website, "home", notes, deps));
      if (!home.content && !/robots\.txt|Blocked|bot protection/.test(home.error ?? "")) {
        let root: string | null = null;
        try {
          const u = new URL(website);
          if (u.pathname !== "/" || u.search) root = u.origin;
        } catch {
          /* ignore */
        }
        if (root && home.status && home.status >= 400 && home.status < 500) {
          // 1. Dead deep link → site root (one more credit).
          notes.push(`Deep link returned ${home.error}; retrying site root ${root}`);
          home = add(await fetchPage(root, "home", notes, deps));
        } else if (!home.status) {
          // 2. Connection-level failure (stale www/bare host): one variant.
          const variant = homepageVariants(website)[0];
          if (variant) {
            notes.push(`Homepage failed (${home.error}); trying ${variant}`);
            home = add(await fetchPage(variant, "home", notes, deps));
            if (home.content) notes.push(`Homepage reachable at ${home.finalUrl}`);
          }
        }
      }
    }
    if (!home.content) {
      notes.push(`Homepage unavailable: ${home.error}`);
      return done();
    }
    const homeContent = home.content;
    const base = new URL(home.finalUrl);
    const fetched = new Set(pages.flatMap((p) => [normalizeUrl(p.url), normalizeUrl(p.finalUrl)]));
    const budget = Math.max(0, maxPages - pages.filter((p) => p.content).length);
    // Candidate links in priority order; the probe keeps only the wanted kinds, a resumed crawl skips what it already has.
    const select = (all: { url: string; kind: PageKind }[]) => all.filter((p) => !fetched.has(normalizeUrl(p.url)) && (!deps.onlyKinds || deps.onlyKinds.includes(p.kind))).slice(0, budget);
    let picks = select(chooseLinks(homeContent, base, maxPages + 6));
    if (picks.length < 2 && maxPages > 2 && !deps.onlyKinds && budget > 0) {
      // 3. Script-rendered menus expose few links in HTML; Firecrawl's map (sitemap + index) lists the key pages. One credit.
      try {
        const m = await (deps.map ?? mapSite)(base.origin, { limit: 300, signal: deps.signal });
        credits += m.credits;
        notes.push(`Site map: ${m.links.length} URL(s) (${m.credits} credit)`);
        if (m.links.length) picks = select(chooseLinks({ ...homeContent, links: [...homeContent.links, ...m.links.map((l) => ({ href: l.url, text: l.title ?? "" }))] }, base, maxPages + 6));
      } catch (err) {
        if (err instanceof FirecrawlCreditsError) throw err;
        notes.push(`Site map failed: ${(err as Error).message.split("\n")[0]}`);
      }
    }
    if (picks.length) {
      deps.onProgress?.(`Fetching ${picks.length} key page(s) via Firecrawl`);
      const results = await mapLimit(picks, 2, () => stoppedEarly !== null || Boolean(deps.signal?.aborted), async (p) => {
        try {
          return await fetchPage(p.url, p.kind, notes, deps);
        } catch (err) {
          if (err instanceof FirecrawlCreditsError) {
            stoppedEarly = err.message;
            return null;
          }
          throw err;
        }
      });
      const seenText = new Set<string>(pages.filter((p) => p.content).map((p) => p.content!.text.slice(0, 2000)));
      for (const p of results) {
        if (!p) continue;
        const sig = p.content?.text.slice(0, 2000);
        if (sig && seenText.has(sig)) {
          notes.push(`Skipped duplicate content at ${p.url}`);
          credits += p.credits;
          continue;
        }
        if (sig) seenText.add(sig);
        add(p);
      }
      if (stoppedEarly) notes.push(`Crawl stopped early: ${stoppedEarly}`);
    }
    notes.push(`Firecrawl: ${pages.filter((p) => p.content).length} page(s) read, ${credits} credit(s)`);
    return done();
  } catch (err) {
    if (err instanceof FirecrawlCreditsError && pages.some((p) => p.content)) {
      stoppedEarly = err.message;
      notes.push(`Crawl stopped early: ${err.message}`);
      return done();
    }
    throw err;
  }
}

/** True when one of the pages publishes an email that belongs to the business (vendor and widget addresses do not count). */
export function pagesHaveBusinessEmail(pages: CrawledPage[], home: CrawledPage | null): boolean {
  let host: string | null = null;
  try {
    host = new URL(home?.finalUrl ?? pages[0]?.url ?? "").hostname;
  } catch {
    /* ignore */
  }
  const emails = pages.flatMap((p) => (p.content ? p.content.emails.map((e) => ({ e, url: p.url })) : []));
  return pickBusinessEmail(emails, host) !== null;
}

export interface StagedCrawlResult extends CrawlResult {
  /** The crawl stopped after the homepage and contact page because neither publishes a business email. */
  stoppedForEmail: boolean;
}

/**
 * The email probe: read the homepage and the contact page first (two credits).
 * When neither publishes a business email and `needEmail` is set, stop there:
 * the remaining pages and the model call would be spent on a business that
 * cannot be written to. Otherwise continue with the remaining key pages.
 */
export async function crawlStaged(website: string, deps: CrawlDeps & { needEmail: boolean }): Promise<StagedCrawlResult> {
  if (!deps.needEmail) return { ...(await crawlWebsite(website, deps)), stoppedForEmail: false };
  const probe = await crawlWebsite(website, { ...deps, maxPages: 2, onlyKinds: ["contact"] });
  if (!probe.home || probe.stoppedEarly) return { ...probe, stoppedForEmail: false };
  if (!pagesHaveBusinessEmail(probe.pages, probe.home)) {
    probe.notes.push(`No business email on the homepage${probe.pages.length > 1 ? " or the contact page" : ""}; research stopped after ${probe.credits} credit(s)`);
    return { ...probe, stoppedForEmail: true };
  }
  const full = await crawlWebsite(website, { ...deps, resume: probe });
  return { ...full, durationMs: probe.durationMs + full.durationMs, stoppedForEmail: false };
}
