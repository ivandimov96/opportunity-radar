/**
 * Headless-browser fallback for JavaScript-only sites. Used only when the static
 * fetch of a homepage yields almost no text and the HTML is script-heavy. Bounded
 * (one page, 15 s), images/fonts/media blocked, same SSRF rules as the fetcher
 * (the URL was already validated and fetched statically before we get here).
 * Local hosts only: serverless hosts have no browser.
 */
import { getConfig } from "@/lib/config";
import { validateUrlShape } from "./fetcher";

export interface RenderResult {
  html: string;
  finalUrl: string;
  ms: number;
}

/** Does the static HTML look like a client-rendered shell? */
export function looksJsRendered(html: string, textChars: number): boolean {
  if (textChars >= 400) return false;
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  const hasRoot = /id=["'](root|app|__next|__nuxt|___gatsby|main)["']/i.test(html) || /<noscript>[^<]*(enable|turn on) javascript/i.test(html);
  return scripts >= 3 || hasRoot;
}

type Browser = import("playwright").Browser;
const g = globalThis as unknown as { __radarBrowser?: Promise<Browser> };

async function getBrowser(): Promise<Browser> {
  if (!g.__radarBrowser) {
    g.__radarBrowser = (async () => {
      const { chromium } = await import("playwright");
      const b = await chromium.launch({ headless: true });
      b.on("disconnected", () => {
        g.__radarBrowser = undefined;
      });
      return b;
    })();
    g.__radarBrowser.catch(() => {
      g.__radarBrowser = undefined;
    });
  }
  return g.__radarBrowser;
}

export async function renderPage(url: string, opts: { timeoutMs?: number } = {}): Promise<RenderResult> {
  if (!getConfig().browserRender.enabled) throw new Error("Browser rendering is disabled on this host");
  validateUrlShape(url);
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const started = Date.now();
  const browser = await getBrowser();
  // Certificates are not what we verify here (we read public text); some hosts and sandboxes intercept TLS.
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, userAgent: "OpportunityRadarBot/0.1 (+https://github.com/opportunity-radar; respectful research crawler)", javaScriptEnabled: true, viewport: { width: 1280, height: 900 } });
  try {
    await ctx.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font", "stylesheet"].includes(type)) return route.abort();
      const target = route.request().url();
      try {
        validateUrlShape(target);
      } catch {
        return route.abort();
      }
      return route.continue();
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(5_000, timeoutMs) }).catch(() => {});
    const html = await page.content();
    return { html, finalUrl: page.url(), ms: Date.now() - started };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function closeBrowser() {
  const b = await g.__radarBrowser?.catch(() => null);
  g.__radarBrowser = undefined;
  await b?.close().catch(() => {});
}
