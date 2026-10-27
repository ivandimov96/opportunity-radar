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
