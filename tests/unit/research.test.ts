import { describe, expect, it } from "vitest";
import { extractPage, latestYearIn } from "@/lib/research/html";
import { detectFacts, pickBusinessEmail } from "@/lib/research/detect";
import { chooseLinks, homepageVariants } from "@/lib/research/crawler";

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
