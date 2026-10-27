import { describe, expect, it } from "vitest";
import { normalizeName, normalizePhone, normalizeWebsite, websiteDomain, isAggregatorUrl, normalizeEmail } from "@/lib/discovery/normalize";

describe("normalizeName", () => {
  it("strips legal suffixes, punctuation and noise words", () => {
    expect(normalizeName("Joe's Auto Repair, LLC")).toBe("joes auto repair");
    expect(normalizeName("The Brake & Clutch Co.")).toBe("brake clutch");
    expect(normalizeName("Café Motors Inc")).toBe("cafe motors");
  });
});

describe("normalizeWebsite / websiteDomain", () => {
  it("adds https, strips tracking params and trailing slash", () => {
    expect(normalizeWebsite("www.example.com/?utm_source=x")).toBe("https://www.example.com");
    expect(normalizeWebsite("http://example.com/services/")).toBe("http://example.com/services/");
  });
  it("rejects non-web values", () => {
    expect(normalizeWebsite("mailto:a@b.com")).toBeNull();
    expect(normalizeWebsite("localhost")).toBeNull();
    expect(normalizeWebsite("")).toBeNull();
  });
  it("ignores aggregator domains for identity", () => {
    expect(websiteDomain("https://www.facebook.com/shop")).toBeNull();
    expect(isAggregatorUrl("https://yelp.com/biz/x")).toBe(true);
    expect(websiteDomain("https://www.Example.com/about")).toBe("example.com");
  });
});

describe("normalizePhone / normalizeEmail", () => {
  it("reduces to digits and drops US country code", () => {
    expect(normalizePhone("(512) 555-0101")).toBe("5125550101");
    expect(normalizePhone("+1 512 555 0101")).toBe("5125550101");
    expect(normalizePhone("123")).toBeNull();
  });
  it("validates emails", () => {
    expect(normalizeEmail("MAILTO:Info@Shop.com")).toBe("info@shop.com");
    expect(normalizeEmail("not an email")).toBeNull();
  });
});
