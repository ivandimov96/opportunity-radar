# Audit and target architecture — 2026-10-28

Scope: the whole application as it stands in the working tree (flow v2 + research engine v3 +
search start + free sources + location picker + ranked discovery, all uncommitted). This document
records what was found, what was decided, and the order of work. Decisions are logged in
docs/DECISIONS.md (D17–D22).

## 1. What the product is for
A software consultancy needs a steady stream of **credible, evidence-backed reasons to talk to a
specific local business about software it could build**. Not contacts, not volume: qualified
conversation starters whose every claim can be traced to a public source, and a view of which
problems repeat across businesses (product candidates). Everything below is judged against that.

## 2. Current workflow, traced end to end
1. **Start a search** (`/searches/new`): industry + sub-types, country/state/city (typeahead), whole
   area or radius, sources (OpenStreetMap, Texas registry, Google when keyed, demo), filters, auto-
   investigate threshold/limit. Validated server-side; stored in `searches` (+ `filters`).
2. **Discover** (`discover_search` job): collect from every source → score each candidate from
   discovery data (lead score + hints) → filters with skip counts → rank → upsert up to the cap
   (4-rule dedupe) → leftover records merged into listed businesses → best leads queued.
3. **Investigate** (`investigate_business` job): locate a website if missing or dead (email domain,
   web search when keyed, DNS-checked domain guesses, phone/name/address verification) → crawl
   homepage + up to 4 key pages (fallbacks: root, scheme/www, sitemap) in parallel with off-site
   records (RDAP, DNS MX/SPF, Internet Archive, registry permit) → deterministic facts (tools,
   schema.org, contact channels, text cues, measured health; explicit gaps) → optional model
   (quote-grounded facts, fact-cited hypotheses) → rule-based hypotheses → scoring → verdict.
4. **Review** (`/businesses/[id]`): profile with evidence, opportunities, outreach drafts
   (template or model), activity, pages. **Lists** (`/businesses`, `/searches/[id]`), **pipeline**
   board, **patterns** (category × industry with evidence and validation signals), **overview**
   inbox, **settings**.

## 3. Findings (ranked by business impact)

### Discovery
- **F1 — The free map source is unreliable.** Public Overpass mirrors time out unpredictably
  (Denver, Phoenix failed; Austin, Raleigh, Boise worked, one in 13 minutes). Coverage is also
  thin: ~200 map places for Austin auto repair, 94 with a website.
  **Measured alternative:** Overture Maps Places (open data, CDLA-Permissive 2.0, no key):
  an 8 km Denver box returns 563 `automotive_repair` places in 8.6 s via DuckDB over S3 with
  ~70% websites, ~76% phones, ~30% emails, a `brand` field (chains) and `operating_status`.
  Category names exist for every playbook (automotive_repair, auto_body_shop, tire_shop,
  transmission_repair, oil_change_station, hvac_service, plumbing, electrician, dental_clinic,
  general_dentistry, orthodontics, landscaping, lawn_service, tree_service, irrigation_service).
  **Decision D17: Overture becomes the primary discovery source; OpenStreetMap stays as a
  secondary net; registries stay as extras.** Requires a long-lived host (native DuckDB); on
  serverless it is disabled and OpenStreetMap remains.
- **F2 — "Why was this found" is implicit.** Lead-score reasons exist but are recomputed on the
  fly; sources are shown but the search that found a business and the rank it got are not on the
  business page. **Fix:** persist lead reasons and show a "Found by" panel (search, source(s),
  rank, reasons, operating status, brand).
- **F3 — Closed or irrelevant businesses are not detected** beyond chain/adjacent-name rules.
  Overture's `operating_status` and `brand` fix most of this at zero cost; dead websites already
  trigger the finder.
- **F4 — Repeated searches re-query sources every time.** No cache. **Fix:** cache Overture
  query results per (release, area, categories) for 30 days; Nominatim results are cached already.

### Research
- **F5 — JavaScript-rendered sites yield empty or thin text** (menus with no server HTML; the
  sitemap fallback helps only link discovery). **Fix (D18):** headless Chromium render as a
  fallback when the static homepage has < 400 characters of main text and the HTML is script-heavy;
  local hosts only, bounded (15 s, one page), recorded as `renderer=browser` on the page row.
- **F6 — Research freshness is invisible.** `investigatedAt` exists but nothing says "stale" and
  automatic runs never re-investigate. **Fix:** research age on lists and the business page;
  `RESEARCH_STALE_DAYS` (default 60); re-investigation keeps history (investigations/pages are
  already append-only; facts/opportunities are replaced atomically).
- **F7 — Coverage is not summarized.** Pages fetched/failed/blocked, robots refusals, finder
  attempts live only in notes. **Fix:** a "Research coverage" block on the profile tab.
