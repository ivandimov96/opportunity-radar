# Operations

## Configuration
All settings are environment variables; see `.env.example`. None are required.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables AI stages. Without it: discovery + deterministic research only. |
| `AI_*_MODEL`, `AI_*_EFFORT` | Model and effort per stage (extraction/analysis/outreach). |
| `AI_SPEND_LIMIT_USD` | Hard stop for AI work based on estimated cumulative spend. |
| `GOOGLE_PLACES_API_KEY` | Enables the Google Places provider (review Google's terms first). |
| `OVERPASS_ENDPOINTS` | Comma-separated Overpass endpoints tried in order. |
| `NOMINATIM_ENDPOINT`, `OSM_USER_AGENT` | Geocoding endpoint and the identifying User-Agent OSM policies require. Set a real contact. |
| `RESEARCH_*` | Crawl limits: pages, bytes, timeout, concurrency. |
| `DATABASE_PATH` | SQLite file (default `./data/radar.db`). |
| `EMBEDDED_WORKER` | `true` runs the worker inside the Next.js process. |

## Credentials needed from the founder
- Anthropic API key (paid usage; guarded by `AI_SPEND_LIMIT_USD`).
- Optional: Google Maps Platform key with Places API (New) enabled (paid beyond free
  credit; storage restrictions apply).
- Optional: paid/self-hosted Overpass endpoint for sustained volume.

## Database & migrations
- Schema: `src/db/schema.ts`. Generate a migration after schema changes:
  `pnpm exec drizzle-kit generate --name <change>`; migrations apply automatically when
  the database is opened (`openDatabase`) and via `pnpm db:migrate`.
- Backups: copy `data/radar.db` (WAL files included) while the app is stopped.
- Deleting a business cascades to its sources, pages, observations, analyses,
  opportunities, drafts, prospect, activities and signals.

## Running
- Dev: `pnpm dev` (worker embedded). Prod: `pnpm build && pnpm start`.
- Separate worker: `EMBEDDED_WORKER=false pnpm start` + `pnpm worker`.
- Jobs left running by a crash are requeued after 15 minutes.

## Deployment (not yet done)
Single VM/container with persistent disk for SQLite; put behind HTTPS and add
authentication before exposing publicly. Serverless platforms are unsuitable because of
the SQLite file and the long-running worker.

## Cost considerations (estimates)
- OSM: free (respect policies). Google Places: pay-per-request.
- AI per business (Opus 5.5 list prices): extraction ~15–45K input tokens → ~$0.06–0.20;
  analysis ~5–10K in / 2–4K out → ~$0.06–0.12; outreach ~3K in / 0.5K out → ~$0.02.
  Roughly **$0.15–0.35 per fully processed business**; 100 businesses ≈ $15–35.
  Lower by setting extraction to a cheaper model/effort.
