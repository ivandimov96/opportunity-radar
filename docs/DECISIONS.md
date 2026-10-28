# Decision log

Format: decision · alternatives · criteria · choice · why · trade-offs · revisit when.

## D1 — Stack: Next.js + SQLite + Drizzle (2026-10-27)
Alternatives: Vite+React SPA with Hono/Fastify API; Python FastAPI + React; Postgres.
Criteria: time-to-working-MVP, single-process ops, type safety end to end, migration path.
Choice: Next.js 16 App Router, server actions, better-sqlite3, Drizzle.
Why: one codebase/process, no Docker/Postgres on the dev machine, SQL migrations, easy
Postgres swap later. Trade-offs: Next build/Turbopack quirks; SQLite single-writer.
Revisit when: multi-user hosting or >1 worker host is needed.

## D2 — Discovery providers: OSM primary, Google adapter, CSV, demo
Alternatives considered: Google Places (New), Foursquare Places, Yelp Fusion, OSM.
Findings (official pages fetched 2026-10-27):
- Google Places: place IDs may be stored indefinitely; other Places content must not be
  cached/stored beyond allowed exceptions; attribution/Google-map display rules. Usable
  with a key, but storage constraints limit CRM-style use. Adapter implemented, untested.
- OpenStreetMap: ODbL, store with attribution; Overpass public instances "overloaded",
  commercial sustained use should be self-hosted/paid; Nominatim: 1 req/s, User-Agent,
  cache results. Chosen as default: free, storable, keyless.
- Foursquare: developer docs URL 404'd; pricing pages conflicting; not integrated.
- Yelp Fusion: secondary sources report 24h caching limits, paid plans, display
  restrictions; not integrated.
Trade-offs: OSM coverage/quality varies; public endpoints flaky (observed 502/timeouts).
Revisit when: volume needs a paid Overpass instance or a Google key is approved.

## D3 — Pilot market: auto repair, Austin TX (home services second)
See STRATEGY.md. Revisit after a live Overpass category count and the first 100-shop run.

## D4 — AI: three validated stages, structured outputs, Opus 5.5
Alternatives: one agent with tools; cheaper models for extraction; embeddings for
clustering. Choice: extraction (low effort) → analysis (high) → outreach (medium) with
code validators; models/effort configurable by env. Why: traceability (quote grounding,
citation validation), testability, cost control via effort and spend guard. Server-side
refusal fallbacks were not enabled (business-website analysis has negligible refusal
risk; refusals surface as explicit errors). Revisit when: measured quality/cost on real
runs suggests a different model or effort mix.

## D5 — Scoring in code, not by the model
Choice: model supplies 1–5 ratings and citations; code computes attractiveness and
confidence with published weights and per-factor explanations; no-evidence
opportunities capped at confidence 35. Why: comparable, auditable, tunable.
Revisit when: calibration data from validation signals exists.

## D6 — Jobs: SQLite queue + in-process worker
Alternatives: BullMQ/Redis, pg-boss, external cron. Choice: `jobs` table, claim in a
transaction, idempotency keys, exponential backoff, stale-lock recovery, embedded loop
started from `instrumentation.ts` (or `pnpm worker`). Why: zero infra, resumable,
observable in the UI. Revisit when: multiple hosts or long-running throughput needs.

## D7 — Crawl scope: ≤6 prioritized same-site pages, no JS rendering
Why: most SMB sites expose services/contact/booking in server HTML; JS rendering adds
cost and risk. Revisit when: measured share of empty-text homepages is high.

## D8 — Patterns via taxonomy grouping, not embeddings
Why: 14 fixed opportunity categories give transparent grouping at MVP scale; the
model assigns a category per opportunity. Revisit when: categories prove too coarse.

## D9 — No outreach sending in MVP
Drafts only; approval is a status. Any future sending requires explicit authorization,
suppression lists, opt-out, rate limits, and jurisdiction checks (CAN-SPAM etc.).

## D10 — No authentication yet
Single-operator local tool. Must add auth + HTTPS before public deployment.

## D11 — UX principle: guided funnel, evidence first (2026-10-27)
Alternatives: dashboard-centric "metrics" UI; CRM-style record pages; chat/agent UI.
Choice: a single workflow engine (`src/lib/workflow.ts`) drives step states and the one
recommended next action everywhere; the overview is an inbox + funnel; evidence is shown
inline next to every claim. Why: the product's value is trust and momentum, not feature
count; operators must never wonder what to do next or whether a statement is verified.
Trade-offs: more opinionated navigation; fewer raw controls on the first screen.
Revisit when: real operators ask for bulk operations or team views. See docs/DESIGN.md.

