import { describe, expect, it } from "vitest";
import { classifyLink, extractPage } from "@/lib/research/html";
import { detectSignals } from "@/lib/research/signals";
import { parseCsv, csvToCandidates } from "@/lib/discovery/csv";
import { buildOverpassQuery, elementToCandidate } from "@/lib/discovery/osm";

const html = `<html><head><title>Barton Auto</title><meta name="description" content="Austin auto repair"><script src="https://embed.tawk.to/abc/def.js"></script><link rel="stylesheet" href="https://static.parastorage.com/x.css"></head>
<body><nav><a href="/services">Services</a><a href="/book-appointment">Book Now</a><a href="https://facebook.com/x">FB</a></nav>
<h1>Barton Auto Care</h1><p>Call us today to schedule your appointment. Free estimates. Fleet accounts welcome.</p>
<p>Mon - Fri: 8am - 6pm</p>
<a href="mailto:Service@BartonAuto.com">Email</a><a href="tel:+1 (512) 555-0101">Call</a>
<form action="/contact"><input name="name"><input name="email"><textarea name="message"></textarea></form>
<script>document.write("hidden")</script></body></html>`;

describe("extractPage", () => {
  it("extracts text, links, contacts, forms and resource hosts without script content", () => {
    const p = extractPage(html, "https://bartonauto.com/");
    expect(p.title).toBe("Barton Auto");
    expect(p.text).not.toContain("hidden");
    expect(p.text).toContain("Call us today to schedule");
    expect(p.emails).toEqual(["service@bartonauto.com"]);
    expect(p.phones).toEqual(["5125550101"]);
    expect(p.links.map((l) => l.href)).toContain("https://bartonauto.com/book-appointment");
    expect(p.resourceHosts).toContain("embed.tawk.to");
    expect(p.forms[0].fields).toEqual(["name", "email", "message"]);
    expect(p.forms[0].hasTextarea).toBe(true);
    expect(p.hasChatWidget).toBe(true);
  });
});

describe("detectSignals", () => {
  it("produces verified observations with evidence for tools, cues and contacts", () => {
    const p = extractPage(html, "https://bartonauto.com/");
    const obs = detectSignals(p, "https://bartonauto.com/", "home");
    const statements = obs.map((o) => o.statement);
    expect(statements).toContain("Website integrates Tawk.to chat (website chat widget)");
    expect(statements).toContain("Website integrates Wix (website builder/CMS)");
    expect(statements).toContain("Website asks customers to call to schedule service");
    expect(statements).toContain("Website advertises free estimates or quotes");
    expect(statements).toContain("Website mentions fleet or commercial accounts");
    expect(statements).toContain("Website has a contact/request form");
    expect(statements).toContain("Public email address listed: service@bartonauto.com");
    for (const o of obs) {
      expect(o.evidenceQuote.length).toBeGreaterThan(0);
      expect(o.sourceUrl).toBe("https://bartonauto.com/");
    }
  });
});

describe("contact form heuristic & snippets", () => {
  it("ignores site-search forms and accepts real contact forms", async () => {
    const { looksLikeContactForm } = await import("@/lib/research/html");
    expect(looksLikeContactForm({ fields: ["s", "submit"], hasTextarea: false, action: "/" })).toBe(false);
    expect(looksLikeContactForm({ fields: ["input_1", "input_2"], hasTextarea: false, action: "/contact/#gform" })).toBe(true);
    expect(looksLikeContactForm({ fields: ["name", "phone"], hasTextarea: false, action: null })).toBe(true);
    expect(looksLikeContactForm({ fields: ["x1", "x2"], hasTextarea: false, action: null })).toBe(false);
  });
  it("snippets always contain the match and start on a boundary", async () => {
    const { snippet } = await import("@/lib/research/signals");
    const text = "We are a family shop. Call us today to schedule your appointment and we will take care of you quickly and fairly.";
    const idx = text.indexOf("Call us today");
    const s = snippet(text, idx, "Call us today to schedule".length);
    expect(s.startsWith("Call us today")).toBe(true);
    expect(s).toContain("schedule your appointment");
  });
  it("phone normalization dedupes country-code variants", async () => {
    const { normalizeTel } = await import("@/lib/research/html");
    expect(normalizeTel("+1 (512) 454-3733")).toBe("5124543733");
    expect(normalizeTel("512-454-3733")).toBe("5124543733");
    expect(normalizeTel("12")).toBeNull();
  });
});

describe("classifyLink", () => {
  it("classifies by path and anchor text", () => {
    expect(classifyLink("/book-appointment", "Book Now")).toBe("booking");
    expect(classifyLink("/about-us", "")).toBe("about");
    expect(classifyLink("/blog/post", "Read")).toBe("other");
  });
});

describe("csv", () => {
  it("parses quoted fields and maps loose headers", () => {
    const text = 'Company Name,Website,Phone,City\n"Acme, Inc.",acme.com,"(512) 555-0199",Austin\nNoSite,,,Austin\n';
    expect(parseCsv(text)).toHaveLength(3);
    const { candidates, errors } = csvToCandidates(text, { country: "US" });
    expect(errors).toEqual([]);
    expect(candidates[0].name).toBe("Acme, Inc.");
    expect(candidates[0].website).toBe("acme.com");
    expect(candidates[1].website).toBeNull();
  });
  it("requires a name column", () => {
    expect(csvToCandidates("foo,bar\n1,2", { country: "US" }).errors[0]).toMatch(/name/);
  });
});

describe("osm", () => {
  it("builds a bounded Overpass query and maps elements", () => {
    const q = buildOverpassQuery(['["shop"="car_repair"]'], { south: 1, west: 2, north: 3, east: 4 }, 'Joe"s');
    expect(q).toContain('nwr["shop"="car_repair"]["name"]["name"~"Joes",i](1,2,3,4);');
    const c = elementToCandidate({ type: "node", id: 5, lat: 30, lon: -97, tags: { name: "X", shop: "car_repair", "contact:website": "x.com", "addr:city": "Austin" } }, "US");
    expect(c).toMatchObject({ provider: "osm", providerId: "node/5", website: "x.com", city: "Austin", category: "car_repair", lat: 30 });
    expect(elementToCandidate({ type: "node", id: 6, tags: {} }, "US")).toBeNull();
  });
});
