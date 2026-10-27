/**
 * Bounded website crawl: homepage + a handful of high-value internal pages.
 * Same-site only, robots.txt respected, polite delay, per-page failures isolated.
 */
import { createHash } from "node:crypto";
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
  textHash: string | null;
}

export interface CrawlResult {
  pages: CrawledPage[];
  notes: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sameSite(a: URL, b: URL) {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}

export async function fetchOne(url: string, kind: PageKind, notes: string[]): Promise<CrawledPage> {
  try {
    if (!(await isAllowedByRobots(url))) {
      notes.push(`robots.txt disallows ${url}`);
      return { url, finalUrl: url, kind, status: null, content: null, bytes: 0, error: "Disallowed by robots.txt", textHash: null };
    }
    const res = await safeFetch(url);
    if (res.status >= 400) return { url, finalUrl: res.finalUrl, kind, status: res.status, content: null, bytes: res.bytes, error: `HTTP ${res.status}`, textHash: null };
    if (!res.body) return { url, finalUrl: res.finalUrl, kind, status: res.status, content: null, bytes: res.bytes, error: `Unsupported content type ${res.contentType ?? "unknown"}`, textHash: null };
    const content = extractPage(res.body, res.finalUrl);
    const textHash = createHash("sha1").update(content.text).digest("hex");
    return { url, finalUrl: res.finalUrl, kind, status: res.status, content, bytes: res.bytes, error: null, textHash };
  } catch (err) {
    const msg = err instanceof FetchBlockedError ? `Blocked: ${err.message}` : (err as Error).message;
    return { url, finalUrl: url, kind, status: null, content: null, bytes: 0, error: msg, textHash: null };
  }
}

export async function crawlWebsite(website: string, opts: { maxPages?: number; delayMs?: number; onProgress?: (m: string) => void } = {}): Promise<CrawlResult> {
  const cfg = getConfig();
  const maxPages = opts.maxPages ?? cfg.RESEARCH_MAX_PAGES;
  const delayMs = opts.delayMs ?? 600;
  const notes: string[] = [];
  const pages: CrawledPage[] = [];

  opts.onProgress?.("Fetching homepage");
  let home = await fetchOne(website, "home", notes);
  pages.push(home);
  if (!home.content) {
    // Directory data sometimes points at a deep link that no longer exists; try the site root.
    let root: string | null = null;
    try {
      const u = new URL(website);
      if (u.pathname !== "/" || u.search) root = u.origin;
    } catch {
      /* ignore */
    }
    if (root && home.status && home.status >= 400 && home.status < 500) {
      notes.push(`Deep link returned ${home.error}; retrying site root ${root}`);
      await sleep(delayMs);
      home = await fetchOne(root, "home", notes);
      pages.push(home);
    }
  }
  if (!home.content) {
    notes.push(`Homepage unavailable: ${home.error}`);
    return { pages, notes };
  }

  const base = new URL(home.finalUrl);
  const seen = new Set<string>([normalizeUrl(home.finalUrl), normalizeUrl(website)]);
  const candidates = new Map<string, { kind: PageKind; priority: number }>();
  for (const l of home.content.links) {
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    if (!sameSite(u, base)) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|webp|css|js)$/i.test(u.pathname)) continue;
    const key = normalizeUrl(u.toString());
    if (seen.has(key) || candidates.has(key)) continue;
    const kind = classifyLink(u.pathname + u.search, l.text);
    candidates.set(key, { kind, priority: KIND_PRIORITY[kind] * 100 + u.pathname.length });
  }
  // Round-robin across kinds so one busy section (e.g. many service pages) does not crowd out contact/booking/about.
  const byKind = new Map<PageKind, [string, { kind: PageKind; priority: number }][]>();
  for (const entry of [...candidates.entries()].filter(([, v]) => v.kind !== "other").sort((a, b) => a[1].priority - b[1].priority)) {
    const list = byKind.get(entry[1].kind) ?? [];
    list.push(entry);
    byKind.set(entry[1].kind, list);
  }
  const kindsInOrder = [...byKind.keys()].sort((a, b) => KIND_PRIORITY[a] - KIND_PRIORITY[b]);
  const ordered: [string, { kind: PageKind; priority: number }][] = [];
  const budget = Math.max(0, maxPages - 1);
  for (let round = 0; ordered.length < budget; round++) {
    let added = false;
    for (const k of kindsInOrder) {
      const e = byKind.get(k)?.[round];
      if (e && ordered.length < budget) {
        ordered.push(e);
        added = true;
      }
    }
    if (!added) break;
  }

  const seenHashes = new Set<string>(home.textHash ? [home.textHash] : []);
  for (const [url, meta] of ordered) {
    await sleep(delayMs);
    opts.onProgress?.(`Fetching ${meta.kind} page`);
    const p = await fetchOne(url, meta.kind, notes);
    if (p.textHash && seenHashes.has(p.textHash)) {
      notes.push(`Skipped duplicate content at ${url}`);
      continue;
    }
    if (p.textHash) seenHashes.add(p.textHash);
    pages.push(p);
  }
  return { pages, notes };
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
