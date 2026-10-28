/**
 * Firecrawl client (REST v2 over fetch). This is the only way page content
 * enters the system. One module owns:
 *  - configuration (API key and base URL from the environment, never hardcoded)
 *  - a process-wide limiter matched to the plan: concurrent requests and
 *    requests per minute (the free plan allows 2 and 10)
 *  - bounded retries with backoff on 429/408/5xx, honoring Retry-After
 *  - explicit errors: no key, exhausted credits, rejected key
 *  - credit accounting: 1 credit per scraped page (charged even when the target
 *    site answers 4xx), 1 per map call, nothing when Firecrawl itself fails
 * Every URL is guarded (public hosts only) before it is sent.
 */
import { getConfig } from "@/lib/config";
import { assertPublicUrl } from "./url-guard";

export class FirecrawlError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public retryable: boolean,
  ) {
    super(message);
    this.name = "FirecrawlError";
  }
}
export class FirecrawlUnavailableError extends Error {
  constructor(message = "Website research needs FIRECRAWL_API_KEY (firecrawl.dev; the free plan includes 1,000 credits a month). Set it in .env and restart.") {
    super(message);
    this.name = "FirecrawlUnavailableError";
  }
}
export class FirecrawlCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirecrawlCreditsError";
  }
}

export interface ScrapeResult {
  url: string;
  finalUrl: string;
  statusCode: number | null;
  markdown: string | null;
  rawHtml: string | null;
  links: string[];
  title: string | null;
  description: string | null;
  /** Why no usable content came back (target error, empty page, Firecrawl-reported failure). */
  error: string | null;
  /** Credits this call cost (1 when a page was fetched, 0 otherwise). */
  credits: number;
  ms: number;
}
export interface ScrapeOptions {
  signal?: AbortSignal;
  /** Firecrawl may answer from its cache when it holds a copy younger than this. */
  maxAgeMs?: number;
  timeoutMs?: number;
  onlyMainContent?: boolean;
}
export type ScrapeFn = (url: string, opts?: ScrapeOptions) => Promise<ScrapeResult>;
export type MapFn = (url: string, opts?: { limit?: number; search?: string; signal?: AbortSignal }) => Promise<{ links: { url: string; title: string | null }[]; credits: number }>;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike | null = null;
let backoffBaseMs = 1000;

/** Test hooks: replace the transport, shorten backoff, reset the limiter. */
export function _setFirecrawlFetch(fn: FetchLike | null) {
  fetchImpl = fn;
}
export function _setFirecrawlBackoff(ms: number) {
  backoffBaseMs = ms;
}
export function _resetFirecrawlLimiter() {
  limiter.active = 0;
  limiter.waiters = [];
  limiter.stamps = [];
  usageCache = null;
}

export function isFirecrawlConfigured(): boolean {
  return getConfig().firecrawl.enabled;
}

// ------------------------------------------------------------------ limiter
const limiter = { active: 0, waiters: [] as (() => void)[], stamps: [] as number[] };

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function acquire(signal?: AbortSignal) {
  const cfg = getConfig();
  for (;;) {
    signal?.throwIfAborted();
    if (limiter.active < cfg.FIRECRAWL_CONCURRENCY) {
      const now = Date.now();
      limiter.stamps = limiter.stamps.filter((t) => now - t < 60_000);
      if (limiter.stamps.length < cfg.FIRECRAWL_RPM) {
        limiter.stamps.push(now);
        limiter.active++;
        return;
      }
      await sleep(60_000 - (now - limiter.stamps[0]) + 25, signal);
      continue;
    }
    await new Promise<void>((resolve) => limiter.waiters.push(resolve));
  }
}

function release() {
  limiter.active = Math.max(0, limiter.active - 1);
  limiter.waiters.shift()?.();
}

/** How many Firecrawl requests are in flight right now (System page). */
export function firecrawlInFlight() {
  return limiter.active;
}

// ------------------------------------------------------------------ transport
function errorMessage(text: string, status: number) {
  try {
    const j = JSON.parse(text) as { error?: string; code?: string; details?: unknown };
    return [j.code, j.error].filter(Boolean).join(" ") || `HTTP ${status}`;
  } catch {
    return text.slice(0, 200) || `HTTP ${status}`;
  }
}

