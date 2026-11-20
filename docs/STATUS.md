# Implementation status

## 2026-11-20 (evening): follow-up, To do page, redesigned pages, regression walk (decisions D51 to D53)

- New: next actions planned for every business in play and a To do page (D53); data-driven filters on
  Businesses; the business page as header, three steps and a side column; the search form reworked and
  a search that reads only the pages it needs (D52); no country limit by default (D51); one typeface.
- Regression walk on a private copy (sample `.example` businesses, no keys, in-memory mailbox): every
  public and signed-in page at 1440, 1024 and 390 pixels, light and dark. No console error, failed
  request or sideways overflow remains. Found and fixed: the search form was 33 px too wide on a phone;
  two landing-page statements about sending were no longer true; the Searches pages still used the old
  columns and descriptions; raw category codes ("car_repair") on two pages; the signature shown in a
  monospace box; a stale hint in Settings; step names cut off on a phone.
- 273 unit and integration tests and 9 browser tests pass; type check clean.
- NOT run: anything live. No search, website reading, model call or real email was made in this pass.
  The last-note, check-back and reply prompts are still unseen on real output.
- The founder's database was emptied at their request (account, settings, usage records and the
  do-not-contact list kept).

## 2026-11-20 (later): usage per workspace and plans (decision D57)

Second step towards other customers: each workspace's searches, researched businesses,
emails and search credits are counted per month, and a plan limits searches and research
(trial 3 / 10, starter 20 / 100, growth 60 / 400, scale 200 / 1500: placeholder numbers).
A full plan refuses in plain words before anything is queued or spent. Settings shows a
customer their plan and the founder every account with its use, cost and plan. Migration
0022. Five integration tests; both views clicked through on a private copy with a second
account inserted by hand (there is still no way for a customer account to get in).

## 2026-11-20 (late): a mailbox and settings per workspace (decision D56)

First step towards other customers: each workspace connects its own mailbox in Settings
(provider presets or its own mail server, app password stored encrypted, saved only after
a successful sign-in) and has its own settings, so its emails carry its own name and
signature. Migration 0020 (`mailboxes`; `settings` keyed by workspace, existing rows go to
the first workspace). Checked with 6 new integration tests and a click-through on a private
copy with the in-memory mailbox; a real mailbox has not been connected through the form yet.
Extended the same evening to several mailboxes per workspace with add, remove and a default
(migration 0021), including removing the server's own mailbox. 8 integration tests.
"Sign in with Microsoft" is built behind `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`; the
founder registered the app in Entra and connected a real Microsoft mailbox the same evening.
Open: Google sign-in, the rest of the scheduler per workspace, opening accounts.

## 2026-11-20 (night): lists, scrolling and the search page

- Outreach: every tab and the "No address on record" list are in pages of 25; a row
  action comes back to the page it was on. The two header buttons are the same size
  with their counts in pills; the bounced count left the subtitle.
- The window stays where it was after a filter, sort, search, dropdown or row action
  (`KeepScroll`); see docs/DESIGN.md, Layout rules.
- A search's page: one primary button at a time, Research and Run again confirm
  because they can spend credits, four plain figures, the technical detail folded
  under "How this search ran", the source column only when there is more than one.
- Dashboard: "Read" on replies opens To do filtered to Replies (the old link only
  scrolled the page and did nothing the second time); the count is no longer capped at 8.
- Pipeline: the hint line above the board is gone.
- The sample businesses used to try the screens were removed from the local database;
  `tests/fixtures/seed-scenarios.ts` can add them again (it spends nothing).
- Checked on a private copy without keys; unit, integration and browser tests pass.

## 2026-11-20: the app can run on its own (decision D50)

- New, all off by default: searches started from targets in Settings; sending without a click
  (after a waiting time, or at once) with a trust gate, a warm-up limit and a safety pause; simple
  answers to replies sent on their own.
- New, on by default: a last note after an unanswered follow-up; one check-back 90 days after a
  "not now"; an answer to a reply written as an email under Outreach; an out-of-office reply
  postpones the next email by a week; a queued follow-up is not sent when they answered meanwhile.
- "Check the connection" also reads the sending domain's SPF and DMARC records.
- Migration `0018_autopilot` (four nullable columns). 255 unit and integration tests and 6 browser
  tests pass; type check clean.
- NOT run: any live model call. The last-note and check-back prompts and the changed reply prompt
  (answers may be sent as written) have never produced a real email: read the first ones closely.
  No automatic search and no automatic send has run against the real mailbox or Serper.
- Not built: the mock-up a "yes" asks for, writing to a referred contact, a company-register check.

## 2026-11-19: smaller ask, shorter opening, varied main idea (decision D42)

