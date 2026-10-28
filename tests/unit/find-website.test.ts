import { describe, expect, it } from "vitest";
import { domainFromEmail, findWebsite, guessDomains, nameTokens, streetMatches, verifyCandidate } from "@/lib/discovery/find-website";
import { FirecrawlCreditsError, type ScrapeFn, type ScrapeResult } from "@/lib/research/firecrawl";

const pages: Record<string, string> = {
  "https://longhornautomotive.example/": "<html><head><title>Longhorn Automotive | Austin TX</title></head><body><main><p>Longhorn Automotive, Austin, TX. Call <a href='tel:512-669-2833'>512-669-2833</a></p></main></body></html>",
  "https://longhornauto.com/": "<html><head><title>Longhorn Auto</title></head><body><main><p>Longhorn Automotive of Billings, Montana.</p></main></body></html>",
  "https://www.yelp.com/biz/longhorn": "<html><body>Yelp</body></html>",
  "https://longhornautomotive.com/": "<html><head><title>Longhorn Automotive</title></head><body><main><p>Longhorn Automotive, Austin TX. Call 512-669-2833.</p></main></body></html>",
};
const calls: string[] = [];
const scrape: ScrapeFn = async (url) => {
  calls.push(url);
  const base: ScrapeResult = { url, finalUrl: url, statusCode: 200, markdown: null, rawHtml: null, links: [], title: null, description: null, error: null, credits: 1, ms: 1 };
  const body = pages[url];
  if (!body) return { ...base, statusCode: 404, error: "HTTP 404" };
  return { ...base, rawHtml: body };
};
const noDns = async () => {
  throw new Error("ENOTFOUND");
};
const biz = { name: "Longhorn Automotive", city: "Austin", region: "TX", phone: "5126692833" };

describe("website finder", () => {
  it("builds name tokens and domain guesses", () => {
    expect(nameTokens("Longhorn Automotive LLC")).toEqual(["longhorn"]);
    expect(guessDomains("Longhorn Automotive LLC", "Austin")).toEqual(["longhornautomotive.com", "longhorn-automotive.com", "longhornautomotive.net", "longhornautomotiveaustin.com", "longhornauto.com"]);
    expect(domainFromEmail("info@swedishautoservice.com")).toBe("swedishautoservice.com");
    expect(domainFromEmail("shop@gmail.com")).toBeNull();
    expect(streetMatches("8215 RESEARCH BLVD", "visit us at 8215 Research Boulevard, Austin")).toBe(true);
    expect(streetMatches("8215 Research Blvd", "9215 research blvd")).toBe(false);
  });
  it("uses the business email domain first and verifies it by name alone", async () => {
    const r = await findWebsite({ name: "Longhorn Automotive", city: "Austin", region: "TX", email: "info@longhornautomotive.example" }, { search: null, scrape, lookup: noDns });
    expect(r.found).toMatchObject({ website: "https://longhornautomotive.example", source: "found_email" });
    expect(r.credits).toBe(1);
  });
  it("skips guesses that do not resolve in DNS, spending nothing", async () => {
    const looked: string[] = [];
    calls.length = 0;
    const r = await findWebsite({ name: "Longhorn Automotive", city: "Austin", region: "TX", phone: "5126692833" }, { search: null, scrape, lookup: async (h) => { looked.push(h); throw new Error("ENOTFOUND"); } });
    expect(r.found).toBeNull();
    expect(r.credits).toBe(0);
    expect(calls).toHaveLength(0);
    expect(looked).toContain("longhornautomotive.com");
  });
  it("verifies by phone and name, rejects same-name shops elsewhere", async () => {
    const ok = await verifyCandidate("https://longhornautomotive.example/", biz, scrape);
    expect(ok.ok).toBe(true);
    expect(ok.confidence).toBeGreaterThanOrEqual(0.9);
    expect(ok.credits).toBe(1);
    const other = await verifyCandidate("https://longhornauto.com/", biz, scrape);
    expect(other.ok).toBe(false);
    expect(other.evidence).toContain("name found but no phone");
  });
  it("checks search hits in order, drops aggregators, stops at the first verified site", async () => {
    const search = async () => [
      { url: "https://www.yelp.com/biz/longhorn", title: "Yelp", snippet: "" },
      { url: "https://longhornauto.com/", title: "Longhorn Auto", snippet: "" },
      { url: "https://longhornautomotive.example/contact", title: "Longhorn Automotive", snippet: "" },
      { url: "https://another.example/", title: "Another", snippet: "" },
    ];
    calls.length = 0;
    const r = await findWebsite(biz, { search, scrape, lookup: noDns });
    expect(r.found).toMatchObject({ website: "https://longhornautomotive.example", source: "found_search" });
    expect(r.notes.join("\n")).toContain("search https://longhornauto.com/: rejected");
    expect(calls).toEqual(["https://longhornauto.com/", "https://longhornautomotive.example/"]); // stopped before another.example
    expect(r.credits).toBe(2);
  });
  it("still verifies DNS-checked guesses when search returns many unverifiable hits", async () => {
    const search = async () => Array.from({ length: 8 }, (_, i) => ({ url: `https://directory${i}.example/longhorn`, title: "dir", snippet: "" }));
    const r = await findWebsite(biz, { search, scrape, lookup: async (h) => { if (h === "longhornautomotive.com") return [{ address: "203.0.113.5" }]; throw new Error("ENOTFOUND"); } });
    expect(r.found).toMatchObject({ website: "https://longhornautomotive.com", source: "found_guess" });
  });
  it("tolerates regions with regex metacharacters", async () => {
    const r = await verifyCandidate("https://longhornautomotive.example/", { ...biz, phone: null, region: "(TX" } as never, scrape);
    expect(r.evidence).not.toMatch(/regular expression/i);
    expect(r.ok).toBe(true); // name + city still match
  });
  it("returns no website when nothing verifies (no fabricated websites)", async () => {
    const r = await findWebsite({ name: "Nowhere Garage", city: "Austin", region: "TX", phone: "5125550100" }, { search: async () => [], scrape, lookup: noDns });
    expect(r.found).toBeNull();
  });
  it("lets an exhausted credit balance surface instead of reading it as a rejection", async () => {
    const broke: ScrapeFn = async () => {
      throw new FirecrawlCreditsError("out");
    };
    await expect(findWebsite({ ...biz, email: "info@longhornautomotive.example" }, { search: null, scrape: broke, lookup: noDns })).rejects.toBeInstanceOf(FirecrawlCreditsError);
  });
});
