import { beforeEach, describe, expect, it } from "vitest";
import { resetEnv } from "../helpers";
import { extractPage, latestYearIn } from "@/lib/research/html";
import { detectFacts, pickBusinessEmail } from "@/lib/research/detect";
import { chooseLinks, crawlWebsite, homepageVariants, looksLikeBotWall } from "@/lib/research/crawl";
import { _setRobotsFetch } from "@/lib/research/robots";
import { FirecrawlCreditsError, FirecrawlError, type ScrapeFn, type ScrapeResult } from "@/lib/research/firecrawl";

const SITE = `<html><head><title>Dagi Auto</title><meta name="viewport" content="width=device-width"><meta name="generator" content="WordPress 6.5">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"AutoRepair","name":"Dagi Auto and Body Shop","telephone":"(832) 466-8438","email":"hello@dagiauto.example","address":{"@type":"PostalAddress","streetAddress":"15101 FM 1825","addressLocality":"Pflugerville","addressRegion":"TX","postalCode":"78660"},"openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Friday"],"opens":"08:00","closes":"17:00"}],"sameAs":["https://www.facebook.com/dagiauto"],"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"120"}}</script>
</head><body>
<header><nav><a href="/services">Services</a><a href="/contact">Contact</a><a href="/fleet">Fleet</a></nav></header>
<main><h1>Dagi Auto</h1><p>Family owned since 1998. Walk-ins welcome. We text you updates while we work on your car. Fleet accounts available for local businesses. Free estimates on all collision work.</p>
<p>Powered by AutoWatch · support@autowatch.com</p></main>
<footer>© 2019 Dagi Auto · <a href="mailto:office@dagiauto.example">Email</a></footer>
</body></html>`;

describe("extractPage v3", () => {
  const p = extractPage(SITE, "https://dagiauto.example/");
  it("parses schema.org JSON-LD for a local business", () => {
    expect(p.jsonLd).toHaveLength(1);
    expect(p.jsonLd[0]).toMatchObject({ type: "AutoRepair", address: "15101 FM 1825, Pflugerville, TX, 78660", openingHours: "Mon,Fri 08:00-17:00", ratingValue: 4.8, reviewCount: 120 });
    expect(p.phones).toContain("8324668438");
    expect(p.emails).toContain("hello@dagiauto.example");
  });
  it("takes text from the main content, not the navigation, and keeps nav links", () => {
    expect(p.text).toContain("Walk-ins welcome");
    expect(p.text).not.toMatch(/^Services Contact/);
    expect(p.links.map((l) => l.href)).toContain("https://dagiauto.example/fleet");
  });
  it("reads generator, viewport and the latest copyright year", () => {
    expect(p.generator).toBe("WordPress 6.5");
    expect(p.hasViewport).toBe(true);
    expect(p.latestYear).toBe(2019);
    expect(latestYearIn("Copyright 2015 - 2024 Foo", "")).toBe(2024);
    expect(latestYearIn("no years", '<time datetime="2022-01-05">')).toBe(2022);
    expect(latestYearIn("Phone 2048 Main", "")).toBeNull();
  });
  it("separates element text so emails next to phone numbers survive, keeps mailto addresses, and strips a phone glued inside one text node", () => {
    const html = `<html><body><main><p>Call (512) 312-2177<span>8006buda@greatwatergarages.com</span></p><div>Austin</div><div>TX</div><a href="mailto:Service@Shop.example">Email</a><p>Tel 512-2177info@shop.example</p><p>Great<b>Water</b> hello@shop.example</p></main></body></html>`;
    const c = extractPage(html, "https://shop.example/");
    expect(c.emails).toEqual(["service@shop.example", "8006buda@greatwatergarages.com", "info@shop.example", "hello@shop.example"]);
    expect(c.text).toMatch(/312-2177 8006buda@greatwatergarages\.com/);
    expect(c.text).toMatch(/Austin\s+TX/);
    expect(c.text).toMatch(/GreatWater hello/); // inline formatting does not split a word
  });

  it("falls back to the full body text when the page is mostly chrome", () => {
    const q = extractPage("<html><body><nav>Home About</nav><div>Tiny</div></body></html>", "https://x.example/");
    expect(q.text).toContain("Home About");
  });
});