## D12 — Data layer: libSQL (Turso-compatible) instead of better-sqlite3 (2026-10-27)
Context: deploying to Vercel showed that a file-based SQLite database is unusable on
serverless (each instance has its own ephemeral /tmp, so writes vanish between requests).
Alternatives: Postgres (Neon) — different dialect, bigger migration; keep better-sqlite3
and host on a VM — not Vercel; Vercel Blob snapshots — lost-update hazards.
Choice: `@libsql/client` + Drizzle libsql driver. Same SQLite dialect and migrations;
`file:` URL locally, `libsql://` Turso URL in the cloud; the whole data layer became
async. Trade-offs: every query is now awaited; one more hosted service (Turso free tier)
for cloud persistence. Revisit when: multi-tenant scale suggests Postgres.

## D13 — Flow v2: one investigation per business, structured profile (2026-10-27)
Context: the founder found the first flow hard to follow (research/analysis/pipeline as
three overlapping state machines, four jobs to click through) and the data noisy (a
flat list of regex hits). Choice: a single `investigate_business` job per business
(fetch → detect → one model call for profile + opportunities → score → verdict); a
fixed profile of ~27 comparable fields (`src/lib/profile/fields.ts`), each
verified-with-quote, not-found, or unknown; one `status` + one `verdict` on the
business; sales stages reduced to lead → qualified → contacted → … Deterministic
detection limited to precise signals (tools from resource hosts, contact channels,
booking method); the model fills the rest under quote grounding. Crawl: homepage + up
to 4 key pages fetched in parallel, 10 s timeouts. Measured: 3–8 s per real business
without AI (was 15–20 s). Trade-offs: a rewrite of the data layer and pages; profile
fields are a fixed vocabulary (extend in one file). Revisit when: real AI output shows
fields that are consistently empty or missing.

## D14 — Research engine v3: locate, footprint, detect, rules (2026-10-27)
Context: the founder asked for the best possible research algorithm with explicit
fallbacks and prioritization. The v2 engine dropped OSM entries without a website,
ranked chains like independents, relied on the (unconfigured) model for most facts and
only looked at the website itself.
Alternatives: paid enrichment APIs (Google Places details, Yelp, Clearbit-style) —
cost, caching restrictions, no evidence trail; headless-browser rendering — slow,
fragile; keyless search engines — DuckDuckGo's HTML endpoint answered automated queries
with a bot challenge in live checks.
Choice (docs/RESEARCH.md): lead score + chain detection before research; a website
finder (Brave Search when keyed, name-based domain guesses otherwise) that stores a URL
only after verifying the business phone or name + city on the page, also used when a
recorded site is dead; crawl fallbacks (root, scheme/www variants, sitemap); off-site
keyless records (RDAP year, DNS MX/SPF, Internet Archive first capture) in parallel with
the crawl; deterministic facts from resources, schema.org JSON-LD and main-content text
cues with explicit gaps; a rule engine that produces cautious hypotheses without a
model (weak gap-only rules capped); model hypotheses always kept when AI runs, rules
fill the rest (max 5). Measured on 12 real Austin shops: 1.3–9.4 s each, 7–22 verified
facts, 11/12 with a rule-based verdict, 1 dead site recovered via a verified guess;
0/5 no-website shops located without a search key.
Trade-offs: more moving parts per investigation (all optional and bounded); rule wording
is templated; chain lists need maintenance per industry. Revisit when: a Brave key is
configured (measure finder hit-rate), and when AI runs on real shops (compare rule vs
model hypotheses, retire rules the model consistently contradicts).

## D15 — Local SQLite: one connection per process, no multi-statement transactions (2026-10-27)
Context: with `@libsql/client` 0.18 a `file:` database is a pool of connections. The
driver's busy wait is synchronous, so when a job-claim transaction held the write lock
on one connection and a handler wrote on another, the handler's busy wait blocked the
event loop and the transaction could not commit until the wait failed (observed with
transaction tracing: 10.4 s, then SQLITE_BUSY). Per-connection PRAGMAs only reached one
pooled connection.
Alternatives: busy timeout in the client config (still blocks the loop); a single
connection with transactions (statements issued during a transaction are rejected);
retry wrappers around every statement.
Choice: `concurrency: 1` for local files; job claiming is a single atomic
`UPDATE … WHERE id IN (SELECT … LIMIT 1) RETURNING`; the investigation result is written
with `db.batch` (statements run back to back on the connection). Remote Turso keeps the
default client. Trade-offs: statements serialize per process (fine for one operator +
one worker); any future `db.transaction` on a local file must be avoided.
Revisit when: moving to Turso everywhere or to Postgres.

