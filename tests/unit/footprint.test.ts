import { describe, expect, it } from "vitest";
import { footprintFacts, mailFootprint, registrableDomain } from "@/lib/research/footprint";

const deps = {
  resolveMx: async () => [{ exchange: "alt1.aspmx.l.google.com", priority: 5 }, { exchange: "aspmx.l.google.com", priority: 0 }],
  resolveTxt: async () => [["v=spf1 include:_spf.google.com include:servers.mcsv.net ~all"], ["google-site-verification=abc"]],
  fetchJson: async () => ({ events: [{ eventAction: "registration", eventDate: "1998-08-13T04:00:00Z" }] }),
  fetchText: async () => "19991127163013\n",
};

describe("footprint", () => {
  it("reduces hostnames to the registrable domain", () => {
    expect(registrableDomain("www.swedishautoservice.com")).toBe("swedishautoservice.com");
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
  });
  it("derives email provider and senders from MX/SPF", async () => {
    const m = await mailFootprint("x.example", deps);
    expect(m.provider).toBe("Google Workspace");
    expect(m.mx[0]).toBe("aspmx.l.google.com");
    expect(m.senders).toEqual(["Google Workspace", "Mailchimp"]);
  });
  it("produces verified facts with public-record sources, and tolerates failures", async () => {
    const { facts } = await footprintFacts("https://www.x.example/page", deps);
    const by = Object.fromEntries(facts.map((f) => [f.key, f]));
    expect(by.domain_registered).toMatchObject({ status: "verified", value: "1998", sourceUrl: "https://rdap.org/domain/x.example" });
    expect(by.site_first_seen).toMatchObject({ value: "1999" });
    expect(by.site_first_seen.sourceUrl).toContain("web.archive.org/web/19991127163013/x.example");
    expect(by.email_provider.value).toBe("Google Workspace");
    expect(by.email_senders.value).toBe("Google Workspace, Mailchimp");

    const broken = await footprintFacts("https://y.example", { ...deps, fetchJson: async () => { throw new Error("boom"); }, resolveMx: async () => [], resolveTxt: async () => [] });
    const keys = broken.facts.map((f) => f.key);
    expect(keys).not.toContain("domain_registered");
    expect(broken.facts.find((f) => f.key === "email_provider")).toMatchObject({ status: "not_found" });
    expect(broken.notes.join(" ")).toContain("RDAP lookup for y.example unavailable (boom)");
  });
});
