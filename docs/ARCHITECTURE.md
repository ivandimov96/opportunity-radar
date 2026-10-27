# Architecture

## Stack (chosen 2026-10-27)
- **Next.js 16 (App Router) + React 19 + TypeScript**: one process serves UI, server
  actions, route handlers and the embedded background worker.
- **SQLite (better-sqlite3) + Drizzle ORM**: zero-ops persistence, WAL mode, FK
  cascades, SQL migrations in `drizzle/`. Migrating to Postgres is a driver swap.
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
src/lib/discovery/  providers (osm, google_places, demo, csv), normalize, dedupe
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
- `research_runs` → `pages` (fetched text + hash) and `observations`
  (`kind` verified|unknown, `method` deterministic|ai|manual|demo, evidence quote,
  source URL, page id).
- `analyses` → `opportunities` (category taxonomy, hypothesis, solution, cited
  observation ids, assumptions, validation questions, effort, reusability, risks,
  AI ratings, attractiveness + confidence + breakdown).
- `outreach_drafts` (style, body, claims→observation ids, warnings, status, edited flag).
- `prospects` (stage, priority, next action), `activities`, `validation_signals`.
- `jobs` (type, payload, idempotency key, attempts, backoff, progress), `ai_usage`,
  `geocode_cache`.

## Processing lifecycle
1. **Discover** (`discover_search` job): each selected provider returns candidates →
   normalize → upsert/dedupe → `search_results`; optional auto-research fan-out.
   One failing provider does not fail the others.
2. **Research** (`research_business`): crawl homepage + up to N prioritized internal
   pages (services/booking/about/contact/pricing/fleet/financing/faq) → store pages →
   deterministic detectors emit verified observations with evidence → (if AI enabled)
   extraction stage emits observations that are **accepted only if the evidence quote is
   found verbatim in the cited page**; unknowns stored separately. Previous research
   observations are superseded.
3. **Analyze** (`analyze_business`): observations + industry playbook → structured
   analysis. Validator drops citations to unknown IDs, caps evidence strength for
   unsupported opportunities, maps unknown categories to `other`, and records
   `no_compelling_opportunity`. Scoring runs in code; results persist with breakdown.
4. **Outreach** (`generate_outreach`): opportunity + observations + style → draft with
   claims; validator flags unsupported claims, missing claim text, placeholders,
   statistics, emails. Nothing is sent.
5. **Pipeline**: stages auto-advance forward only (discovered → researched → qualified →
   outreach_ready); operator sets later stages, notes, next actions, validation signals.
6. **Patterns**: group opportunities by category × industry; show shared evidence,
   common assumptions, effort mix, and real validation signals.

## AI design
- Three narrow stages instead of one agent: cheaper, testable, and each has a
  code-level validator. Prompts are stable strings (prompt-cached system blocks); all
  volatile content goes in the user message inside `<website_content>` tags with an
  explicit untrusted-data notice.
- Model/effort per stage via env (`AI_*_MODEL`, `AI_*_EFFORT`); default
  `claude-opus-5-5` with low effort for extraction, high for analysis.
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
- SQLite + in-process worker: simplest possible ops; not horizontally scalable (fine
  for one operator, thousands of businesses).
- No vector clustering: category taxonomy grouping is sufficient and transparent at
  this scale; revisit when categories prove too coarse.
- Google Places adapter untested live; OSM public instances unreliable under load.
