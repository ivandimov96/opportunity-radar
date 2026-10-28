/**
 * Firecrawl client against an injected transport: result mapping, credit
 * accounting, retries (429 with Retry-After, 5xx), explicit errors (no key,
 * exhausted credits, rejected key), and the process-wide limiter.
 * Public IP literals are used as URLs so the guard needs no DNS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnv } from "../helpers";
import { _resetFirecrawlLimiter, _setFirecrawlBackoff, _setFirecrawlFetch, creditUsage, FirecrawlCreditsError, FirecrawlError, FirecrawlUnavailableError, mapSite, scrapePage } from "@/lib/research/firecrawl";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ok = (over: Record<string, unknown> = {}) => ({
  success: true,
  data: { markdown: "# Hi", rawHtml: "<html><body><p>Hi</p></body></html>", links: ["https://1.1.1.1/about", 42], metadata: { title: "X", description: "d", sourceURL: "https://1.1.1.1/", url: "https://1.1.1.1/", statusCode: 200, ...over } },
});

describe("firecrawl client", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  beforeEach(() => {
    resetEnv({ FIRECRAWL_API_KEY: "k-test", FIRECRAWL_CONCURRENCY: "2", FIRECRAWL_RPM: "100" });
    _resetFirecrawlLimiter();
    _setFirecrawlBackoff(0);
    calls.length = 0;
  });
  afterEach(() => {
    _setFirecrawlFetch(null);
    vi.useRealTimers();
  });
  const transport = (responses: (() => Response)[]) =>
    _setFirecrawlFetch(async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      return next();
    });

  it("maps a scrape to content, links, metadata and one credit; sends the key and the formats", async () => {
    transport([() => json(200, ok())]);
    const r = await scrapePage("https://1.1.1.1/");
    expect(r).toMatchObject({ finalUrl: "https://1.1.1.1/", statusCode: 200, markdown: "# Hi", title: "X", error: null, credits: 1 });
    expect(r.rawHtml).toContain("<p>Hi</p>");
    expect(r.links).toEqual(["https://1.1.1.1/about"]); // non-strings dropped
    expect(calls[0].url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer k-test");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.formats).toEqual(["markdown", "rawHtml", "links"]);
    expect(body.onlyMainContent).toBe(true);
    expect(body.maxAge).toBeGreaterThan(0);
  });

  it("a target page that answers 4xx is an error page that still cost a credit", async () => {
    transport([() => json(200, ok({ statusCode: 404 }))]);
    const r = await scrapePage("https://1.1.1.1/missing");
    expect(r.error).toBe("HTTP 404");
    expect(r.credits).toBe(1);
  });

  it("retries 429 honoring Retry-After and 5xx with backoff, then succeeds", async () => {
    transport([() => json(429, { success: false, error: "Rate limit exceeded" }, { "retry-after": "0" }), () => json(503, { success: false, error: "overloaded" }), () => json(200, ok())]);
    const r = await scrapePage("https://1.1.1.1/");
    expect(r.error).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it("gives up after bounded retries with a retryable error", async () => {
    transport([() => json(500, { success: false, error: "x" }), () => json(500, { success: false, error: "x" }), () => json(500, { success: false, error: "x" }), () => json(500, { success: false, error: "x" })]);
    await expect(scrapePage("https://1.1.1.1/")).rejects.toMatchObject({ name: "FirecrawlError", status: 500, retryable: true });
    expect(calls).toHaveLength(4);
  });

  it("exhausted credits and a rejected key are final, not retried", async () => {
    transport([() => json(402, { success: false, error: "Insufficient credits" })]);
    await expect(scrapePage("https://1.1.1.1/")).rejects.toBeInstanceOf(FirecrawlCreditsError);
    expect(calls).toHaveLength(1);
    transport([() => json(401, { success: false, error: "Unauthorized: Invalid token" })]);
    const err = await scrapePage("https://1.1.1.1/").catch((e) => e);
    expect(err).toBeInstanceOf(FirecrawlError);
    expect(err.retryable).toBe(false);
  });

  it("refuses to run without a key and never calls the network", async () => {
    resetEnv({});
    _resetFirecrawlLimiter();
    transport([() => json(200, ok())]);
    await expect(scrapePage("https://1.1.1.1/")).rejects.toBeInstanceOf(FirecrawlUnavailableError);
    expect(calls).toHaveLength(0);
  });

  it("blocks private and malformed URLs before any request", async () => {
    transport([() => json(200, ok())]);
    await expect(scrapePage("http://10.0.0.5/")).rejects.toMatchObject({ name: "UrlBlockedError" });
    await expect(scrapePage("ftp://1.1.1.1/")).rejects.toMatchObject({ name: "UrlBlockedError" });
    expect(calls).toHaveLength(0);
  });

  it("keeps at most FIRECRAWL_CONCURRENCY requests in flight", async () => {
    let active = 0;
    let peak = 0;
    _setFirecrawlFetch(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return json(200, ok());
    });
    await Promise.all(Array.from({ length: 6 }, () => scrapePage("https://1.1.1.1/")));
    expect(peak).toBe(2);
  });

  it("spaces requests to FIRECRAWL_RPM per minute", async () => {
    resetEnv({ FIRECRAWL_API_KEY: "k", FIRECRAWL_CONCURRENCY: "5", FIRECRAWL_RPM: "2" });
    _resetFirecrawlLimiter();
    vi.useFakeTimers();
    transport([() => json(200, ok()), () => json(200, ok()), () => json(200, ok())]);
    const all = Promise.all([scrapePage("https://1.1.1.1/"), scrapePage("https://1.1.1.1/a"), scrapePage("https://1.1.1.1/b")]);
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(61_000);
    await all;
    expect(calls).toHaveLength(3);
  });

  it("maps a site for one credit and reads remaining credits from the account", async () => {
    transport([() => json(200, { success: true, links: [{ url: "https://1.1.1.1/services", title: "Services" }, "https://1.1.1.1/contact"] }), () => json(200, { success: true, data: { remainingCredits: 850, planCredits: 1000, billingPeriodEnd: "2026-11-01T00:00:00Z" } })]);
    const m = await mapSite("https://1.1.1.1/");
    expect(m.credits).toBe(1);
    expect(m.links).toEqual([{ url: "https://1.1.1.1/services", title: "Services" }, { url: "https://1.1.1.1/contact", title: null }]);
    expect(JSON.parse(String(calls[0].init.body)).sitemap).toBe("include");
    const u = await creditUsage();
    expect(u).toMatchObject({ remainingCredits: 850, planCredits: 1000 });
    expect(calls[1].init.method).toBe("GET");
    expect(await creditUsage()).toEqual(u); // cached, no extra call
    expect(calls).toHaveLength(2);
  });
});
