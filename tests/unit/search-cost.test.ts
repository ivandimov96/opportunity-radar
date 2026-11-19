import { describe, expect, it } from "vitest";
import { estimateSearchCost, fmtUsd, type SearchCostBasis } from "@/lib/search-cost";

const basis: SearchCostBasis = { creditsPerPage: 3, listingsPerPage: 20, maxPages: 3, searchCreditsLeft: 100, researchUsd: 0.2, emailUsd: 0.1, pageCreditsPerResearch: 5, pageCreditsLeft: 60, measuredFrom: 10, autoDraft: true };

describe("search cost estimate", () => {
  it("counts search credits per query and caps the listings at what the pages can hold", () => {
    const e = estimateSearchCost(basis, { queries: 1, maxResults: 200, research: false, researchLimit: null });
    expect(e.searchCredits).toBe(9);
    expect(e.listings).toBe(60);
    expect(e.researched).toBe(0);
    expect(e.totalUsd).toBe(0);
    expect(estimateSearchCost(basis, { queries: 3, maxResults: 200, research: false, researchLimit: null }).searchCredits).toBe(27);
  });
  it("prices research and emails for the businesses that will be researched", () => {
    const e = estimateSearchCost(basis, { queries: 1, maxResults: 40, research: true, researchLimit: 10 });
    expect(e.researched).toBe(10);
    expect(e.researchUsd).toBeCloseTo(2);
    expect(e.emailUsd).toBeCloseTo(1);
    expect(e.totalUsd).toBeCloseTo(3);
    expect(e.pageCredits).toBe(50);
    expect(e.enoughPageCredits).toBe(true);
    const all = estimateSearchCost(basis, { queries: 1, maxResults: 40, research: true, researchLimit: null });
    expect(all.researched).toBe(40);
    expect(all.enoughPageCredits).toBe(false);
  });
  it("leaves emails out when they are not written automatically, and flags a search the credits cannot cover", () => {
    expect(estimateSearchCost({ ...basis, autoDraft: false }, { queries: 1, maxResults: 20, research: true, researchLimit: null }).emailUsd).toBe(0);
    expect(estimateSearchCost({ ...basis, searchCreditsLeft: 5 }, { queries: 1, maxResults: 20, research: false, researchLimit: null }).enoughSearchCredits).toBe(false);
    expect(estimateSearchCost(basis, { queries: 0, maxResults: 20, research: true, researchLimit: null }).searchCredits).toBe(0);
  });
  it("formats small amounts without pretending they are zero", () => {
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(0.004)).toBe("under $0.01");
    expect(fmtUsd(4.2)).toBe("$4.20");
  });
});
