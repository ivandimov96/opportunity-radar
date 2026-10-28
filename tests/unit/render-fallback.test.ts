import { describe, expect, it, vi, beforeEach } from "vitest";

const SHELL = `<html><head><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></head><body><div id="root"></div><noscript>Please enable JavaScript</noscript></body></html>`;
const RENDERED = `<html><body><main><h1>Spa Shop</h1><p>${"We fix cars and text you updates while we work. ".repeat(20)}</p><nav><a href="/services">Services</a></nav></main></body></html>`;

vi.mock("@/lib/research/fetcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/research/fetcher")>();
  return {
    ...orig,
    safeFetch: vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) return { url, finalUrl: url, status: 404, contentType: "text/plain", body: "", bytes: 0, truncated: false };
      if (url.includes("sitemap")) return { url, finalUrl: url, status: 404, contentType: "text/xml", body: "", bytes: 0, truncated: false };
      const body = url.includes("/services") ? "<html><body><main><p>Brakes, oil, diagnostics and tires for every make.</p></main></body></html>" : SHELL;
      return { url, finalUrl: url, status: 200, contentType: "text/html", body, bytes: body.length, truncated: false };
    }),
  };
});
const renderPage = vi.fn(async (url: string) => ({ html: RENDERED, finalUrl: url, ms: 300 }));
vi.mock("@/lib/research/render", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/research/render")>();
  return { ...orig, renderPage: (url: string) => renderPage(url) };
});

import { looksJsRendered } from "@/lib/research/render";
import { crawlWebsite } from "@/lib/research/crawler";
import { clearRobotsCache } from "@/lib/research/robots";
import { resetEnv } from "../helpers";

describe("browser-render fallback", () => {
  beforeEach(() => {
    resetEnv({ RESEARCH_BROWSER_RENDER: "true" });
    clearRobotsCache();
    renderPage.mockClear();
  });
  it("recognizes client-rendered shells and leaves real pages alone", () => {
    expect(looksJsRendered(SHELL, 20)).toBe(true);
    expect(looksJsRendered("<html><body><p>Hello</p></body></html>", 20)).toBe(false);
    expect(looksJsRendered(SHELL, 2000)).toBe(false);
  });
  it("renders a thin homepage in the browser, keeps the rendered text and marks the page", async () => {
    const r = await crawlWebsite("https://spa.example", { maxPages: 3 });
    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(r.home?.renderer).toBe("browser");
    expect(r.home?.content?.text).toContain("text you updates");
    expect(r.notes.some((n) => /Rendered https:\/\/spa\.example/.test(n))).toBe(true);
    const services = r.pages.find((p) => p.kind === "services");
    expect(services?.content?.text).toContain("Brakes");
  });
  it("does nothing when rendering is disabled", async () => {
    resetEnv({ RESEARCH_BROWSER_RENDER: "false" });
    const r = await crawlWebsite("https://spa.example", { maxPages: 2 });
    expect(renderPage).not.toHaveBeenCalled();
    expect(r.home?.renderer).toBe("static");
  });
});
