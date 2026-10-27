# Opportunity Radar

AI-powered **software business opportunity intelligence** for a small software firm:
discover real local businesses, research their public operations, identify credible
software/automation opportunities with evidence, score and prioritize them, draft
grounded outreach, and track prospects through a pipeline — while keeping verified
facts, hypotheses, and unknowns strictly separate.

```
Discover → Research → Verified findings → Opportunity hypotheses → Score → Outreach draft → Pipeline → Validation → Patterns
```

## Status (2026-10-27)

| Capability | Status |
|---|---|
| Business discovery via OpenStreetMap (Overpass + Nominatim) | Live, no credentials. Public instances were overloaded/timing out during development; endpoint fallback + retries implemented, see docs/STATUS.md. |
| Business discovery via Google Places API (New) | Implemented from the official REST reference, **not exercised live** (no key). |
| CSV import | Live, tested. |
| Deduplication across searches/providers | Live, unit-tested. |
| Website research (bounded crawler, robots.txt, SSRF guard) | Live, tested with mocked HTTP; security guard unit-tested. |
| Deterministic finding detection (tools, cues, contacts) | Live, tested. |
| AI extraction with verbatim-quote grounding | Implemented, validation logic tested; **requires `ANTHROPIC_API_KEY`**; not exercised against the live API in this repo. |
| AI opportunity analysis + explainable scoring | Implemented, validation + scoring tested; requires API key. |
| Outreach drafts with claim→evidence mapping | Implemented, validation tested; requires API key. **No sending** (by design). |
| Sales pipeline, notes, next actions, validation signals | Live, e2e-tested. |
| Recurring opportunity patterns | Live (category grouping), e2e-tested. |
| Demo mode with synthetic, labeled data | Live. |

See [docs/STATUS.md](docs/STATUS.md) for what was actually run and what remains.

## Quick start

Requirements: Node 22+, pnpm 11+. No Docker; a local SQLite file by default, or a hosted Turso database for cloud deployments.

```bash
pnpm install
cp .env.example .env            # optional; everything runs without it
pnpm db:migrate                 # creates ./data/radar.db
pnpm db:seed-demo               # optional: synthetic demo businesses
pnpm dev                        # http://localhost:3000
```

The background worker runs inside the Next.js server by default (`EMBEDDED_WORKER=true`).
For a separate process: set `EMBEDDED_WORKER=false` and run `pnpm worker`.

To enable the AI stages, set `ANTHROPIC_API_KEY` in `.env`. The app shows on every
page whether AI is live. `AI_SPEND_LIMIT_USD` (default $25) stops AI work once the
estimated cumulative spend is reached.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js app (worker embedded) |
| `pnpm worker` | Standalone background worker |
| `pnpm db:migrate` | Apply SQL migrations in `drizzle/` |
| `pnpm db:seed-demo` | (Re)seed synthetic demo data |
| `pnpm typecheck` | TypeScript |
| `pnpm test` | Unit + integration tests (Vitest) |
| `pnpm test:e2e` | Browser journey (Playwright, demo mode) |

## Documentation

- [docs/STRATEGY.md](docs/STRATEGY.md) — target users, problem, differentiation, pilot market, validation strategy
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, components, data model, processing lifecycle, AI design, security
- [docs/DECISIONS.md](docs/DECISIONS.md) — decision log with alternatives and trade-offs
- [docs/STATUS.md](docs/STATUS.md) — implementation status, tests executed, known limitations, next priorities
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — configuration, credentials, migrations, deployment, costs

## Principles baked into the code

- **Investigate first, verify second, reason third.** Every verified observation carries a source URL and evidence quote. AI-extracted observations are rejected unless their quote appears verbatim in the fetched page.
- **Hypotheses are never facts.** Opportunities cite observation IDs; citations to unknown IDs are dropped; opportunities with no evidence are capped at low confidence.
- **Attractiveness ≠ confidence.** Two separate scores with per-factor explanations. Missing information lowers confidence only.
- **"Insufficient evidence" is a valid, first-class outcome.**
- **No bulk sending.** Drafts are reviewed and sent by a human.
- **Untrusted web content.** Website text is data, never instructions; fetching is SSRF-guarded, bounded, and robots-respecting.
- **Demo data is always labeled** and uses reserved `.example` domains.
