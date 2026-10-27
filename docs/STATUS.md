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

## What was actually tested (executed in this session)
- `pnpm typecheck`: clean. `pnpm build`: succeeds.
- `pnpm test`: 51 tests pass (8 files) — normalization, dedupe rules, SSRF guard
  (private ranges, URL shapes, DNS rebinding), HTML extraction, signal detection,
  contact-form heuristic, snippet boundaries, CSV parsing, Overpass query building,
  extraction grounding, analysis citation validation, outreach claim validation,
  scoring determinism/separation, job queue (idempotency, backoff, stale recovery),
  and the integrated pipeline (discover → research → analyze → outreach → pipeline)
  with HTTP and the model mocked at module boundaries, including empty results,
  insufficient evidence, unreachable website, missing credentials and spend guard.
- `pnpm test:e2e`: 2 Playwright tests pass against a production build in demo mode —
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