## D16 — Free improvements over paid APIs: Texas permit registry, template drafts (2026-10-27)
Context: the founder chose to proceed without paying for Google Places, Brave Search or
model calls. Choice: (1) the Texas Comptroller's Active Sales Tax Permit Holders open
dataset as a discovery provider (NAICS + city; names, addresses, permit dates; no
phone/website) — roughly double the map coverage for the pilot market and a verified
"permit since" fact; (2) template outreach drafts grounded in verified facts and gaps,
claim-mapped and validated like model drafts, so the funnel works end to end without a
key; (3) a keyless website finder that tries the business email domain, more name
variants with DNS pre-checks, and address-based verification for registry records.
Trade-offs: registry records need the finder or manual entry for a website; template
wording is fixed; Texas only (other states have similar registries to add later).
Revisit when: keys are approved (Brave for the finder, Anthropic for richer drafts).

## D17 — Overture Maps Places as the primary discovery source (2026-10-28)
Context: public Overpass mirrors timed out unpredictably (Denver, Phoenix) and map coverage
was thin (Austin: ~200 places, 94 with a website). Alternatives: paid place APIs (Google,
Foursquare, Yelp: cost, caching limits), self-hosted Overpass (operations), state registries
(no contact data, one state at a time).
Measured: Overture places (open data, CDLA-Permissive 2.0) read with DuckDB straight from the
public S3 release: Denver 8 km box 1,037 automotive places in 8.6 s, Austin city 1,624 in
3.9 s, Phoenix landscaping 173, Raleigh dental 297; listed businesses had websites, phones and
emails in every case; brand and open/closed fields come free.
Choice: `overture` provider (DuckDB `@duckdb/node-api`, httpfs over S3, per-area cache in
`place_cache`, 30-day TTL), default-selected; OpenStreetMap kept as a secondary net; Texas
registry as an extra; category mapping per playbook segment. Disabled on serverless hosts
(native binary, long-lived process) where OpenStreetMap remains.
Trade-offs: a native dependency; first query per area reads tens of MB; monthly releases need
`OVERTURE_RELEASE` bumps (the cache key includes the release). Revisit when: hosting moves to
serverless only, or a cheaper regional extract pipeline is set up.

## D18 — Headless-browser render as a bounded fallback (2026-10-28)
Static fetches miss JavaScript-only sites. Choice: when the static homepage has < 400 chars of
main text and the HTML is script-heavy, render it once in headless Chromium (Playwright, 15 s,
images/fonts/media blocked, SSRF rules applied to sub-requests, TLS errors ignored because only
public text is read), record `renderer=browser` on the page row; key pages are rendered only
when the homepage needed it. Local hosts only. Trade-offs: Chromium memory; a few seconds per
such site. Revisit when: a measured share of sites still yields thin text.

## D19 — "Insufficient evidence" is a verdict (2026-10-28)
When fewer than 5 facts about the business itself are verified (7 for a single-page site;
measured keys such as site health, dates and email hosting exist for nearly every reachable
site and do not count), the investigation says so instead of ranking hypotheses built on gaps. Rule patterns still run and are kept as
weak hypotheses, labeled. Why: a missing website feature is a reason to ask, not a finding;
the operator must see when the site simply did not show enough.

## D20 — Model providers behind one structured-output contract (2026-10-28)
Alternatives: Anthropic-only (status quo); an abstraction library (LangChain-style); separate
code paths per provider. Choice: a small `ModelProvider` interface (system, user, Zod schema,
effort → validated output, usage, stop reason) with two implementations: Anthropic via the SDK's
structured outputs, OpenAI via the Responses API over fetch with a strict JSON schema derived
from the same Zod schema. The shared client owns provider selection (`AI_PROVIDER` or the first
configured key), the spend guard, schema validation, cost accounting (`provider:model` in usage
rows) and refusal/truncation errors. Prompts, quote-grounding and citation validation are
unchanged and provider-independent. No key is required for anything else; mock outputs are
never shown as research. Revisit when: a key is available and both providers are measured on
the same shops.

## D21 — One table model for every list page (2026-10-28)
Alternatives: a client-side data grid library; per-page bespoke filters (status quo). Choice:
URL-param model (`q`, `sort`, `dir`, `page`, `pageSize`, `from`, `to`, `dateField`) parsed by
`src/lib/table.ts`, server-side filtering/sorting/paging in the queries, and shared server
components (`FilterBar`, `SortHeader`, `Pagination`, `TableEmpty`). Applied to businesses
(dates: discovered, investigated, updated), searches (created), search results (search within,
sort), pipeline (search, industry, demo). Why: links are shareable, no client state, consistent
behavior, works at thousands of rows. Date pickers only where a date has a practical meaning.

## D22 — A System page for jobs and source health (2026-10-28)
Jobs were invisible outside counts. Choice: `/system` lists recent jobs with status, attempts,
timing, outcome and retry/cancel; source health aggregates each discovery provider's runs,
failures, candidates and average time over recent searches; worker status and capabilities at
a glance. Settings stays configuration-only.