- No reply to the first eight emails after one working day. Three changes chosen by the founder,
  made without any model call and not yet seen in a live email: one closing question offering a
  short mock-up in place of the call (outreach-8), a one-sentence opening and 60 to 90 words, and
  the enquiry-form idea no longer the default main idea (research-6).
- First live run in a second business type (forklift training providers, Manchester): 15 found,
  3 researched, all 3 qualified with reminder ideas (not the enquiry form). The founder found the
  emails still too detailed: decision D43 (40 to 60 words, one idea, the company's own name in the
  greeting, alternative idea moved to the follow-up; outreach-9).
- Second live run (sign makers, Leeds, 3 found): two emails of about 50 words in the D43 shape;
  the founder approved the shape and asked for stronger subjects (D44, outreach-10, not yet seen
  live). Two of the three were franchises of chains that the chain filter did not catch.
- The Businesses table opens with the most recently found first.
- 213 unit and integration tests pass.

## 2026-11-18: interface reorganised (decision D37), mailbox connected, data reset

- Interface: dashboard leads with what is waiting, funnel in one strip, this month's use; sidebar
  counts per section; simpler Businesses list; business page opens on an Overview; Settings in five
  tabs. See docs/DESIGN.md. Type check clean, 191 unit and integration tests, 5 browser tests pass.
- Next.js 16.4.3 to 16.4.6 (security advisory GHSA-mfr8-8qww-v76h).
- A mailbox is connected through an app password in `.env`. The first real emails went out
  through it the same day; reading replies from the real inbox has not been seen working yet
  (no reply has arrived).
- On the founder's request all earlier business data was deleted (businesses, searches, research,
  emails, jobs) and no copy was kept; usage records remain so budgets stay accurate.
- Research and email logic reviewed (decision D38): industry-neutral page selection, 6 pages, pages
  ordered for the model, a bar for proposals, shorter and warmer emails. Verified live on a
  handful of UK businesses.
- Wider range of solutions (decision D39): catalogue of sixteen families, three kinds of idea,
  different alternatives, the operator can choose which idea to raise. Run live once.
- Removing a business for good and one period dropdown (D40); pipeline with a period and a full
  history, one confirmation dialog, other subjects on request (D41).
- 209 unit and integration tests and 5 browser tests pass.

## 2026-11-12: business development platform (decisions D28 to D36)

Built in one session on the founder's brief, in phases; nothing committed, nothing deployed.

**What exists now**
- Research: email probe (2 pages, stop without a public email), observations with verbatim quotes,
  one consolidated opportunity with components, qualification with five outcomes and reasons,
  listing-based lead scores, portal and payment detection.
- Outreach: evidence pack, writer, fixed checks, independent claim check, one rewrite, ready or
  needs review; review screen with the evidence behind every statement; edit, approve, exclude,
  rewrite with a note; batches; do-not-contact list; sender settings and signature in code.
- Sending: SMTP + IMAP mailbox adapter, in-memory test mailbox, pre-send summary, paced queue,
  daily cap, at-most-once send job, stop and retry, bounce handling.
- Replies: inbox sync limited to answers to sent emails, bounce and automatic-reply recognition,
  opt-out by fixed rule, model classification with a suggested answer, correction by the operator.
- Automation: scheduler for inbox sync, one follow-up draft, auto-drafting, auto-research; monthly
  AI budget; five-item navigation; dashboard; ten-stage pipeline with the board from Qualified on.
- Removed: Patterns and validation signals, Overture and OpenStreetMap providers with DuckDB,
  template drafts and outreach styles.
- Migrations `0010_intelligence` and `0011_outreach` (data kept; old verdicts and stages mapped).

**What was run**
- `pnpm typecheck`: clean. `pnpm test`: 191 tests in 29 files pass (in-memory database, model and
  mailbox mocked at their boundaries). `pnpm test:e2e`: 5 browser tests pass on a production build,
  including review → edit → failed check → approve → send through the in-memory mailbox → pipeline.

**What was NOT run**
- No call to the live model with the new prompts (`research-2`, `outreach-2`, the claim check, the
  reply reader). The request and response shapes are the ones the earlier live runs used and the
  output schemas were checked to convert for the API, but the prompts are uncalibrated: expect to
  read the first real batch closely and tune. `scripts/reanalyze.ts` does this on stored pages.
- No real mailbox. The SMTP + IMAP adapter is written against the installed libraries' own type
  definitions and has never connected to a server; only the in-memory mailbox was exercised. First
  real use should be Settings → Check the connection, then a test email to yourself.