describe("detectFacts v3", () => {
  const p = extractPage(SITE, "https://dagiauto.example/");
  const facts = detectFacts([{ content: p, url: "https://dagiauto.example/", kind: "home" }], { finalUrl: "https://dagiauto.example/", bytes: 50_000, ms: 800 });
  const by = Object.fromEntries(facts.map((f) => [f.key, f]));
  it("prefers the business's own email over vendor addresses", () => {
    expect(by.email.value).toMatch(/@dagiauto\.example$/);
    expect(pickBusinessEmail([{ e: "support@autowatch.com", url: "u" }], "x.example")).toBeNull();
    expect(pickBusinessEmail([{ e: "a@gmail.com", url: "u" }, { e: "info@x.example", url: "u" }], "www.x.example")?.e).toBe("info@x.example");
  });
  it("turns structured data into verified address, hours and reviews facts", () => {
    expect(by.address).toMatchObject({ status: "verified", value: "15101 FM 1825, Pflugerville, TX, 78660" });
    expect(by.hours.status).toBe("verified");
    expect(by.reviews_on_site).toMatchObject({ status: "verified", value: "yes" });
    expect(by.social_profiles.value).toContain("facebook.com/dagiauto");
  });
  it("detects text cues with sentence evidence and the shop system from the vendor host", () => {
    expect(by.customer_updates).toMatchObject({ status: "verified", value: "text/SMS updates" });
    expect(by.customer_updates.evidenceQuote).toContain("text you updates");
    expect(by.fleet_program.status).toBe("verified");
    expect(by.estimate_policy).toMatchObject({ value: "free_estimates" });
    expect(by.years_in_business.value).toMatch(/since 1998/i);
    expect(by.booking_method).toMatchObject({ value: "walk_in" });
    expect(by.website_platform.value).toBe("WordPress");
  });
  it("records measured health, freshness and explicit gaps", () => {
    expect(by.website_health.value).toBe("HTTPS; mobile viewport; homepage 49 KB in 0.8 s");
    expect(by.website_updated.value).toBe("2019");
    expect(by.booking_tool.status).toBe("not_found");
    expect(by.maintenance_plans.status).toBe("not_found");
    expect(by.multi_location.status).toBe("not_found");
  });
  it("flags multi-location sites", () => {
    const q = extractPage("<html><body><main><p>Find a location near you. We have 12 convenient locations across Texas.</p></main></body></html>", "https://chain.example/");
    const f = detectFacts([{ content: q, url: "https://chain.example/", kind: "home" }]);
    expect(f.find((x) => x.key === "multi_location")).toMatchObject({ status: "verified", value: "yes" });
  });
});

describe("crawler helpers", () => {
  it("builds scheme/www variants without repeating the given URL", () => {
    expect(homepageVariants("http://dagiauto.example")).toEqual(["https://dagiauto.example", "https://www.dagiauto.example", "http://www.dagiauto.example"]);
    expect(homepageVariants("https://www.x.example/")).toEqual(["https://x.example", "http://www.x.example", "http://x.example"]);
  });
  it("chooses one page per kind before a second of any kind", () => {
    const p = extractPage(SITE, "https://dagiauto.example/");
    const picks = chooseLinks({ ...p, links: [...p.links, { href: "https://dagiauto.example/services/brakes", text: "Brakes" }] }, new URL("https://dagiauto.example/"), 4);
    expect(picks.map((x) => x.kind)).toEqual(["services", "contact", "fleet", "services"]);
  });
});