async function request<T>(path: string, body: unknown, opts: { signal?: AbortSignal; timeoutMs: number; method?: "POST" | "GET" }): Promise<T> {
  const cfg = getConfig();
  if (!cfg.firecrawl.enabled) throw new FirecrawlUnavailableError();
  const f = fetchImpl ?? ((input, init) => fetch(input, init));
  const method = opts.method ?? "POST";
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    await acquire(opts.signal);
    let res: Response;
    try {
      const signal = opts.signal ? AbortSignal.any([AbortSignal.timeout(opts.timeoutMs + 10_000), opts.signal]) : AbortSignal.timeout(opts.timeoutMs + 10_000);
      res = await f(`${cfg.FIRECRAWL_API_URL.replace(/\/$/, "")}${path}`, {
        method,
        headers: { Authorization: `Bearer ${cfg.FIRECRAWL_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
        body: method === "POST" ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      release();
      if (opts.signal?.aborted) throw err;
      if (attempt < maxAttempts) {
        await sleep(backoffBaseMs * 2 ** (attempt - 1), opts.signal);
        continue;
      }
      throw new FirecrawlError(`Firecrawl request failed: ${(err as Error).message}`, null, true);
    }
    release();
    if (res.ok) return (await res.json()) as T;
    const text = await res.text().catch(() => "");
    const msg = errorMessage(text, res.status);
    if (res.status === 402) throw new FirecrawlCreditsError(`Firecrawl credits exhausted (${msg}). Wait for the monthly renewal or upgrade the plan.`);
    if (res.status === 401) throw new FirecrawlError(`Firecrawl rejected the API key: ${msg}`, 401, false);
    const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : backoffBaseMs * 2 ** (attempt - 1), opts.signal);
      continue;
    }
    throw new FirecrawlError(`Firecrawl HTTP ${res.status}: ${msg}`, res.status, retryable);
  }
}

// ------------------------------------------------------------------ scrape
interface ScrapeResponse {
  success: boolean;
  error?: string;
  data?: {
    markdown?: string;
    rawHtml?: string;
    links?: unknown[];
    metadata?: { title?: string; description?: string; sourceURL?: string; url?: string; statusCode?: number; error?: string | null };
  };
}

/** One page, one credit. Never throws for a failing target site; throws for Firecrawl-level failures. */
export const scrapePage: ScrapeFn = async (url, opts = {}) => {
  const cfg = getConfig();
  const started = Date.now();
  await assertPublicUrl(url);
  const timeoutMs = opts.timeoutMs ?? cfg.FIRECRAWL_TIMEOUT_MS;
  const body = {
    url,
    formats: ["markdown", "rawHtml", "links"],
    onlyMainContent: opts.onlyMainContent ?? true,
    maxAge: opts.maxAgeMs ?? cfg.RESEARCH_STALE_DAYS * 86_400_000,
    timeout: Math.min(Math.max(timeoutMs, 1000), 300_000),
    blockAds: true,
    removeBase64Images: true,
    storeInCache: true,
  };
  const r = await request<ScrapeResponse>("/v2/scrape", body, { signal: opts.signal, timeoutMs });
  const d = r.data ?? {};
  const meta = d.metadata ?? {};
  const statusCode = typeof meta.statusCode === "number" ? meta.statusCode : null;
  const finalUrl = meta.url || meta.sourceURL || url;
  const markdown = typeof d.markdown === "string" ? d.markdown : null;
  const rawHtml = typeof d.rawHtml === "string" ? d.rawHtml : null;
  const fetched = Boolean(rawHtml || markdown) || statusCode != null;
  const error = !r.success ? r.error || "Firecrawl reported a failure" : statusCode != null && statusCode >= 400 ? `HTTP ${statusCode}` : meta.error || (!rawHtml && !markdown ? "Empty response" : null);
  return {
    url,
    finalUrl,
    statusCode,
    markdown,
    rawHtml,
    links: (d.links ?? []).filter((l): l is string => typeof l === "string"),
    title: meta.title ?? null,
    description: meta.description ?? null,
    error,
    credits: fetched ? 1 : 0,
    ms: Date.now() - started,
  };
};

// ------------------------------------------------------------------ map
/** Site URL discovery (sitemap plus Firecrawl's own index), one credit per call. */
export const mapSite: MapFn = async (url, opts = {}) => {
  await assertPublicUrl(url);
  const r = await request<{ success: boolean; links?: ({ url: string; title?: string } | string)[] }>(
    "/v2/map",
    { url, limit: opts.limit ?? 300, sitemap: "include", includeSubdomains: false, ignoreQueryParameters: true, timeout: 30_000, ...(opts.search ? { search: opts.search } : {}) },
    { signal: opts.signal, timeoutMs: 30_000 },
  );
  const links = (r.links ?? []).map((l) => (typeof l === "string" ? { url: l, title: null } : { url: l.url, title: l.title ?? null })).filter((l) => typeof l.url === "string");
  return { links, credits: 1 };
};

// ------------------------------------------------------------------ account
export interface CreditUsage {
  remainingCredits: number;
  planCredits: number | null;
  billingPeriodEnd: string | null;
  fetchedAt: string;
}
let usageCache: { at: number; value: CreditUsage | null } | null = null;

/** Remaining credits from the Firecrawl account, cached 5 minutes; null when unavailable. Never throws. */
export async function creditUsage(): Promise<CreditUsage | null> {
  if (!isFirecrawlConfigured()) return null;
  if (usageCache && Date.now() - usageCache.at < 5 * 60_000) return usageCache.value;
  try {
    const r = await request<{ success: boolean; data?: { remainingCredits?: number; planCredits?: number; billingPeriodEnd?: string | null } }>("/v2/team/credit-usage", undefined, { method: "GET", timeoutMs: 10_000 });
    const value = r.data && typeof r.data.remainingCredits === "number" ? { remainingCredits: r.data.remainingCredits, planCredits: r.data.planCredits ?? null, billingPeriodEnd: r.data.billingPeriodEnd ?? null, fetchedAt: new Date().toISOString() } : null;
    usageCache = { at: Date.now(), value };
    return value;
  } catch {
    usageCache = { at: Date.now(), value: null };
    return null;
  }
}
