import { describe, expect, it } from "vitest";
import { buildSoql, fetchPermits, permitToCandidate, titleCase } from "@/lib/discovery/tx-permits";

describe("Texas permit registry", () => {
  it("title-cases registry names and keeps initialisms", () => {
    expect(titleCase("GERMAN AUTO CENTER")).toBe("German Auto Center");
    expect(titleCase("LAW ATX LLC")).toBe("Law ATX LLC");
    expect(titleCase("O'REILLY AUTO PARTS OF TEXAS")).toBe("O'Reilly Auto Parts of Texas");
    expect(titleCase("AVA'S AUTO WORKS LLC")).toBe("Ava's Auto Works LLC");
    expect(titleCase("8215 RESEARCH BLVD")).toBe("8215 Research Blvd");
  });
  it("maps a registry row to a candidate with provenance and permit dates", () => {
    const c = permitToCandidate({ taxpayer_number: "32084744526", taxpayer_name: "MODERN PERFORMANCE AUTOMOTIVE, LLC", outlet_number: "1", outlet_name: "GERMAN AUTO CENTER", outlet_address: "8215 RESEARCH BLVD", outlet_city: "AUSTIN", outlet_state: "TX", outlet_zip_code: "78758", outlet_naics_code: 811111, outlet_permit_issue_date: "2022-11-30T00:00:00.000", outlet_first_sales_date: "2022-12-10T00:00:00.000" });
    expect(c).toMatchObject({ provider: "tx_permits", providerId: "32084744526-1", name: "German Auto Center", street: "8215 Research Blvd", city: "Austin", region: "TX", postalCode: "78758", category: "General automotive repair", website: null, phone: null });
    expect(c!.raw).toMatchObject({ naics: "811111", firstSalesDate: "2022-12-10", taxpayerName: "MODERN PERFORMANCE AUTOMOTIVE, LLC" });
    expect(permitToCandidate({ taxpayer_number: "1" })).toBeNull();
  });
  it("builds an escaped SoQL filter and pages through results", async () => {
    expect(buildSoql("Round Rock", ["811111", "811121"], "Joe's")).toBe("upper(outlet_city)='ROUND ROCK' AND outlet_naics_code in ('811111','811121') AND upper(outlet_name) like '%JOE''S%'");
    const urls: string[] = [];
    const rows = await fetchPermits("Austin", ["811111"], null, {
      max: 2500,
      fetchRows: async (url) => {
        urls.push(url);
        const u = new URL(url);
        const offset = Number(u.searchParams.get("$offset"));
        const limit = Number(u.searchParams.get("$limit"));
        const n = offset === 0 ? 1000 : offset === 1000 ? 1000 : 120;
        return Array.from({ length: Math.min(n, limit) }, (_, i) => ({ taxpayer_number: String(offset + i), outlet_name: `Shop ${offset + i}`, outlet_naics_code: "811111" }));
      },
    });
    expect(urls).toHaveLength(3);
    expect(new URL(urls[2]).searchParams.get("$limit")).toBe("500"); // last page sized to the cap
    expect(rows).toHaveLength(2120);
    expect(new URL(urls[0]).searchParams.get("$where")).toContain("upper(outlet_city)='AUSTIN'");
  });
});
