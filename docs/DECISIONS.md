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

## D23 — Firecrawl is the only page fetcher (2026-10-28)
Founder decision: replace the in-house crawler (undici fetcher, cheerio link discovery,
Playwright render fallback, sitemap reader) with Firecrawl. Supersedes D18. Choice: a thin REST
v2 client over `fetch` (no SDK: fewer dependencies, injectable transport, full control over the
limiter and retries), single `/scrape` calls with `markdown`, `rawHtml` and `links` (batch scrape
shares the free plan's 2/min crawl limit, single scrapes get 10/min), `/map` only when the
homepage exposes almost no links, raw HTML stored so detectors rerun for free, a monthly credit
budget, robots.txt and the URL guard kept on our side. Extraction (cheerio over the returned
HTML) and the rule/model layers are unchanged. Why not keep a fallback crawler: one scraping
path is simpler to reason about and the founder asked for no duplicate systems. Cost: website
research now needs an account and a key; the free plan covers ~150–200 businesses a month and a
self-hosted instance removes the limit.

## D24 — Search engine v2: cells, candidates, taxonomy, worldwide (2026-10-28)
Context: discovery queried sources per search (no reuse), the form was US-only, categories were
hand-listed per provider, results were written straight into businesses, and planned sources had no
place in the interface. Choices: (1) a provider registry with explicit status (active / internal /
future) enforced on the backend: only Overture and OpenStreetMap are offered, demo data is internal
(seeded, tests), and the Texas sales tax permit registry was removed the same day at the founder's
request (Texas-only, no phone or website, superseded by Overture's coverage); (2) one engine that resolves the area once, isolates each source,
merges with named rules and confidence, filters with counts, ranks, stores candidates with every
source, and saves on request or automatically; (3) a local copy of every fetched record on a 0.2°
grid (`source_places`, `source_cells`) so repeated and adjacent searches run locally and refresh
monthly or on a new release, with Overture's latest release discovered from its STAC catalog;
(4) a taxonomy layer that targets Overture hierarchy nodes with exclusions (verified against the
live data) and re-matches stored OSM tags locally; (5) bundled worldwide places/regions/countries
(GeoNames) for the form and radius centers, structured geocoding with sanity checks for whole-city
boundaries, metro-radius fallback otherwise; (6) a candidates table between sources and businesses
so the operator can review before saving and duplicates already saved are visible. Rejected:
importing whole countries (gigabytes, no need), a geospatial extension (bbox + cell indexes are
enough at this scale), free-text geocoding (measured wrong answers). Google Places moved to
"future" by the founder's brief: never executed even with a key.

## D25 — Google Maps (via SerpApi) is the only discovery source (2026-10-28)
Context: after the search engine v2 live checks the founder chose Google Maps listings as the
single source of truth for prospecting and asked for the database to be wiped and the other
sources dropped. SerpApi's Google Maps engine (free plan: 250 searches/month, 50/hour, one search =
one page of 20 listings) returns name, category, address, phone, website, rating, reviews, hours
and closed status with no card on file; the official Places API (5,000 free Text Search calls)
needs a billing account and restricts caching to 30 days. Choices: (1) `google_maps` provider
(`src/lib/discovery/google-maps.ts`) is the only `active` source; Overture and OpenStreetMap are
`disabled` (code, tests and cell cache kept; never offered, refused by the engine), the Google
Places adapter is deleted; (2) every page is counted in `provider_usage` and refused once
`SERPAPI_MONTHLY_SEARCH_BUDGET` is reached, and cached in `provider_cache` for
`SERPAPI_CACHE_DAYS` so repeats are free; (3) the map position comes from the bundled place list
(radius, or a population-based metro radius for a whole city), so no geocoder call is made;
(4) listings outside the radius are dropped and counted, since Google does not honour the area
strictly; (5) one query per chosen sub-type, the industry query otherwise, the free text for
"Other business type", at most `SERPAPI_MAX_PAGES` pages each. Known limits: scraped data via a
third party (SerpApi's legal shield applies to paid plans only); 250 searches ≈ 5,000 listings a
month; Google's relevance ranking decides what the first pages contain. Rejected: keeping Overture
and OpenStreetMap as fallbacks (founder: one source only), the official Places API (card required).


## D26 — No demo data in the product (2026-10-29)
Demo data was removed entirely at the founder's request: no demo provider, no seed, no
"Load demo data", no automatic seeding on serverless hosts, no `is_demo` columns, badges
or filters. The product only ever shows businesses the operator found or imported.
Synthetic records live only in the test fixture (`tests/fixtures/seed.ts`) and never
reach a product database. Consequence: a Vercel deployment without Turso starts empty.

## D27 — Google Maps through Serper instead of SerpApi (2026-10-29)
The founder chose Serper (serper.dev) as the transport for Google Maps listings: 2,500 free
credits on sign-up without a card (SerpApi: 250 searches a month), 3 credits per page of 20 (measured live), the same
listing fields (name, category, address, phone, website, coordinates, rating, reviews, place id).
The provider key stays `google_maps`; only the transport, the env keys (`SERPER_*`) and the budget
model changed: the budget is a total (`SERPER_CREDIT_BUDGET`, default 2,500) because the free
credits do not renew, tracked across all periods in `provider_usage`. Lost: Serper's maps results
carry no open/closed state. Not yet exercised live: the founder adds `SERPER_API_KEY` to `.env`.

---

# 2026-11-12: from research tool to business development platform

The founder asked for an automated platform: discover, research deeply, consolidate into one
opportunity, write a personal email, review a campaign, send with one button, track replies, keep
a simple pipeline. D28 to D36 are the decisions of that rebuild. Where they contradict earlier
entries (D4, D5, D9, D13, D14, D16, D19), these win.

## D28 — One consolidated opportunity per business, produced inside the research call
Alternatives: a separate consolidation job or model call; a table of opportunity groups; keeping
several hypotheses and letting the operator pick. Choice: the single research call returns one
primary opportunity made of components that each cite evidence, plus at most two independent
secondary ideas; code drops components and ideas that cite nothing established; rows keep a
`role`. Why: the model already has the full context, a second call adds cost and a second way to
fail, and the measured data showed the old output splitting one idea into three (70 hypotheses for
18 businesses). Trade-off: existing research has to be re-analyzed to get the new shape.

## D29 — The model's "no" is final; rule patterns are inputs, not parallel results
Measured: 4 of 17 businesses marked "opportunity" were ones the model had rejected (a company with
20,000 reviews on ServiceTitan, a pay-per-call lead page) because any matching rule pattern
overrode it. Choice: matched patterns are passed to the model as candidates; when the model runs,
nothing rule-based is stored beside its answer; without a model the patterns are grouped into one
idea in code and the business can only reach "needs review".

## D30 — Qualification in code, with five outcomes in one field
`businesses.verdict` is now qualified | needs_review | not_a_fit | insufficient_evidence |
no_contact, with reasons in plain sentences. Qualified needs a model opportunity backed by at
least two verified observations, confidence of 60 or more, and no contradiction with a verified
fact. Things not found on a website never count as evidence. Contact quality left the
attractiveness score (it is a gate before outreach, not a property of the idea) and the "buying
readiness" guess was removed (nothing on a website verifies it). Lead scores now use the listing's
review count, because every listing with a website and a phone had the same score.

## D31 — Research stops after two pages when there is no public email
Six of 19 businesses had no public email. Choice: read the homepage and contact page first; without
a business email on either, stop (outcome `no_contact`, 2 credits, no model call). The operator can
add an address and research continues. Switch: `RESEARCH_REQUIRE_EMAIL`. Trade-off: an address
published only on a third page is missed.

## D32 — Free-form observations beside the fixed profile fields
The 35 profile fields were shaped by auto repair and home services and had no place for portals,
payments or quote processes. Choice: keep the fields (they drive rules, lists and comparison) and
add up to ten model-written observations per business (offering, process, capability, limitation),
each rejected unless its quote is verbatim on the cited page. A limitation must be something a page
states; an absence is a gap, never an observation. New detected fields: customer portal, online
payments, service area, team size, contact person.

## D33 — Emails: evidence pack, fixed checks, an independent claim check, signature in code
The old validator trusted the writer's own list of claims and only warned. A stored draft stated a
"27.7 second" load time that was really the crawler's fetch time. Choice: the writer sees only an
evidence pack (verified content with the business's words; no measurements); fixed checks read the
text; a second call that did not write the email marks every statement about the business as
supported, a question, or unsupported; any failure forces one rewrite, then "needs review". The
signature, postal address and opt-out line come from Settings and are appended by code. Template
emails and the three styles were removed: one voice, set once. Fetch time is no longer recorded as
a fact.

## D34 — Mailbox over SMTP and IMAP with an app password
Alternatives: Gmail API, Microsoft Graph, a transactional email service. The service was ruled out
first: their terms generally prohibit unsolicited outreach, mail would not come from the
operator's mailbox, and delivery events need a public webhook this local app does not have. Between
the mailbox options, the founder's provider was not known, so the choice is the one that works with
almost any mailbox and needs three lines of configuration: SMTP to send, IMAP to read replies and
to check the Sent folder. Behind a small `MailProvider` interface with an in-memory implementation
for tests. Limits: no delivery receipts beyond "accepted" and bounces; Microsoft 365 tenants often
disable app passwords (a Graph adapter would fit the same interface); no open tracking, by choice.

## D35 — One button, paced sending, at most once
"Send approved emails" queues one job per email at planned times (pause between sends, sending
hours, daily cap) instead of sending a burst. Each email has its Message-ID before the first
attempt; queued → sending is one atomic statement; an attempt without a known outcome is looked up
in the Sent folder and otherwise handed to the operator. Never re-sent on a guess: at-most-once by
construction, with a human decision for the rare unknown. Recipient checks (valid, allowed country,
not suppressed, never emailed before, no duplicate) run when written, approved, summarized and sent.

## D36 — Simpler product surface
Five navigation items (Dashboard, Businesses, Outreach, Pipeline, Settings). Ten pipeline stages in
one field; the board shows Qualified onward and counts the two machine stages. Batches ("campaigns")
are not managed: one is open, sending closes it. Replies are answered from the operator's own mail
program; the app suggests an answer and keeps the conversation. Removed: the Patterns page and
validation signals (no signal had ever been recorded), the Overture and OpenStreetMap providers and
the DuckDB dependency (disabled since D25), template drafts, outreach styles. Operator settings
moved to a `settings` table; secrets stay in `.env`. The AI limit became monthly. A scheduler in the
worker does inbox sync, follow-up drafts, auto-drafting and auto-research; it never sends and never
starts a search.

## D37 — One screen per question, counts shown once (2026-11-18)
The founder asked for the simplest, most visible and best organised interface, with everything in
one place. Before changing anything every page was screenshotted and compared against published
guidance on CRM dashboards, dashboards in general and settings pages. That guidance is mostly
practitioner writing, not controlled research, but it agrees on four points that were applied:
start from "what should I do now", keep the top level to a handful of numbers, reveal detail on
request, and group settings by subject. What changed: the dashboard leads with what is waiting and
shows the funnel as one strip plus this month's use; the sidebar carries a count per section and
one line of setup status; Businesses has one row of views and five columns; the business page opens
on an Overview (what they do, the verdict, the one idea) and no longer lists what was not found
among the facts; Outreach lost its tiles because the tabs already count; the pipeline board is
shorter and its history is collapsed; Settings is five tabs. Nothing was removed from what the
operator can do. Details in docs/DESIGN.md.

## D38 — Research that fits any business, proposals an owner recognises, shorter and warmer emails (2026-11-18)
The founder asked for a review of the whole chain from crawl to email, aiming at attractive, very
friendly, not too detailed emails that propose a solution. Four weaknesses were found in the code
and fixed. (1) Page selection was tuned to car repair: a quote page, a "how it works" page, forms,
job ads, "products" or "practice areas" were classed as "other" and never read. The page kinds are
now industry-neutral, and the budget is 6 pages instead of 5 (about one more Firecrawl credit per
researched business). (2) The model read pages in crawl order, so the contact page, fetched first
for the email probe, could push the services page out of the text budget; pages are now ordered by
how much they explain the business and the contact page is capped. (3) The research prompt
(research-3) now states what makes a proposal worth sending (a problem the owner would recognise,
who uses it, a small first version, working with what they have, never a category) and asks for the
idea in plain words. (4) The email prompt (outreach-3) asks for 70 to 120 words instead of 100 to
160, a genuine specific opening, one line on who is writing, the idea in everyday words with at
most one example and no list of parts, and an invitation that can be answered with a reply. The
fixed length check moved with it (soft range 65 to 125 words). The evidence rules did not change:
nothing unobserved may be stated, and absences may only be asked about.

Verified live the same day on three metal fabrication firms near Birmingham (UK), researched first
with the old logic and then with the new one on a fresh crawl. Old: titles such as "Structured
bespoke-fabrication quote intake and job tracker", emails of 130 to 150 words that listed every
part of the solution. New: titles such as "Quote requests that arrive with everything needed to
price them", solutions described as a first version plus what it could grow into, emails of 90 to
110 words with one idea, one question and "a 15-minute call, or just reply here". All statements in
the six emails were marked supported or phrased as questions by the independent check; one was
verified by hand against the stored page text. One weakness showed: all three new emails used the
same sentence to introduce the sender. The writer is now told to word it afresh and is shown how
the other emails in the batch did it, and a fixed check remarks on any sentence repeated word for
word within a batch (outreach-4; this last tweak has not been run live). Measured cost with the new
logic: research $0.15 and 5 Firecrawl credits per business, an email $0.05 including its check.

The founder chose Europe over the US. The UK was added to the allowed countries because its
regulator (ICO) states that the email marketing rule does not apply to corporate subscribers
(companies, LLPs), provided the sender is identified and an opt-out is offered; sole traders and
ordinary partnerships are treated as individuals and need consent. The app does not yet check the
legal form of a business, so that is the operator's check before approving a UK email. Germany and
other countries that require consent between businesses were not added.

Later the same day the founder asked that an email never call the recipient a small firm or a local
business, because it can read as a slight, and that the voice be as warm and approachable as
possible. The writer is now told so (outreach-5), the research pitch may not remark on size
(research-4), a fixed check blocks "small/local business, firm, shop ..." unless those are the
business's own words, and the default description of the sender no longer names who they work for.
The four waiting emails were rewritten live under these rules: none mentions size, each introduces
the sender differently, and each closes by wishing the business well.

## D39 — A wider range of solutions, and the operator chooses which idea to raise (2026-11-18)
In the live test all four ideas were the same one: a better quote request form with follow-up. The
founder asked to offer different software solutions, things a company needs, and not only
improvements to features it already has; and to define this properly before spending anything.
Cause: the research was told to tie an idea to something on the pages, and what a website shows
best is its own enquiry form. Definition, in code (`src/lib/industries/index.ts`):
- A catalogue of sixteen families of solution (`OPPORTUNITY_CATEGORIES`, `SOLUTION_GUIDE`), each
  with what it does in plain words and the signals that make it worth considering. Three were
  added: job and production tracking, planning people, visits and deliveries, and AI help with
  routine questions and documents. Labels are no longer tied to car repair.
- Three kinds of idea (`SOLUTION_SCOPES`, stored as `opportunities.scope`): it improves something
  they already offer; it is something new for their customers; it is a tool for the team.
- The research prompt (research-5) shows the whole catalogue, tells the model to choose the main
  idea by what it would be worth to the business and not by how easy it is to quote, not to default
  to the enquiry form, and to add up to two alternatives of a different family and, where the
  evidence allows, a different kind.
- Evidence rules are unchanged and one was added: every idea cites verified facts about the
  business; an alternative with fewer than two verified facts is dropped in code; a website cannot
  show how a company runs inside, so ideas of the second and third kind are put to the owner as a
  question (the writer is told which kind it has, outreach-6).
- On the business page the operator can press "Raise this idea instead" on an alternative: it
  becomes the idea outreach is built on, the unsent email about the previous one is withdrawn and a
  new one is written. Once a first email is out the choice is locked.
Not run against the live model: this was defined and tested offline only, at the founder's request.

Run live the same day on the four businesses from stored pages ($0.81 of AI, no credits). The main
idea stayed the quote request in all four (the model rates it highest), but each business gained
one or two real alternatives of another kind: a job board from cutting to installation, test
certificates matched to orders, an offcuts list customers can browse, tracking of work sent to
partners. The founder then decided three things, built without further spend (outreach-7, not yet
run live): (1) the email keeps one main idea and may mention one alternative in a single short
line; (2) subjects must earn the open: two to five words, about the company's own thing or a short
honest question, sentence or lower case, no advert words, never a fake reply; a fixed check blocks
advert words and fake "Re:" and remarks on long subjects; (3) every email greets the company
("Hi Acme Steel team,"), never a person named on a website, and no person is named anywhere in the
email. The four waiting emails had their subject and greeting corrected by hand.

## D40 — Removing a business for good, and one period control (2026-11-18)
The founder asked to remove businesses that are not a fit while making sure a later search does not
bring them back, and for a date filter on the Dashboard and the Businesses list, friendly, with the
last 7 days as the default.
- Removal (`src/lib/pipeline/removed.ts`): the business and everything researched about it is
  deleted and a small record stays in `removed_businesses` (name, city, website domain, phone,
  listing ids). Discovery and CSV import check that record first and leave a match out, counted on
  the search page. A business that was already emailed is not removable (the record of the email,
  replies and opt-outs must stay): it goes to Lost instead. Removed businesses are listed under
  Settings → Do not contact, where one can be allowed again. A hidden flag on the business row was
  rejected: every list, count and job would have had to remember to skip it.
- Period (`src/lib/date-range.ts`, `src/components/date-range.tsx`): one dropdown (Today,
  Yesterday, Last 7 days, Last 30 days, This month, Last month, This year, All time, Custom dates)
  that applies as soon as it is picked; with nothing chosen it is the last 7 days. On the
  Dashboard it scopes the funnel, each step counted by the date it happened; "Waiting for you" and
  "This month" always show the present. On the Businesses list it scopes the list and the view
  counts by the date found (or researched, or updated). Links that point at specific work
  ("businesses to judge", the pipeline counters) open the list on All time so nothing is hidden.

## D41 — Pipeline with a period and a full history; one dialog; other subjects on request (2026-11-18)
- Pipeline (`src/app/pipeline/page.tsx`): two views that share the period dropdown. *Board*: the
  cards that moved in the period (the last 7 days by default), at most twelve per column with a link
  to the rest, each card showing when it last moved and whether a reply is waiting; a line says how
  many businesses are on the board from before the period, with "Show all time". *History*
  (`pipelineHistory`): every recorded event of the process across all businesses, by day, with a
  filter by kind (stage moves; emails, calls and notes; research and system) and a search. It
  replaces the collapsed "move history", which only listed stage changes.
- Removing is also possible from each row of the Businesses table.
- Confirmations (`src/components/confirm-button.tsx`): the browser's own pop-up is replaced by one
  dialog used everywhere: the question as the title, what will happen below it, Cancel and a
  clearly named action, red when the action deletes or stops something.
- "A different subject" on the email review page: on request, one small model call suggests other
  subjects for the email as written (`suggestSubjects`); only suggestions that pass the fixed
  subject checks and were not tried before are offered, and choosing one changes the subject only.

## D42 — A smaller ask, a shorter opening, and a main idea that varies (2026-11-19)
The first eight real emails all had the same shape: two sentences repeating the company's website
back to it, an idea that in seven of eight cases was "a better enquiry form", a question, and an
offer of a 15-minute call. The founder chose three changes; no model was called to make them.
- One small ask (outreach-8): a first email ends with exactly one question, the offer to send a
  short mock-up of the idea for their company. No call, no second question, nothing after it. The
  founder makes the mock-up when someone says yes. Fixed checks: a first email without a question
  is held back; several questions or a proposed call are remarks. A follow-up may still offer a
  call and use the booking link.
- Shorter: the opening is one sentence about one thing (20 words at most; a remark above 22), and
  the body is 60 to 90 words, up to 100 with the one-line second idea (remarks outside 55 to 100,
  held back outside 40 to 125).
- Varied ideas (research-6): collecting more details in the enquiry or quote form may be the main
  idea only when a page itself states the trouble, or when no internal or new-for-customers idea
  meets the bar; otherwise it is at most an alternative. This applies to research run from now on;
  businesses already researched keep their ideas (the operator can still pick the alternative with
  "Raise this idea instead").

## D43 — Shorter still, one idea per email, and the company's own name (2026-11-19)
The first three emails in the D42 shape (forklift training providers, Manchester) were 90 to 106
words; the founder found them too detailed and left the shape to us.
- Four parts, 40 to 60 words (outreach-9): greeting, one sentence on one thing noticed (18 words
  at most), who is writing plus the idea as a gain only (no how, no options, no examples), and the
  mock-up question (15 words at most). Fixed checks: remarks outside 35 to 65 words, held back
  outside 25 to 85; opening sentence remark above 20 words.
- One idea per email. The one-line mention of a second idea (D39) is dropped from the first email:
  it added a second topic and a dozen words. The alternative idea is handed to the follow-up
  instead, where it can be the new angle. Follow-ups are 30 to 55 words.
- The company's own name (`src/lib/outreach/company-name.ts`): a map listing may carry a branch
  ("… - Leeds North") or be a search phrase ("Forklift Training"). The branch is dropped;
  and when the listing name does not match the web address but the site states a registered
  company name that does, that name is used. Decided in code from stored pages, no model call.
  Rejected: a new research field for the name, which would have meant paying to research again.

## D44 — Subjects: clear at a glance, about their gain, capital first letter (2026-11-19)
The founder liked the short emails and asked for subjects that catch the eye and start with a
capital letter. Subject rules (shared by the writer and "Suggest", outreach-10): 2 to 5 words,
sentence case with a capital first letter, clear to someone who has not read the email (no
compressed phrases such as "proof to fitted"), about them and what they would gain, as a short
honest question or a plain statement. The capital is not left to the model: `capitalizeSubject`
applies it to every written and suggested subject, and a subject typed in lower case by the
operator gets a remark. Advert words, fake "Re:" and duplicates within a batch stay blocked.

## D45 — A look of its own: airmail (2026-11-19)
The founder asked for the whole design to be reworked for ease of use, using the frontend-design
skill (installed under `.claude/skills/frontend-design`, Apache 2.0, read before use). The
structure of the screens (D37 to D41) stays; the look and the sizes change, all through the shared
stylesheet (`src/app/globals.css`) and the shared components, so every screen follows.
- Subject: a one-person desk for letters that travel from Skopje to companies abroad. Palette
  "airmail": cool letter paper, navy ink, airmail blue for every action, postmark green for done;
  the red of an airmail edge appears only in the striped band at the top of the app. Light and
  dark.
- Type: Avenir Next (with system fallbacks) for everything operated, Charter for page titles and
  for the email itself, which is shown and edited as a letter. No font is downloaded.
- Easier to read and hit: the root size is 106% so text and controls grow together, the smallest
  text is 12px and up, buttons and fields are taller, field labels and table headings are in
  sentence case (no capitals), muted text has more contrast, cards are flat.
- Rejected: the bold options the skill warns about as defaults (cream with a serif and terracotta,
  near-black with one acid accent, newspaper columns) and any change to where things are.

## D46 — Screens reorganised: full width, a header on every list, tables as cards on a phone (2026-11-19)
Asked for page by page by the founder, each checked on screen at laptop and phone width.
- Pipeline board: a strip names every stage with its count, in the order a conversation moves.
  Below it the six working stages are full columns in two rows of three, with Won and Lost
  underneath. Every card is shown (a long stage scrolls inside its column): the earlier limit of
  twelve looked like lost businesses. On a phone one stage is shown at a time, chosen from the
  strip. A layout that folded empty stages into narrow strips was tried and rejected by the
  founder the same day. The counters for "Discovered" and "Researching" were removed.
- History: one line per event (time, kind, business, what happened); also used on the dashboard
  and on a business's Activity tab.
- Dashboard: the next step as one sentence and one button; four figures; the path from found to
  won with the share kept at every step and a separate bar per step; replies and planned actions
  only when there are any; the latest events. Businesses that are found but not researched count
  as a next step. No row leaves part of the width empty.
- Businesses and Outreach: search and period on one line; the table has a header with the count,
  what the list is and the action for all of it. The send button shows only when something is
  approved.
- Settings: every tab uses the full width; the signature is its own card; removed businesses are
  a table with a search and pages of twenty.
- Every table (`.table`) becomes a list of cards below 768px.

## D47 — Pipeline board: stage tiles on top, only stages with work below (2026-11-19)
Investigated on the founder's request for a board that shows what is going on. Found: most stages
are empty most of the time, so a column per stage wasted the screen; a long stage scrolled inside
a box; dropping on a far stage meant scrolling while dragging; and an emailed business could be
dragged back to "Qualified". The board is now (`src/app/pipeline/board.tsx`):
- A row of eight stage tiles with counts that stays in view while the page scrolls. A card is
  dropped on a tile to move it; clicking a tile shows only that stage.
- Below, one section per stage that holds businesses, cards in a grid across the full width; every
  card is on the page. Each card says in plain words what is going on and for how long ("Waiting
  for a reply · 22h").
- A card changes place only when it is dropped, never while carried. A business that was emailed
  cannot go back to a stage before the email; the board says so.
This replaces the columns of D46.

## D48 — Pipeline board as columns, the way Jira and Azure Boards do it (2026-11-19)
The founder kept the drag-and-drop logic of D47 and asked for the layout of the boards people know.
Every stage is a column, all eight side by side in one row in the order a conversation moves, the
outcomes last; a column has a header with the name and the count and holds its cards one under
another; all columns have the same width and height, so an empty one is a clear place to drop. The
row scrolls sideways when the window is narrower than the board, and by itself while a card is
carried to its edge; on a phone the columns are swiped one at a time. A card gives the whole width
to the company name, then the city, what is going on and for how long, and the score. A card
carried over another column steps in at the spot under the pointer; dropped there it keeps that
place, dropped on the empty part of a column it goes to the end. The stage tiles and sections of
D47 are gone; its rules stay (nothing moves until dropped on a stage, an emailed business cannot
go back before the email, a drop outside every stage changes nothing).

## D49 — Accounts, a public front page, and what a new account may see (2026-11-19)
The founder wants to open the product to paying users. Stage 1 of three, built now:
- Accounts (`users`, `sessions`; `src/lib/auth/`). Passwords are stored as scrypt hashes with a
  random salt. A session is a database row and an http-only cookie "<id>.<role>.<signature>",
  signed with `AUTH_SECRET` (HMAC-SHA256).
- One guard for every request (`src/proxy.ts`): without a validly signed cookie only "/", "/login"
  and "/signup" can be read; everything else, including API routes and form posts, redirects to
  the sign-in page. Every workspace action also starts with `requireOwner()`, which checks the
  session in the database.
- The workspace still holds one set of data (one mailbox, one list of businesses). So the first
  account is the **owner** and works in it; every account created through the sign-up page is a
  **member** and is kept on a welcome page ("your workspace is not open yet"). Rejected: letting
  new accounts into the existing workspace, which would have shown them the founder's businesses
  and let them send from the founder's mailbox.
- "/" is the landing page for a visitor and the dashboard for the owner. The landing page makes
  no claim that is not true of the product: no customer quotes, numbers or prices.
- Sign-in attempts are limited per email address; a wrong email and a wrong password get the same
  answer. Accounts can also be created with `scripts/create-user.ts`.
Stage 2 (not built): a workspace per user, which means a user on every table and a mailbox per
user. Stage 3 (not built): plans and payments.


## D50 — The app may run on its own: searching, a longer sequence, answers, and sending without a click (2026-11-20)
The founder asked for "fully automated software for finding clients". Three steps still needed a person:
starting a search, approving and sending, and answering replies. Each now has an automatic path, and
every one of them is **off until the operator switches it on** in Settings. The defaults behave as before.

- **Who presses Send** (`sendMode`: manual | hold | auto; `src/lib/outreach/autopilot.ts`). "hold" sends a
  checked email once it has waited `holdHours` since it was written or last edited; "auto" sends it at
  the next scheduler run. The autopilot uses the operator's own road (approve, then "Send approved" for
  the open batch), so pacing, the daily limit, the send-time recipient check and at-most-once sending
  are untouched. Guards, all in code:
  - only emails whose checks ALL passed (`ready`); `needs_review` always waits for a person;
  - not before the operator has sent 20 emails by hand (`approved_by` records who approved);
  - a UK business whose name and pages show no legal form (Ltd, LLP, a company number) waits for the
    operator: sole traders need consent (`automaticSendHold`);
  - a daily limit that starts at 10 and rises by 5 a week up to the operator's number (`limits.ts`);
  - a pause the app sets itself when ≥2 and ≥5% of the last 50 emails bounced or led to an opt-out, or
    3 sends failed in a day, and when the operator presses "Stop sending". Only the operator resumes.
  Rejected: a per-business-type trust count (more state than one operator needs) and a daily summary
  email to the operator (the Outreach page shows what goes out and when).
- **Sequence** (`steps.ts`): first email (0), follow-up (1), last note (2), then nothing. `followUpCount`
  chooses 0, 1 or 2. A reply ends it: unsent steps are withdrawn and a queued one is refused at send
  time. An automatic reply postpones the next step by a week (`prospects.hold_until`).
- **"Not now"** sets `prospects.recontact_at` (`recontactDays`, default 90); one check-back (step 3) is
  written when it comes due.
- **Answers** (`answers.ts`): when a reply is read and an answer makes sense, the suggested answer
  becomes an email of its own (step 9) in the same thread, to the person who wrote, without the opt-out
  line. It is reviewed and sent like any email, which also records what was answered. On its own
  (`autoAnswer`) only an answer that needs no decision may go: a booking link for a meeting request, a
  "noted" for "not now". "Yes, send it", a question, a referral, a doubtful reading, a reply matched by
  address only, and a third answer in one conversation always wait for the operator.
- **Searching** (`discovery/auto-search.ts`): the operator lists targets ("sign makers | GB"); when
  fewer than a day's research is in stock, the scheduler starts one search in the largest city of the
  least-searched target that has not been searched for that kind of business. One page (20 listings,
  3 credits), at most `searchesPerDay`, never beyond the credit budget.
- The fixed checks for sending domains (`email/domain-health.ts`) read SPF and DMARC from public DNS
  when the operator checks the mailbox connection.

What this does not do: build the mock-up a "yes" asks for, write to a person a reply refers to, or
check a company register. Those answers wait for the operator.

## D51 — No country limit on emailing by default (2026-11-20)
The founder: "we should be able to send to every kind of business a proposition". The allowed-countries
list (default US, later US and GB) blocked every email to a business elsewhere. It is now empty by
default, which means every country; the founder's own setting was emptied too. The setting stays as an
optional limit ("Only email these countries") for an operator who wants one, and the search form only
warns when such a limit is set. Accepted risk, stated to the founder beforehand: several countries
(Germany and much of the EU, Canada) require consent before unasked-for business email, and the sender
is responsible. Unchanged: the opt-out line, the do-not-contact list, never the same address twice,
and the rule that automatic sending leaves a UK business that does not show it is a company to the operator.

## D52 — The search form reworked, and a search reads only the pages it needs (2026-11-20)
- **Pricing fix.** A search used to read every page allowed (3 pages, 9 credits) whatever number of
  businesses was asked for. It now reads `ceil(asked / 20)` pages, at most `SERPER_MAX_PAGES`
  (`pagesForResults` in `src/lib/search-cost.ts`, used by the provider and the estimate alike): 20
  businesses cost 3 credits. The credits do not renew, so this triples what they buy. Trade-off: the
  best 20 are picked from 20 listings, not from 60.
- **Likely cost beside the ceiling.** The estimate shows "likely" (businesses without a public email
  cost no AI; only the ones that qualify get an email, from the workspace's own outcomes once there
  are ten) and "at most" (every one researched and written to).
- **Kind of business:** ideas by field, suggestions while typing, and a long list of types
  (`src/lib/business-kinds.ts`). The search passes words to Google Maps; the list is a guide.
- **Where:** the city is picked first and brings its region; largest cities as shortcuts; cities
  already searched for the same kind are marked; the same search can run in up to nine more cities
  at once, each a search of its own (`extraCityRuns`).
- **Which ones:** minimum review count and rating (`filters.minReviews`, `filters.minRating`;
  a listing without the figure does not pass a limit).
- **After the search** is one choice of three: show the list, save, save and research.

## D53 — Nothing is forgotten: planned next actions for every business, and a To do page (2026-11-20)
The founder: "follow up on every business … much more organized". Until now a next action existed only
when a reply arrived or the operator typed one.
- **Rules in one place** (`plannedAction` in `src/lib/pipeline/follow-up.ts`, pure and tested): a reply to
  answer comes first; then an email waiting for a decision (failed send, needs a look, to review, to
  send); then a check-in for the stages set by hand (meeting scheduled, proposal sent, replied); then
  the sequence ("the follow-up is written on this day", and after the last email "call them or close
  as lost"); then research that needs a person (failed, no website, needs review, no email). A business
  that was only found, or is won or lost, has none.
- **Applied by `planFollowUps`**: by the scheduler every minute and when the dashboard or the To do
  page opens. It costs nothing and sends nothing. `prospects.next_action_key` says which rule planned an
  action (null = the operator's own, never replaced); `next_action_done` remembers the one the operator
  ticked off so it does not come back; an action whose key is unchanged is left alone, so a pushed-back
  date stays. `prospects.updated_at` is not touched (migration `0019_follow_up`).
- **To do page** (`/todo`, `src/lib/pipeline/todo.ts`): every open action in groups (overdue, today,
  tomorrow, this week, later, no date), filtered by group, by kind of work (replies, my own, emails,
  decisions, follow-ups, waiting) and by high priority; inside a day the kind decides the order. A row
  opens where the work is done (an email action opens that email), is ticked off with "Done" or moved
  with "Later". The sidebar shows how many are due today or overdue; the dashboard shows the five most
  pressing and links to the rest; the Businesses table shows the due tag under the stage.
- **Due dates in words** (`src/lib/due.ts`), counted in whole days: "Today", never "overdue by seconds".
- Checked with 43 actions on a private copy of the data (keys blanked, nothing spent): that is what
  showed the dashboard list hid most of them, which is why the page exists.
- Also this day: the business page rebuilt as a header (score, contact, journey from found to won),
  three work steps (research, idea, email) and a right column (stage and next action, short history,
  where it came from); one typeface (Inter); the Businesses table as data columns that always fit.

## D54 — Settings as a menu of eight sections (2026-11-20)
The five tabs had grown long and mixed things (the mailbox with sending limits; automatic sending with
searching, research and budgets). Settings is now a side menu in four groups, each section about one
thing and saved on its own: You (Your details, Mailbox), Sending (Sending limits, Automatic sending),
Automation (Finding and research, Budget and usage), Safety and setup (Do not contact, Connections).
"Sending limits" is grouped into how much and when, what happens when nobody answers, and where. The
monthly AI budget moved beside the usage figures it limits. On a phone the menu is one row that scrolls.
`src/lib/settings-nav.ts` maps every section id to its menu entry; links go through `settingsHref`.

## D55 — The signature is the operator's own text, and nothing is added after it (2026-11-20)
The founder asked for an editable signature and then for the sentence the app added after it
("If this isn't relevant, just reply "no thanks" and I won't write again.") to be removed.
- `settings.signature`: the operator's own text, used as written. Empty = built from name, title,
  company, website and address as before. Saving the pre-filled box unchanged keeps it automatic;
  "Use my details" goes back to it.
- No opt-out sentence is appended any more. `settings.optOutLine` stays in the code (empty by default,
  no field) for an operator who wants one; it can also simply be typed into the signature.
- Unchanged: a reply that asks not to be contacted, in any words, is recognised and the address is
  never written to again; bounced addresses are suppressed; the `List-Unsubscribe` header is still set.
- Accepted risk, stated to the founder: US and UK rules for unasked-for business email expect each
  message to say how to opt out. The landing page, privacy page and acceptable-use page no longer
  claim that every email says so.

## D56 — Every workspace connects its own mailbox, and has its own settings (2026-11-20)

**Context.** One mailbox, set in `.env`, belonged to the first workspace; settings (sender
name, signature, limits, switches) were one global set. Nobody but the founder could send,
and a second sender would have signed with the founder's name.

**Decision.**
- A `mailboxes` table, one row per workspace: provider (a preset or `custom`), address,
  sign-in name, servers and an **app password stored encrypted** (AES-256-GCM, key derived
  from `MAILBOX_SECRET`, else `AUTH_SECRET`; `src/lib/secret-box.ts`). The password never
  reaches the browser again. A value that does not decrypt disables the mailbox ("connect
  again"); it is never tried with something else.
- Connecting (Settings, Mailbox) signs in to both servers first and saves only when that
  works. Custom server names must resolve to public addresses and use mail ports, so the
  form cannot be used to reach machines inside our own network.
- The `.env` mailbox stays as the first workspace's fallback until it connects its own.
- `settings` is keyed by workspace and key. Code that runs without a workspace (scripts,
  the scheduler's own state) acts as the first workspace, as before.
- The scheduler reads the inbox and runs sending-on-its-own for every workspace that has
  a mailbox, each inside its own workspace.

**Several mailboxes (same day).** A workspace may hold up to ten mailboxes; they are added
and removed in Settings. One is the default: new emails leave from it. A follow-up or an
answer leaves from the address its conversation started from (`outreach_drafts.sent_from`,
recorded at the first attempt), so a thread never changes sender; if that mailbox was
removed, the default takes over. The inbox of every mailbox is read, each with its own
cursor, and one that fails does not stop the others. Removing the default hands over to
the next working mailbox. A mailbox configured in `.env` is not a special case in the
interface: the first time it is seen it is stored as an ordinary mailbox of the first
workspace (password encrypted), once per address, so removing it is final. The list is
sorted: the default, then the working ones, then by address. The add form is a provider
picker with each provider's logo (`public/mail/`), then that provider's steps; the
Microsoft sign-in button appears only when Microsoft is chosen.

**Sign in with Microsoft (same day).** A button in the mailbox form starts the OAuth 2.0
authorization-code flow (`src/lib/mail/microsoft.ts`, routes under `/auth/microsoft/mailbox`).
The refresh token is stored encrypted in the same column as an app password (provider
`microsoft`); a one-hour access token is made from it per connection and used with the
existing SMTP + IMAP provider (XOAUTH2), so Message-IDs, the Sent-folder check and inbox
cursors behave exactly as for any other mailbox. A rotated refresh token replaces the
stored one; a withdrawn sign-in disables the mailbox with "sign in again". Needs
`MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` (and optionally `APP_URL`); without them
the button answers "not switched on yet". Chosen over the Graph mail API because it adds
almost no new mail code that cannot be tested without a registered app; the cost is that
tenants with authenticated SMTP switched off are refused at connect time, with that reason.
Graph sending is the follow-up if that turns out to be common. First real run on 2026-11-20 (the founder's Entra registration, a personal Outlook
account): sign-in, both connections and a test email worked. An outreach email and a
reply through a Microsoft mailbox, and a company (Microsoft 365) account, are untested.

**Not in this step.** Sign in with Google (needs an OAuth app and Google's security review
for Gmail scopes). The scheduler's other steps (sequence emails,
automatic search and research) still run for the first workspace only. New accounts are
still held at `/welcome`.

## D57 — Usage is counted per workspace, and a plan limits it (2026-11-20)

**Context.** Searches, website reading and AI calls cost the product money, and all three
were counted in one shared total: one customer could have spent the whole budget, and
nothing said what a customer costs. Pricing cannot be set without that.

**Decision.**
- `workspace_usage` (workspace, month, metric → count), counted up in one statement
  (`count` in `src/lib/usage/`). Metrics: `searches`, `research`, `emails`, `search_credits`.
  AI cost and website pages per workspace are read from `ai_usage` and `investigations`.
- A workspace has a plan (`workspaces.plan`, defined in `src/lib/usage/plans.ts`): a monthly
  number of searches and of researched businesses, the two things that cost money to do.
  Writing, reviewing and sending emails are counted but not limited. `owner` (the first
  workspace) has no limits; a new account starts on `trial`.
- A limit is asked before anything is queued (`room`, `assertRoom`; queued work takes up
  room) and once more when the job starts (`countOrRefuse`). A refusal is a sentence for the
  person: what the plan includes, that it is used, and the date it starts again. It counts
  nothing and changes nothing. Places that queue research on someone's behalf use
  `tryInvestigation`, which answers instead of throwing.
- The provider budgets in `.env` and the AI budget stay as the product's own ceiling over
  every workspace together; the AI budget setting is read from the first workspace.
- Settings, Budget and usage: every account sees its plan and this month's use. The first
  workspace also sees its provider budgets and a table of every account (use, cost, plan)
  where a plan can be changed. The dashboard shows a customer their plan, not the budgets.

**Not in this step.** Prices and payment; the plan numbers are placeholders to be set with
them. Upgrading from inside the product. New accounts are still held at `/welcome`.

## D58 — Settings pages: one topic per card, one setting per row (2026-11-20)

**Context.** The eight sections of D54 had grown into long single forms that mixed
unrelated things (identity with offer and writing style; daily limits with follow-ups and
countries), with one Save at the bottom, switches as bare checkboxes, hours typed as
numbers and search targets typed as `kind | CC | REGION` lines.

**Decision** (`src/app/settings/parts.tsx`; the Mailbox page is not part of this and was
left as it was):
- A page is a stack of cards (`Group`), each about one thing, each a form of its own that
  saves only its own fields (`saveSettingsAction` has one entry per card). Saving a card
  comes back to that card.
- A setting is a row (`Row`): its name and one line of explanation on the left, the control
  on the right. On/off settings are switches (`Toggle`); a card that is one automation has
  its switch in the heading. A choice between ways of working is a list of cards (`Choice`).
- Pages that are a form to fill in (Your details) use fields with the label on top, two to a
  line (`Field`, `Fields`); a missing field without which nothing can be sent is marked on
  the field itself.
- Numbers say what they count ("20 at most", "5 working days"); hours are picked from a
  clock; search targets are rows with a country and region picker (`TargetsEditor`), saved
  in the same text format as before.
- The menu: You (Your details, Mailbox), Emails (Sending and follow-ups, Automatic sending,
  Do not contact), Finding businesses (Finding and research), Account (Plan and usage,
  Connections). No provider names or file names in the wording of a setting.

## D59 — Settings: one Save per page, more say over automatic sending, reply rules (2026-11-20)

Changes D58 where it said each card saves itself, and extends D50.

- **One Save per page.** A page is one form (`SettingsForm`); its cards name themselves and
  `saveSettingsAction` saves the fields of all of them. The Save bar (`save-bar.tsx`) is not
  there until something is changed, then offers Save changes and Discard. What a choice
  means is shown at once, before saving, with plain CSS (`group-has-[...]`).
- **Reset to defaults** on Sending and follow-ups, Automatic sending, and Finding and
  research (`resetSettingsAction`): the stored values of that page's cards are removed. Not
  offered where a person wrote about themselves; the "Who to look for" list is kept.
- **What is sent automatically** (`autoSendFirst`, `autoSendFollowUps`, `autoSendMinScore`,
  `autoSendWeekdaysOnly`): all narrow automatic sending, none widen it. What they leave out
  stays under Outreach for the operator. Defaults change nothing.
- **Reply rules** (`replyRules`, `replyRulesOf`): for each kind of reply that can be answered
  the operator chooses "send it for me", "write it, I send it" or "do not write an answer",
  and may add an instruction of their own that goes to the model with the reply. Unset, the
  rules are what the app always did (everything waits; the old `autoAnswer` switch sends the
  two routine kinds). A kind set to "send" drops the standing "only you can answer" reason,
  but an unsure reading, a reply matched by address only, or two automatic answers in one
  conversation still hold the answer. An opt-out is never answered and always suppressed:
  that is not a setting. The wait after an out-of-office reply is (`outOfOfficeDays`).
- The Countries card left the Sending page; `allowedCountries` keeps its default (any).
- `searchesPerDay` defaults to 5.

The operator's instructions in the reply prompt have not been run against the real model.

## D60 — A profile of what is sold and to whom, and the search made from it (2026-11-20)

**Context.** Of everything under Your details only the "what you do" sentence was used, and
only by the email writer. A search knew nothing about the operator: the kind of business and
the place were typed each time, the automatic search worked from a second, hand-typed list,
and research judges every business as a prospect for "a small software consultancy". The
product is meant for any kind of seller (the founder's decision), so the page has to collect
who the operator sells to and the rest of the product has to read it.

**Decision, in three steps; step 1 is built.**
1. **The profile and its link to search** (built). Settings gained: `offerResult`, `offerKind`,
   `targetKinds`, `targetPlaces` (country, optional region), `targetSizes`, `targetNeedsWebsite`,
   `targetNeedsPhone`, `fitSigns`, `excludeKinds`, `proofPoints`. Your details is four cards
   (Who you are, What you sell, Who you sell to, Proof and tone) with one Save.
   - `profileGaps` says what is missing for sending (name, postal address) and, separately,
     for searching (offer, result, kinds, places). Missing fields are marked on the field.
     An incomplete profile warns on the search form; it never blocks a search.
   - `searchTargetsOf`: the automatic search works through every kind in every place of the
     profile. The hand-typed list (`searchTargets`) is only used while the profile names
     none; its editor left the Finding and research page, which now shows what the profile
     gives and links to it.
   - The search form offers the profile's kinds with one click and starts from its first
     place and its must-haves when there is no earlier search to start from.
   - Kinds are picked from the built-in catalogue or typed; no model call is involved.
2. **Scoring** (not built): a found business scores by whether its category matches the
   profile's kinds and sizes, and is left out when it matches `excludeKinds`.
3. **Research and emails from the profile** (not built): the fixed "software consultancy"
   in the research and email prompts is replaced by the operator's offer, result, signs of a
   good fit and proof. Needs a small paid run to verify.

Until steps 2 and 3, `targetSizes`, `excludeKinds`, `fitSigns`, `offerResult`, `offerKind` and
`proofPoints` are collected and shown but change nothing yet.

## D61 — The profile as a guided setup, and a first-run onboarding (2026-11-21)

Changes D60 where it described Your details as four cards with one Save.

- **Your details is a guided setup**: four short steps (About you, What you sell, Who you
  sell to, Finishing touches), one on screen at a time, each saved with "Save and continue".
  The first three are required: their needed fields are mandatory, an unfinished one says
  what is missing and stays open (`saveSettingsAction`, the `then` field), there is no way
  to skip, and a later step cannot be opened before the ones in front of it. The fields of
  a step live once in `src/app/settings/profile-steps.tsx`.
- **First-run onboarding** (`/setup`, shown without the app around it): the same three
  steps, then "Connect your mailbox" (may be left for later; connecting from here, by app
  password or Microsoft sign-in, comes back here), then a summary with "Find your first
  businesses" and "Go to the dashboard" (`finishOnboardingAction`).
- **Who goes through it**: a workspace whose `state:onboarding` is `pending`. An account
  someone signed up for themselves starts that way (`markOnboardingPending` in
  `createUser` and the Google sign-up); one made on purpose with a role (a script, the
  test seed) does not. Finishing sets it to `done`; it can only be finished with the
  three required steps complete.
- **The gate**: the root layout sends a pending owner to `/setup`, but only when a page is
  loaded whole; signing in or up sends them there itself (`setupAhead` in
  `src/app/auth-actions.ts`). Nothing redirects while a page is already being drawn
  (not the layout for the app's own partial fetches, not the dashboard page): in
  development that made the browser ask for `/setup` without end (seen 2026-11-21).
- The "What your searches will look for" sentence, the status boxes above the form, the
  kind-of-offer choice and the Countries card were taken off at the founder's request;
  `offerKind` and `allowedCountries` keep their stored values and defaults.
- A missing field is marked "Required" (it was "Needed to send" / "Needed to search").

New sign-ups are still members held at `/welcome`: they reach the onboarding once their
account is opened (role `owner`).

## D62. Rules for the profile fields, Your details as tabs, internals hidden (2026-11-21)

- **Field rules** (`src/lib/profile-rules.ts`): every profile field has limits and, where
  it helps, a shape (a name in letters, a website that looks like one, a booking link on
  https, an offer of at least 20 characters and three words, no links or shouting in what
  ends up in an email, at most 15 kinds of business). The form hands the limits to the
  browser, which stops a wrong value first; `saveSettingsAction` applies the same rules
  and does not save a value that breaks one (the old value stays, the refusal is shown).
  An empty field is not this module's matter: what is required is decided by
  `profileGaps` and the step check.
- **Your details is four plain tabs** (Profile, Offer, Customers, Extras), all open, with
  the same appearing Save bar as every other Settings page; a dot marks a tab that lacks
  something required. The guided, in-order walk exists only in the first-run setup.
- **How the product is built is the product's own business**: Settings, Connections (now
  under "Admin"), the System page and the reminders about missing keys are shown to the
  first workspace only. Customer screens do not name the research or AI services; where a
  business was found (Google Maps, OpenStreetMap) is still shown.
- **Titles are set in Manrope**, text in Inter (`--font-serif` is the title face).
- The Connections text no longer calls Brave Search free: its free plan ended in
  February 2026 (a monthly credit, a card required). It stays off.

## D63. The profile drives research, emails and reply reading (2026-11-21)

Until now the research and every email assumed one seller: a small software consultancy
that offers a mock-up. A customer who sells anything else got emails about software.

- **The seller** (`src/lib/seller.ts`, `sellerOf(settings)`): what is offered, what the
  customer gets, who it is sold to and who not, sizes, signs of a good fit, results that
  can be backed up, and what a first email asks for. Only what the profile says; a
  workspace without a profile is the built-in consultancy, as before.
- **Research** (`investigateSystem(playbook, seller)`, prompt version `research-7`): the
  seller is part of the prompt. A seller who builds software keeps the catalogue of
  software ideas and the fixed rule patterns; any other seller gets the same rules worded
  for any offer, category `other`, and no patterns. Every idea must stay inside what the
  seller offers. "No opportunity" now also covers: a kind the seller does not want, a size
  outside theirs, a competitor, or a business that already has what is offered. The signs
  of a good fit are looked for on the pages (found = an observation with its quote).
- **Emails** (`outreach-12`): the writer is told the sender's offer and what their
  customers get, and ends a first email with the ask the seller chose (`firstStep`: an
  example made for them, a few details, a rough price, a free trial), not always a
  mock-up. A result the seller can back up may be the new angle of the follow-up, never
  of the first email. A figure from the seller's own profile passes the number check.
- **Replies**: the reader is told what the seller offers, so a drafted answer stays
  inside it.
- **Not done**: screening before research by the kinds to leave out (a name match is too
  blunt: "Animal Hospital" is a vet); the model decides it during research. The
  capability-fit part of the score still reads the software catalogue.
- **Run live once** (2026-11-21, approved, `scripts/live-profile-test.ts` on a copy of the
  database): a test seller (evening cleaning for dental practices, ask = a rough price)
  against three Leeds dentists. All three qualified with ideas about cleaning, category
  `other`, and emails that ended on the price question; no software idea appeared. Cost
  $0.61 for the model, 22 page credits, 3 search credits. Not exercised live: a seller
  who builds software under the new prompt, a "not a fit" for an excluded kind, the
  follow-up with a backed-up result, and the reply reader.
- **A plainer, more exact first email** (`outreach-13`, same day, after the founder read the
  live emails and found them not human enough and open to two readings): the opening
  states what was seen as a plain fact and no longer praises it; the offer is said exactly
  (what the sender would do, provide or build, never its benefit in its place and never
  wrapped in a question); the writer is the kind of seller the profile describes (a
  service, a product, a build to order, or an adviser who offers a look or a conversation);
  45 to 70 words. Two more asks for advisers: a free short review and a short call. The
  claim check also reports an opening that praises and an offer that is not stated plainly.
  Run live once on the same three businesses (approved, $0.15): the openings became plain
  facts and the offer was stated outright. Open points: the sentence "I can't see how you
  manage ... now" repeats across a batch, the identical closing question trips the
  batch-repeat warning, and the seller's own profile wording can read advert-like.

