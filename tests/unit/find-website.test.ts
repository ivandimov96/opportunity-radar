import { describe, expect, it } from "vitest";
import { domainFromEmail, findWebsite, guessDomains, nameTokens, streetMatches, verifyCandidate } from "@/lib/discovery/find-website";

const pages: Record<string, string> = {
  "https://longhornautomotive.example/": "<html><head><title>Longhorn Automotive | Austin TX</title></head><body><main><p>Longhorn Automotive, Austin, TX. Call <a href='tel:512-669-2833'>512-669-2833</a></p></main></body></html>",
  "https://longhornauto.com/": "<html><head><title>Longhorn Auto</title></head><body><main><p>Longhorn Automotive of Billings, Montana.</p></main></body></html>",
  "https://www.yelp.com/biz/longhorn": "<html><body>Yelp</body></html>",
  "https://longhornautomotive.com/": "<html><head><title>Longhorn Automotive</title></head><body><main><p>Longhorn Automotive, Austin TX. Call 512-669-2833.</p></main></body></html>",
};
const fetcher = async (url: string) => {
  const body = pages[url];
  if (!body) return { url, finalUrl: url, status: 404, contentType: "text/html", body: "", bytes: 0, truncated: false };
  return { url, finalUrl: url, status: 200, contentType: "text/html", body, bytes: body.length, truncated: false };
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
    const r = await findWebsite({ name: "Longhorn Automotive", city: "Austin", region: "TX", email: "info@longhornautomotive.example" }, { search: null, fetcher: fetcher as never, lookup: async () => { throw new Error("no dns in tests"); } });
    expect(r).toMatchObject({ website: "https://longhornautomotive.example", source: "found_email" });
  });
  it("skips guesses that do not resolve in DNS", async () => {
    const looked: string[] = [];
    const r = await findWebsite({ name: "Longhorn Automotive", city: "Austin", region: "TX", phone: "5126692833" }, { search: null, fetcher: fetcher as never, lookup: async (h) => { looked.push(h); throw new Error("ENOTFOUND"); } });
    expect(r).toBeNull();
    expect(looked).toContain("longhornautomotive.com");
  });
  it("verifies by phone and name, rejects same-name shops elsewhere", async () => {
    const ok = await verifyCandidate("https://longhornautomotive.example/", biz, fetcher as never);
    expect(ok.ok).toBe(true);
    expect(ok.confidence).toBeGreaterThanOrEqual(0.9);
    const other = await verifyCandidate("https://longhornauto.com/", biz, fetcher as never);
    expect(other.ok).toBe(false);
    expect(other.evidence).toContain("name found but no phone");
  });
  it("uses search hits first, dropping aggregators, and stores only verified results", async () => {
    const search = async () => [
      { url: "https://www.yelp.com/biz/longhorn", title: "Yelp", snippet: "" },
      { url: "https://longhornauto.com/", title: "Longhorn Auto", snippet: "" },
      { url: "https://longhornautomotive.example/contact", title: "Longhorn Automotive", snippet: "" },
    ];
    const r = await findWebsite(biz, { search, fetcher: fetcher as never, lookup: async () => { throw new Error("ENOTFOUND"); } });
    expect(r).toMatchObject({ website: "https://longhornautomotive.example", source: "found_search" });
    expect(r!.notes.join("\n")).toContain("search https://longhornauto.com/: rejected");
  });
  it("still verifies DNS-checked guesses when search returns many unverifiable hits", async () => {
    const search = async () => Array.from({ length: 8 }, (_, i) => ({ url: `https://directory${i}.example/longhorn`, title: "dir", snippet: "" }));
    const r = await findWebsite(biz, { search, fetcher: fetcher as never, lookup: async (h) => { if (h === "longhornautomotive.com") return [{ address: "203.0.113.5" }]; throw new Error("ENOTFOUND"); } });
    expect(r).toMatchObject({ website: "https://longhornautomotive.com", source: "found_guess" });
  });
  it("tolerates regions with regex metacharacters", async () => {
    const r = await verifyCandidate("https://longhornautomotive.example/", { ...biz, phone: null, region: "(TX" } as never, fetcher as never);
    expect(r.evidence).not.toMatch(/regular expression/i);
    expect(r.ok).toBe(true); // name + city still match
  });
  it("returns null when nothing verifies (no fabricated websites)", async () => {
    const r = await findWebsite({ name: "Nowhere Garage", city: "Austin", region: "TX", phone: "5125550100" }, { search: async () => [], fetcher: fetcher as never, lookup: async () => { throw new Error("ENOTFOUND"); } });
    expect(r).toBeNull();
  });
});
