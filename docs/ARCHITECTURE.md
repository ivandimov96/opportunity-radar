# Architecture

## Stack (chosen 2026-10-27)
- **Next.js 16 (App Router) + React 19 + TypeScript**: one process serves UI, server
  actions, route handlers and the embedded background worker.
- **SQLite via libSQL (`@libsql/client`) + Drizzle ORM**: a local file in development,
  a hosted Turso database in the cloud; same dialect, SQL migrations in `drizzle/`, FK
  cascades, async queries.
- **Zod 4** for env, input and model-output schemas.
- **Anthropic SDK** with structured outputs (`messages.parse` + `zodOutputFormat`).
- **cheerio** (HTML→text), **robots-parser**, **undici** (pinned-IP agent).
- **Tailwind 4** for a compact, consistent UI; no component library.
- **Vitest** (unit/integration), **Playwright** (browser journey).

## Components
```
src/app/            pages (server components), server actions, API routes
src/components/     small UI primitives, nav, auto-refresh poller
src/db/             schema, client (migrations on open), demo seed
src/lib/config.ts   env parsing + integration status
src/lib/discovery/  providers (google_maps active; overture, osm disabled; demo, csv), engine, normalize, dedupe
src/lib/research/   fetcher (SSRF guard), robots, html extraction, signals, crawler
src/lib/ai/         client (structured calls, spend guard), schemas, prompts,
                    extract / analyze / outreach stages with validators, usage/cost
src/lib/scoring/    deterministic explainable scoring
src/lib/industries/ playbooks + opportunity taxonomy + capability fit
src/lib/jobs/       SQLite job queue, handlers, worker loop
src/lib/pipeline/   stages, prospects, activities, validation signals
src/lib/queries.ts  read models for pages
src/instrumentation.ts  starts the embedded worker
```

## Data model (SQLite)
- `searches` → `search_results` ↔ `businesses` ← `business_sources` (one business, many
  provider records; dedupe by provider id → website domain → phone → name+city).
- `businesses` carries the single investigation state: `status` (new | queued |
  investigating | profiled | failed | no_website), `verdict` (opportunity |
  no_opportunity | needs_ai), `summary`, best scores and `priority`.
- `investigations` → `pages` (fetched text) and `facts` (one row per profile field:
  `status` verified|not_found|unknown, value, evidence quote, source URL, method
  detected|ai|manual|demo).
- `opportunities` (category taxonomy, hypothesis, solution, cited fact keys,
  assumptions, validation questions, effort, reusability, risks, AI ratings,
  attractiveness + confidence + breakdown).
- `outreach_drafts` (style, body, claims→fact keys, warnings, status, edited flag).
- `prospects` (stage, priority, next action), `activities`, `validation_signals`.
- `jobs` (type, payload, idempotency key, attempts, backoff, progress), `ai_usage`,
  `geocode_cache`.

## Processing lifecycle
1. **Discover** (`discover_search` job): each selected provider returns candidates →
   normalize → upsert/dedupe → `search_results`. With auto-investigate (default on)
   every new business with a website is queued immediately.
2. **Investigate** (`investigate_business` job, one per business): crawl the homepage
   plus up to 4 key pages in parallel → deterministic detection fills precise profile
   fields (tools from resource hosts, contact channels, booking method; explicit
   `not_found` for tool fields that were checked) → if AI is enabled, ONE model call
   returns the remaining profile facts (accepted only when the quote appears verbatim
   in the cited page), documented workflows, up to 3 opportunity hypotheses citing
   fact keys, and a verdict → scoring in code → business gets `status=profiled`,
   `verdict` (opportunity | no_opportunity | needs_ai), summary, priority. Previous
   facts/opportunities are replaced atomically.
3. **Outreach** (`generate_outreach`): opportunity + profile facts + style → draft
   whose claims map to fact keys; validator flags unsupported claims, placeholders,
   statistics. Nothing is sent.
4. **Pipeline**: `qualified` is set automatically when an opportunity is found;
   contacted/in conversation/validated/won/lost are set by the operator (logging a call,
   email or meeting marks the business contacted).
5. **Patterns**: opportunities grouped by category × industry with the profile facts
   they cite, common assumptions, effort mix, and real validation signals.

## AI design
- Two model calls per business at most (investigate, outreach), each with a code-level
  validator; no agent loop. Prompts are stable strings (prompt-cached system blocks); all
  volatile content goes in the user message inside `<website_content>` tags with an
  explicit untrusted-data notice.
- Model/effort per stage via env (`AI_INVESTIGATE_*`, `AI_OUTREACH_*`); default
  `claude-opus-5-5`, medium effort for investigation.
- Spend guard: every call records token usage and estimated cost; work stops at
  `AI_SPEND_LIMIT_USD`. `refusal` and `max_tokens` stop reasons are explicit errors.
- Failure handling: AI errors mark the stage failed for that business only; the job
  queue retries transient errors with backoff and never retries configuration errors.

## Security
- SSRF: http/https only, default ports, hostname allow-rules, DNS resolution with
  private/loopback/link-local/metadata rejection, **connection pinned to the validated
  IP** (no rebinding), redirects re-validated hop by hop (max 5), size cap, timeout,
  HTML/text only.
- Crawl politeness: robots.txt, identifying User-Agent, delay between requests,
  same-site only, ≤ N pages, duplicate-content skipping.
- Prompt injection: website text is wrapped as data; outputs are schema-validated and
  grounded; no tool use is exposed to the model.
- Inputs: Zod validation on forms; CSV size limit; parameterized SQL via Drizzle.
- Secrets: env only; never rendered. No auth yet (single-operator local tool); add
  before any public deployment (see OPERATIONS.md).

## Trade-offs accepted
- SQLite/libSQL + in-process (or post-response) worker: simplest possible ops; fine
  for one operator and thousands of businesses, not for multi-tenant scale.
- No vector clustering: category taxonomy grouping is sufficient and transparent at
  this scale; revisit when categories prove too coarse.
- Google Maps (SerpApi) provider not yet exercised live (key pending); OSM public instances unreliable under load (provider disabled).
