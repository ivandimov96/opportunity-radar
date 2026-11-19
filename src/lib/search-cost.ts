/**
 * What a search is expected to cost, before it starts. Pure arithmetic over a
 * "basis" of measured figures (src/lib/search-cost-basis.ts loads it), so the
 * form can recompute it as the choices change.
 *
 * Three things cost something:
 *  - finding: search credits, 3 per page of 20 listings, up to a fixed number of pages per query;
 *  - research: AI spend per researched business plus website-reading credits;
 *  - emails: AI spend per email written (writer + claim check), only for businesses that qualify.
 * Every figure is an upper bound: cached pages are free, and research stops early when a business has no public email.
 */

/** Used until the workspace has enough history of its own: averages measured on real runs (November 2026). */
export const TYPICAL_COST = { researchUsd: 0.17, emailUsd: 0.08, pageCreditsPerResearch: 5 };
/** A workspace's own averages are used once it has this many researched businesses. */
export const MIN_HISTORY = 5;

export interface SearchCostBasis {
  creditsPerPage: number;
  listingsPerPage: number;
  maxPages: number;
  searchCreditsLeft: number;
  /** Average AI spend to research one business, USD; 0 when no model is configured. */
  researchUsd: number;
  /** Average AI spend to write and check one email, USD; 0 when no model is configured. */
  emailUsd: number;
  pageCreditsPerResearch: number;
  pageCreditsLeft: number;
  /** How many researched businesses the averages come from; 0 = typical figures. */
  measuredFrom: number;
  /** Emails are written automatically for qualified businesses. */
  autoDraft: boolean;
}

export interface SearchCostEstimate {
  searchCredits: number;
  /** Listings the search can return at most (pages × listings per page, capped by the chosen maximum). */
  listings: number;
  researched: number;
  researchUsd: number;
  pageCredits: number;
  emailUsd: number;
  totalUsd: number;
  enoughSearchCredits: boolean;
  enoughPageCredits: boolean;
}

export function estimateSearchCost(basis: SearchCostBasis, choice: { queries: number; maxResults: number; research: boolean; researchLimit: number | null }): SearchCostEstimate {
  const queries = Math.max(0, Math.floor(choice.queries));
  const maxResults = Math.max(0, Math.floor(choice.maxResults) || 0);
  const searchCredits = queries * basis.maxPages * basis.creditsPerPage;
  const listings = Math.min(maxResults, queries * basis.maxPages * basis.listingsPerPage);
  const researched = choice.research ? Math.min(listings, choice.researchLimit && choice.researchLimit > 0 ? choice.researchLimit : listings) : 0;
  const researchUsd = researched * basis.researchUsd;
  const pageCredits = Math.ceil(researched * basis.pageCreditsPerResearch);
  const emailUsd = basis.autoDraft ? researched * basis.emailUsd : 0;
  return {
    searchCredits,
    listings,
    researched,
    researchUsd,
    pageCredits,
    emailUsd,
    totalUsd: researchUsd + emailUsd,
    enoughSearchCredits: searchCredits <= basis.searchCreditsLeft,
    enoughPageCredits: pageCredits <= basis.pageCreditsLeft,
  };
}

/** Money for a small estimate: cents under a dollar are kept, nothing is shown as "$0.00" when it is not zero. */
export function fmtUsd(n: number): string {
  if (n <= 0) return "$0";
  if (n < 0.01) return "under $0.01";
  return `$${n.toFixed(2)}`;
}