- The 19 Houston businesses in `data/dev.db` still carry research from the old prompt; the
  migration marked them "needs review" (4 as "not a fit" where the model had said no).

**Known limits**
- Automation and queued sends run only while the app runs.
- Replies the operator sends from their mail program are not synced back.
- A bounce or reply is matched by thread first, then by sender address (flagged as probable).
- Microsoft 365 mailboxes with app passwords disabled need a different adapter.
- No authentication; keep this local.

---

# History: 2026-10-27 (end of first build session) and later passes

The sections below describe earlier states of the product and are kept as a record. Where they
mention demo data, the Patterns page, validation signals, Overture, OpenStreetMap, template drafts
or "no outreach sending", the section above supersedes them.

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
deployment is a labeled read-only demo. Measured on 2026-10-29: dragging a pipeline card
on the deployment made other cards jump, because each serverless instance answers from
its own `/tmp` copy; the board now refuses moves in that mode with a notice, and the
pipeline page lists every stage change (manual and automatic) as a move history. The
board was rebuilt on dnd-kit (mouse, touch and keyboard sensors, drag overlay, drop
placeholder): cards move between columns and can be reordered inside one; the order is
stored in `prospects.position` (migration 0008) and the whole target column is saved on
each drop. Verified with Playwright in Chromium and WebKit: quick consecutive drops,
reorder, closed rows, the "Move to" control, keyboard moves, click-to-open and touch
scrolling all behave and persist across reloads.

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

## Demo data removed (2026-10-29)
The founder asked for all demo data to go. Removed: the demo discovery provider, the
seed (`src/db/seed-demo.ts`, `pnpm db:seed-demo`), "Load demo data" on the overview and
searches pages, the automatic seeding of serverless deployments, the `is_demo` columns
(migration 0009 deletes any remaining demo rows, then drops the columns), the demo badges,
filters, callouts, tone and the Settings entry. Tests keep a synthetic fixture under
`tests/fixtures/seed.ts` (four auto repair shops on `.example` domains, provider `csv`);
the browser journey seeds it before the server starts, and the integration tests run
discovery through the Google Maps provider with an injected transport.

## Review pass (2026-10-29, evening)
A full code review of the day's uncommitted changes found nine issues, all fixed: a board
drag that returned a card to its server position while a save was in flight was never
saved (now compared against the pre-drag snapshot); a cross-column drop onto a card was
re-ordered twice (reorder now only when the card never left its column); column positions
were written one UPDATE at a time (now one batch) and a filtered board overwrote hidden
cards' positions (the visible order is merged into the full column); archived drafts
other than the first were unreachable; "Mark as sent" logged its stage move as manual
(now the forward-only helper, logged automatic); the businesses view counts ran nine
queries (now one); stage tone and day grouping were copied three times (now shared from
the activity timeline); the next-action form was duplicated; the mailto link encoded the
address itself. New unit test for the board order merge. Suites: 166 unit, 5 browser.
Not deployed: the founder asked for the review only.

## Serper replaces SerpApi (2026-10-29, D27)
`src/lib/discovery/google-maps.ts` now calls `POST google.serper.dev/maps`; env `SERPER_API_KEY`,
`SERPER_CREDIT_BUDGET` (2,500, total), `SERPER_MAX_PAGES`, `SERPER_CACHE_DAYS`. Tests rewritten
against the Serper response shape. First live search on 2026-10-29: Austin auto repair, 5 km,
2 pages → 28 listings (20 per page confirmed, `page` works, 3 credits per page, 12 outside the
radius dropped), 23 saved (5 chains set aside); listings carry `openingHours` and `bookingLinks`.

## Showcase deployment with a data snapshot (2026-10-29, evening)
The founder tried the whole flow by hand with all keys set locally: one Houston home-services
search (19 businesses), 18 investigations with Claude Opus 5.5 (20 model calls, $2.42), 67
opportunity hypotheses, 2 drafts. Then asked to block crawling and AI and publish with this data.
Done without a hosted database: `data/snapshot/radar.db` (2.1 MB; page HTML, jobs and provider
cache stripped) is bundled and copied to `/tmp` on every serverless cold start (`DATABASE_SNAPSHOT`,
`seedFromSnapshot` in `src/db/client.ts`, traced via `next.config.ts`). No keys on Vercel, so
research, AI and discovery all show "needs credentials" there; the pipeline board stays read-only.
Verified locally in a serverless simulation before deploying.
Incident the same evening: the first two deploys uploaded the local `.env` (the CLI ignores
`.gitignore`), so Serper, Firecrawl and Claude were live on the public URL for about an hour.
Fixed with `.vercelignore` and a redeploy; the founder was told to check the provider dashboards
for unexpected use.
