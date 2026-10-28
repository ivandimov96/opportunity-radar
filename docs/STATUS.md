# Implementation status — 2026-10-27 (end of first build session)

## What was decided
See docs/DECISIONS.md (D1–D10) and docs/STRATEGY.md. Headlines: Next.js 16 + SQLite +
Drizzle; OpenStreetMap as default discovery with Google Places adapter, CSV import and
labeled demo provider; three validated AI stages on Claude Opus 5.5 with code-side
scoring; pilot market = independent auto repair, Austin TX, home services second.

## What was implemented
- Discovery: OSM (Overpass + Nominatim with geocode cache, endpoint fallback, retries),
  Google Places (New) text search adapter, CSV import, demo provider; normalization and
  4-rule deduplication; search results with new/merged tracking and attribution.
- Research: SSRF-guarded fetcher (pinned IP, private-range rejection, redirect
  re-validation, size/time caps), robots.txt, HTML→text, link classification, round-robin
  crawl of ≤6 pages, site-root fallback for dead deep links, duplicate-content skip,
  deterministic detectors (40+ tool signatures, 17 text cues, contact forms, emails,
  phones, page-kind signals) producing verified observations with evidence.
- AI: structured-output client with usage/cost accounting and spend guard; extraction
  with verbatim-quote grounding; analysis with citation validation, category mapping,
  evidence-strength capping, explicit "insufficient evidence"; outreach with
  claim→observation mapping and warning checks. Prompts isolate website text as
  untrusted data.
- Scoring: attractiveness (value, feasibility, reusability, fit, reach, readiness) and
  confidence (evidence count, strength, depth, assumption load), each factor explained;
  no-evidence opportunities capped at 35 confidence.
- Jobs: SQLite queue, idempotency keys, retries with backoff, stale-lock recovery,
  embedded worker (or `pnpm worker`), per-business failure isolation.
- Pipeline: 10 stages (auto-advance forward only), priority, next actions, notes,
  interaction logging, validation signals (which auto-advance to validated/won).
- Patterns: category × industry grouping with shared evidence, common assumptions,
  effort mix and real validation signals.
- UI: overview, searches (list/new/detail with live progress), businesses (filters,
  sorting, export CSV), business profile (overview, findings, opportunities with score
  breakdowns, outreach editor with claim mapping, pipeline, pages), pipeline board,
  patterns, CSV import, settings/integration status. Demo data is labeled everywhere.

## UI redesign (same day, second pass)
Rebuilt the interface around "guided funnel, evidence first" (docs/DESIGN.md): workflow
engine with steppers and next-step recommendations, inbox-style overview with funnel,
quick-filter chips, score rings with explanations, inline claim highlighting in the
outreach editor, responsive shell with mobile drawer, dark mode. Verified with
screenshots at 1360 px and 390 px (light and dark) and an updated Playwright journey.