- **F8 — Evidence classes are right but one verdict is missing.** `opportunity | no_opportunity |
  needs_ai` cannot say "we could not see enough" (one page, few facts). **Fix (D19):** add
  `insufficient_evidence`: set when ≤ 1 page fetched or < 5 verified facts; rules still run but the
  verdict and UI say the research was too thin to recommend anything.

### Opportunities
- **F9 — Weak gap-only hypotheses were crowding lists**; now demoted (weak rules capped) and
  confidence-capped. The seven-part explanation the founder asked for exists in the data model but
  the card does not read in that order. **Fix:** restructure the card: Observed (quotes) → Problem
  that might exist → Why it matters → Software that could help → Evidence → Unknown → How to
  validate. No new fields invented; `evidenceQuote`/`sourceUrl` of cited facts are shown inline.
- **F10 — Patterns are grouped by category × industry only.** Rule-based hypotheses carry a rule
  id in their title only. **Fix:** group by category, show the evidence that recurs, businesses
  per pattern, rule vs model share, and validation signals; link to the businesses.
- **F11 — Value estimation.** Already text-only ("value mechanism", no invented numbers). Keep.

### AI readiness
- **F12 — Single provider, SDK-specific.** `callStructured` is Anthropic-only. **Fix (D20):**
  provider abstraction (`anthropic` | `openai`), chosen by `AI_PROVIDER` or by which key exists,
  one structured-output contract (Zod schema → JSON schema), per-provider cost tables, the same
  spend guard, retries and refusal handling; tested with mocked transports. No key is required to
  run anything else; mock outputs are never shown as research.

### UX / UI
- **F13 — Tables differ page to page**: businesses has filters and quick chips but no pagination or
  dates; searches has none; search results have no in-page search; pipeline is a board without
  filters. **Fix (D21):** one server-side table model (URL params: `q`, `sort`, `dir`, `page`,
  `from`, `to`, `dateField`) with shared `FilterBar`, `DateRange`, `SortHeader`, `Pagination`
  components; businesses (50/page; dates: discovered, investigated, updated), searches (created),
  search results (search within, sort), pipeline (search, stage filter).
- **F14 — Jobs are invisible** except counts on settings; failures are only visible on the
  business. **Fix:** `/system` page: worker status, recent jobs with errors, retry/cancel, source
  health; settings keeps configuration.
- **F15 — Consistency.** Headers, badges, pills, empty states and cards are shared already
  (`ui.tsx`); the search page and business page each carry some one-off markup. Standardize
  status rendering (`StatusPill`), research-age badge, and the table components above.

### System
- **F16 — Local SQLite locking** was fixed (D15); keep the rule: no `db.transaction` locally.
- **F17 — Job recovery** was fixed (dead-pid recovery). Add: per-job timeout so a hung external call
  cannot hold a worker slot indefinitely (investigate 10 min, discover 20 min).
- **F18 — Rate limits.** Overpass is now bounded; Overture/S3 is pull-only; finder/DNS bounded.
  Add a per-host politeness delay in the crawler (already parallel across hosts, sequential within
  one site is enough) — currently key pages are fetched in parallel against one host (4 requests);
  keep but cap concurrency per host at 2.
- **F19 — Security.** SSRF guard, robots, no auth (single operator, documented). No change now.

## 4. Target workflow (what each stage is for)
| Stage | Purpose | In → Out | Automatic? | Failure handling |
|---|---|---|---|---|
| Market search | Define who and where | form → `searches` | user | validation inline |
| Discovery | Find and rank real candidates | sources → ranked `businesses` | auto | per-source errors, skip counts, log |
| Data collection | Everything knowable without the site | discovery data, registry, finder → fields | auto | finder gives up explicitly (`no_website`) |
| Research | What the site documents | crawl (+browser) → `pages` | auto | failed/blocked pages recorded, dead site → finder |
| Evidence | Verified facts, explicit gaps | pages + records → `facts` | auto (+model) | model facts rejected unless verbatim |
| Opportunity | Hypotheses citing evidence | facts → `opportunities` | auto (+model) | none when evidence is thin |
| Evaluation | Attractiveness × confidence, verdict | scores, `verdict` | auto | `insufficient_evidence` |
| Prioritization | What to act on first | priority, lead score, patterns | auto + user | — |
| Outreach | Drafts, conversations, signals | drafts, stages, signals | user | drafts never sent |

Re-running: investigate again keeps history and replaces facts/opportunities; discovery again merges.

## 5. Implementation order
1. Overture provider + cache + persisted lead reasons + "Found by" panel (F1–F4).
2. Browser-render fallback, research freshness, coverage block, per-job timeouts (F5–F7, F17, F18).
3. `insufficient_evidence` verdict, opportunity card restructure, patterns upgrade (F8–F10).
4. AI provider abstraction with tests (F12).
5. Table model + components applied to every list; `/system` page (F13–F15).
6. Tests, journeys, docs, measurements.