describe("crawl via Firecrawl", () => {
  const PAGES: Record<string, string> = {
    "https://dagiauto.example": SITE,
    "https://dagiauto.example/services": "<html><head><title>Services</title></head><body><main><p>Brakes, oil changes and diagnostics with a 24 month / 24,000 mile warranty.</p></main></body></html>",
    "https://dagiauto.example/contact": "<html><head><title>Contact</title></head><body><main><p>Mon - Fri: 8am - 6pm. 15101 FM 1825, Pflugerville.</p></main></body></html>",
    "https://dagiauto.example/fleet": "<html><head><title>Fleet</title></head><body><main><p>Fleet accounts for local businesses, net-30 billing.</p></main></body></html>",
    "https://thin.example": "<html><head><title>Thin</title></head><body><div id=\"root\"></div><script src=\"/app.js\"></script></body></html>",
    "https://thin.example/services": "<html><body><main><p>Services page found through the site map: brakes and tires.</p></main></body></html>",
    "https://walled.example": "<html><head><title>Just a moment...</title></head><body><p>Checking your browser before accessing walled.example. cf-chl-bypass</p></body></html>",
  };
  const calls: string[] = [];
  const result = (url: string, over: Partial<ScrapeResult> = {}): ScrapeResult => ({ url, finalUrl: url, statusCode: 200, markdown: null, rawHtml: null, links: [], title: null, description: null, error: null, credits: 1, ms: 1, ...over });
  const scrape: ScrapeFn = async (url) => {
    calls.push(url);
    const key = url.replace(/\/$/, "");
    if (key === "https://walled.example") return result(url, { statusCode: 403, rawHtml: PAGES[key] });
    const html = PAGES[key];
    if (!html) return result(url, { statusCode: 404, error: "HTTP 404" });
    return result(url, { rawHtml: html });
  };
  beforeEach(() => {
    resetEnv({ RESEARCH_MAX_PAGES: "4" });
    _setRobotsFetch(async () => ({ ok: false, text: async () => "" }));
    calls.length = 0;
  });

  it("reads the homepage, then one page per kind within the budget; every page is a credit", async () => {
    const c = await crawlWebsite("https://dagiauto.example", { scrape });
    expect(c.home?.content?.title).toBe("Dagi Auto");
    expect(c.pages.map((p) => p.kind)).toEqual(["home", "services", "contact", "fleet"]);
    expect(c.pages.every((p) => p.content && p.rawHtml && p.credits === 1)).toBe(true);
    expect(c.credits).toBe(4);
    expect(c.stoppedEarly).toBeNull();
    expect(c.notes.at(-1)).toBe("Firecrawl: 4 page(s) read, 4 credit(s)");
  });

  it("falls back from a dead deep link to the site root and counts the failed page's credit", async () => {
    const c = await crawlWebsite("https://dagiauto.example/old-page", { scrape, maxPages: 2 });
    expect(calls.slice(0, 2)).toEqual(["https://dagiauto.example/old-page", "https://dagiauto.example"]);
    expect(c.home?.finalUrl).toBe("https://dagiauto.example");
    expect(c.pages[0]).toMatchObject({ error: "HTTP 404", credits: 1 });
    expect(c.credits).toBe(3);
    expect(c.notes.join("\n")).toContain("retrying site root");
  });

  it("uses Firecrawl's site map (one credit) only when the homepage exposes almost no links", async () => {
    const mapCalls: string[] = [];
    const map = async (url: string) => {
      mapCalls.push(url);
      return { links: [{ url: "https://thin.example/services", title: "Services" }, { url: "https://thin.example/blog/post-1", title: null }], credits: 1 };
    };
    const c = await crawlWebsite("https://thin.example", { scrape, map });
    expect(mapCalls).toEqual(["https://thin.example"]);
    expect(c.pages.map((p) => p.kind)).toEqual(["home", "services"]);
    expect(c.credits).toBe(3); // home + map + services
    expect(c.notes.join("\n")).toContain("Site map: 2 URL(s) (1 credit)");
    const full = await crawlWebsite("https://dagiauto.example", { scrape, map });
    expect(mapCalls).toHaveLength(1); // rich homepage: no map call
    expect(full.credits).toBe(4);
  });

  it("records a bot-protection interstitial as blocked instead of reading it as content", async () => {
    expect(looksLikeBotWall(PAGES["https://walled.example"], 403)).toBe(true);
    expect(looksLikeBotWall(SITE, 200)).toBe(false);
    const c = await crawlWebsite("https://walled.example", { scrape });
    expect(c.home).toBeNull();
    expect(c.pages[0].error).toMatch(/bot protection/);
    expect(c.pages[0].content).toBeNull();
    expect(c.credits).toBe(1);
    expect(calls).toHaveLength(1); // no root/variant retries on a wall
  });

  it("isolates a Firecrawl-level failure on one page and charges nothing for it", async () => {
    const flaky: ScrapeFn = async (url, o) => {
      if (url.endsWith("/contact")) throw new FirecrawlError("Firecrawl HTTP 500: unable to fetch", 500, true);
      return scrape(url, o);
    };
    const c = await crawlWebsite("https://dagiauto.example", { scrape: flaky });
    const contact = c.pages.find((p) => p.kind === "contact")!;
    expect(contact).toMatchObject({ content: null, credits: 0 });
    expect(contact.error).toContain("unable to fetch");
    expect(c.pages.filter((p) => p.content)).toHaveLength(3);
    expect(c.credits).toBe(3);
  });

  it("stops when credits run out and keeps what was read; a broke homepage fails outright", async () => {
    let n = 0;
    const broke: ScrapeFn = async (url, o) => {
      if (++n > 2) throw new FirecrawlCreditsError("Firecrawl credits exhausted");
      return scrape(url, o);
    };
    const c = await crawlWebsite("https://dagiauto.example", { scrape: broke });
    expect(c.pages.filter((p) => p.content).length).toBeGreaterThanOrEqual(2);
    expect(c.stoppedEarly).toMatch(/credits exhausted/);
    expect(c.notes.join("\n")).toContain("Crawl stopped early");
    n = 10;
    await expect(crawlWebsite("https://dagiauto.example", { scrape: broke })).rejects.toBeInstanceOf(FirecrawlCreditsError);
  });

  it("respects robots.txt before spending a credit", async () => {
    _setRobotsFetch(async () => ({ ok: true, text: async () => "User-agent: *\nDisallow: /fleet" }));
    const c = await crawlWebsite("https://dagiauto.example", { scrape });
    expect(c.pages.find((p) => p.kind === "fleet")?.error).toBe("Disallowed by robots.txt");
    expect(calls).not.toContain("https://dagiauto.example/fleet");
    expect(c.credits).toBe(3);
  });
});