## Deployment (same day, third pass)
Repository pushed to https://github.com/ivandimov96/opportunity-radar; Vercel project
`opportunity-radar` deployed at https://opportunity-radar-sage-five.vercel.app. The first
deployment proved that file-based SQLite cannot persist on serverless, so the data layer
was migrated to libSQL (Turso-compatible, async). Persistence on Vercel needs
`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (founder action; free tier). Until then the
deployment is a labeled read-only demo.

## Flow v2 (same day, fourth pass) — see D13
Rebuilt the core flow after founder feedback: one "Investigate" action per business,
a structured profile of comparable fields with evidence/not-found/unknown status, one
status + one verdict per business, a 7-stage sales pipeline, faster parallel crawl
(3–8 s per real business without AI), one model call for profile + opportunities.
Tests rewritten (49 unit/integration, 3 browser journeys). Pushed to GitHub; NOT
deployed to Vercel at the founder's request.

## Research engine v3 (same day, fifth pass) — see D14 and docs/RESEARCH.md
Rebuilt how a business is researched after the founder asked for the best algorithm
with fallbacks and prioritization: lead score + chain detection at discovery; website
finder with phone/name verification (also for dead recorded sites); crawl fallbacks
(root, scheme/www variants, sitemap); off-site keyless footprint (RDAP, DNS MX/SPF,
Internet Archive); deterministic facts from resources, schema.org JSON-LD and
main-content text cues (43 profile fields incl. an "online footprint" group); a rule
engine giving a verdict without AI; model hypotheses kept and complemented by rules.
UI: lead score rings before investigation, chain badges and filter, rule-based/AI
badges on opportunities, website-finder states. Tests: 73 unit/integration pass.
Live (no AI): 12 independents re-investigated in 46 s total (1.3–9.4 s each),
11 profiled with rule-based opportunities, 1 dead domain recovered by a verified guess,
1 failed (domain no longer resolves, no alternative found); 3/15 and 10/40 OSM results
flagged as chains; OSM Austin auto repair: 205 places, 94 with website, 17 with a phone
but no website; 0/5 of those located by domain guesses alone (web search needs a Brave
key; DuckDuckGo answered automated queries with a bot challenge). Not committed and not
deployed (founder approval pending).

## Search start (same day, sixth pass)
Rebuilt how a search starts: business type with sub-types (segments per playbook,
mapped to OpenStreetMap selectors / Google queries), whole-area or radius mode
(Overpass `around`, geocoded center cached), sources, discovery filters with skip
counts (chains, phone, website, known), result cap, auto-investigation threshold and
limit. One shared input schema (`src/lib/search-input.ts`) drives the server action,
the client form (`useActionState`: inline field errors, submitted values preserved,
pending state, live summary of what will run and what is collected) and the tests.
Searches list/detail show the filter summary, resolved area and skip counts.
Found and fixed a production-only database lock (D15): local SQLite now uses one
connection per process, atomic job claims and batched writes. Tests: 80 unit/integration
and 4 browser journeys pass (including the new filtered-search journey).

## Google Maps only (2026-10-28, D25)
The founder chose Google Maps listings via SerpApi as the single discovery source and had the
database wiped (backup kept outside the repository). New provider `google_maps` with a monthly
search budget (`provider_usage`), a page cache (`provider_cache`, migration `0007_google_maps`),
offline map positioning from the bundled place list, radius filtering and a closed-listing flag;
Overture and OpenStreetMap set to `disabled` (kept), the Google Places adapter removed. Tests: 160
unit/integration + 5 browser journeys. **Search not yet run live**: `SERPAPI_API_KEY` is not in `.env`; the first live check
(`scripts/search-live.ts`) is pending the founder's key. **Firecrawl ran live for the first time**
(2026-10-28 evening): one real Austin shop inserted by hand → 5 pages read, 5 credits, 20 verified facts,
verdict `opportunity` in 7 s; the website finder noticed the site now redirects to the acquiring group.
Two defects found and fixed from that run: (1) page text was joined without separators, so an email next
to a phone number read as one token (`extractPage` now separates element text; a phone glued inside one
text node is stripped); (2) a redirected homepage made stored pages look foreign and the re-run paid for a
second crawl (`loadStoredPages` now accepts the redirect target's domain; re-run measured at 0 credits).
Synchronization audit of form → Google Maps query → saved business → Firecrawl: every form field reaches
the query (type/sub-types → query text, keyword → query term and name filter, country/region/city/radius
→ map position, cap → paging, filters → engine); the city on a listing now comes from Google's address.

## Sources trimmed (2026-10-28, after search engine v2)
Removed the Texas sales tax permit registry (provider, NAICS mapping, `permit_since` fact,
`SOCRATA_APP_TOKEN`) and took demo data off the search form: the form offers exactly Overture
and OpenStreetMap plus the four planned sources. Demo data remains behind "Load demo data"
and in the tests (provider status `internal`). See D24.

## Free improvements (same day, seventh pass) — see D16
Texas sales tax permit registry as a discovery source (NAICS per sub-type, title-cased
names, permit dates → `permit_since` fact); template outreach drafts without AI;
keyless website finder improvements (email domain, more variants, DNS pre-check,
address verification). Settings, search form, lists and badges updated.

## Location picker and ranked discovery (same day, eighth pass)
US state dropdown + city typeahead from bundled GeoNames places (16k cities, CC BY),
radius centers without geocoding; Texas registry offered only for Texas. Discovery
rewritten as collect → score → rank → store (cap keeps the best), lead hints (hours,
years trading, outlets per owner), OpenStreetMap name-pattern net, leftover source
records merged. Search form sidebar removed (compact summary line instead).

Nationwide live checks (OpenStreetMap only): Raleigh NC home services 20 found/12
listed (775 s, overloaded public server), Boise ID dental 55/12 (49 s), Denver CO radius
search timed out on every public mirror in the first attempt. Response: two more
Overpass mirrors by default, the name-pattern net demoted to a second pass that only runs
when the precise query is thin, dealer detection by name/domain, adjacent businesses
(tint, detailing, towing) dropped by name.

## Audit-driven rebuild (2026-10-28) — see docs/AUDIT.md, D17–D22
Overture Maps Places is the primary discovery source (DuckDB over the public S3 release,
cached per area; measured: Denver 1,019 candidates, Austin 1,591 in 3.9 s, Phoenix landscaping
173, Raleigh dental 297, listed businesses with website/phone/email throughout); brand and
open/closed status feed chain detection and closed-business skipping; lead reasons persisted
and shown in a "Found by" panel. Research: headless-browser fallback for JavaScript-only sites,
per-site politeness (2 in flight), page renderer tracking, research age and staleness, a
coverage block with the investigation log, per-job timeouts. Opportunities: `insufficient_evidence`
verdict; the card reads observed → problem → why it matters → software → evidence → unknown →
validate; patterns show recurring hypotheses and evidence strength. AI: provider abstraction
(Anthropic + OpenAI) behind one structured-output contract, tested with injected transports.
UX: shared table model (search, sort, date range, pagination) on businesses, searches, search
results and pipeline; System page with jobs (retry/cancel) and source health. A code review of the
whole change set before the merge found ten defects, all fixed with tests: job timeouts now abort
the handler and fail the business/search; dead-worker recovery is host-scoped; pattern counts used
mismatched keys; generic chain words (budget, enterprise, target) excluded independents; failed
businesses were not re-queued on a rerun; the finder never verified domain guesses after many
search hits and could throw on a region with regex characters; the "insufficient evidence"
threshold counted measured keys; cancelling a queued job left its search "discovering" forever;
two vendor-email lists disagreed. Then, on the founder's brief, the in-house crawler (fetcher,
link discovery, Playwright render fallback, sitemap reader) was removed and replaced by
Firecrawl (D23): client with limiter, retries and credit accounting; crawl orchestration that
spends one credit per page and maps a site only when needed; stored pages with free
re-analysis; monthly budget guard; credits on the business and System pages; `FIRECRAWL_API_KEY`
required for new research. Client and crawl are tested against injected transports only; the
founder has since added a key, and the first live research run is still pending.

Then the search engine was rebuilt (docs/SEARCH.md, D24): worldwide locations (bundled GeoNames
countries, regions, 45k cities), a provider registry with four planned sources shown but never
executed, Overture on grid cells with the latest release from the STAC catalog, OpenStreetMap on
the same cells, a taxonomy layer verified against the live Overture data, structured geocoding with
sanity checks, cross-source merging with confidence and uncertain matches kept separate, a
candidates table with review-before-save, and a results page with filters, sorting, pagination and
bulk saving. Validated live on 2026-10-28: Austin (Overture, OSM, both, repeat from cache in 0.4 s,
whole city with 1,581 unique businesses), Berlin dental (6 km and whole city), a zero-result town,
a free-text category; measurements in docs/SEARCH.md. The local database was wiped on the founder's
request before these runs (backup kept outside the project). Tests: 152 unit/integration, 5 browser
journeys.

## What was actually tested (executed in the first session)
- `pnpm typecheck`: clean. `pnpm build`: succeeds.
- `pnpm test`: 51 tests pass (8 files) — normalization, dedupe rules, SSRF guard
  (private ranges, URL shapes, DNS rebinding), HTML extraction, signal detection,
  contact-form heuristic, snippet boundaries, CSV parsing, Overpass query building,
  extraction grounding, analysis citation validation, outreach claim validation,
  scoring determinism/separation, job queue (idempotency, backoff, stale recovery),
  and the integrated pipeline (discover → research → analyze → outreach → pipeline)
  with HTTP and the model mocked at module boundaries, including empty results,
  insufficient evidence, unreachable website, missing credentials and spend guard.
- `pnpm test:e2e`: 3 Playwright tests pass against a production build in demo mode (journey, provider listing, mobile layout with no horizontal overflow) —
  the full operator journey (load demo → search → profile → findings → opportunities →
  edit/approve draft → stage/note/validation signal → patterns → persistence).
- Live checks (real network, no AI key): OSM discovery for `auto_repair` in Austin
  returned 205 named shops with websites; 15 stored with addresses/phones. Website
  research ran on Longhorn Automotive, Excalibur Auto Repair, Eurofed Automotive and
  Swedish Auto Service: 6 pages each fetched, deterministic observations with
  evidence, emails/phones promoted, dead deep link recovered via site root.
- Earlier in the session the public Overpass instances returned 502/timeouts for
  several minutes; the later run succeeded on overpass-api.de.

## Not tested / not exercised
- Any live Anthropic API call (no key available; paid usage requires founder approval).
  Extraction/analysis/outreach prompts and schemas are therefore uncalibrated against
  real model output. The SDK's `messages.parse` + `zodOutputFormat` path compiled with
  Zod 4 but has not run.
- Google Places adapter (no key).
- Multi-process worker, production deployment, authentication.

## Known limitations
- Deterministic text cues can fire on embedded customer-review text (seen on one
  homepage: "specials"/"24/7" cues matched review content). Evidence snippets make this
  visible; AI extraction will add better-grounded observations.
- OSM `website` tags may be stale/deep links; contact info coverage varies.
- JS-rendered sites yield little text (no headless rendering by design).
- Public Overpass/Nominatim instances are shared and can be slow or unavailable.
- Patterns use a fixed 14-category taxonomy; no semantic clustering.
- Single operator, no auth; SQLite single-writer.

## Credentials / approvals needed from the founder
- `FIRECRAWL_API_KEY` (firecrawl.dev, free plan) to run and measure live website research.
1. **Anthropic API key** (paid). Suggested first budget: $25 (the default spend guard).
2. Optional: Google Maps Platform key for Places API (New), after reviewing its
   caching/attribution terms.
3. Optional: paid Overpass endpoint if OSM volume grows.

## Next priorities
1. With a key: run extraction/analysis/outreach on the 15 stored Austin shops; review
   outputs; tune prompts, grounding tolerance and scoring weights; measure cost.
2. Run the full 100-shop Austin pass with auto-research; measure coverage, share with
   opportunities, "insufficient evidence" rate.
3. Operator workflow polish from real use: bulk actions on the business list,
   opportunity-level filters, note editing, draft version history.
4. Add authentication + HTTPS before any shared deployment.
5. Revisit Overpass hosting and Google Places based on data quality observed.