describe("email stored on the business after an investigation", () => {
  it("prefers the email verified by this run unless the stored one is on the business's own domain, and never keeps vendor addresses", async () => {
    const { pickEmail } = await import("@/lib/jobs/handlers");
    const site = "austinautomotivespecialists.com";
    // Stale value from an older run (a glued phone prefix) is replaced by the verified address of this run.
    expect(pickEmail("312-21778006buda@greatwatergarages.com", "8006buda@greatwatergarages.com", site)).toBe("8006buda@greatwatergarages.com");
    // Nothing stored: take the verified one.
    expect(pickEmail(null, "info@greatwatergarages.com", site)).toBe("info@greatwatergarages.com");
    // Stored address on the business's own domain outranks a verified off-domain one…
    expect(pickEmail(`service@${site}`, "8006buda@greatwatergarages.com", site)).toBe(`service@${site}`);
    // …but an own-domain verified address always wins.
    expect(pickEmail("old@gmail.example", `service@${site}`, site)).toBe(`service@${site}`);
    // Vendor/widget addresses are dropped, verified or stored.
    expect(pickEmail("noreply@wixpress.com", null, site)).toBeNull();
    expect(pickEmail("owner@shop.example", "noreply@wixpress.com", site)).toBe("owner@shop.example");
    // No verified email this run: keep what was stored.
    expect(pickEmail("owner@shop.example", null, site)).toBe("owner@shop.example");
  });
});
