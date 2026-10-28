# Operations

## Configuration
All settings are environment variables; see `.env.example`. None are required.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables AI stages. Without it: discovery + deterministic research only. |
| `AI_INVESTIGATE_MODEL/EFFORT`, `AI_OUTREACH_MODEL/EFFORT` | Model and effort per stage. |
| `AI_SPEND_LIMIT_USD` | Hard stop for AI work based on estimated cumulative spend. |
| `GOOGLE_PLACES_API_KEY` | Enables the Google Places provider (review Google's terms first). |
| `OVERPASS_ENDPOINTS` | Comma-separated Overpass endpoints tried in order. |
| `NOMINATIM_ENDPOINT`, `OSM_USER_AGENT` | Geocoding endpoint and the identifying User-Agent OSM policies require. Set a real contact. |
| `RESEARCH_*` | Crawl limits: pages, bytes, timeout, concurrency. |
| `DATABASE_PATH` | Local SQLite file (default `./data/radar.db`). Ignored when `TURSO_DATABASE_URL` is set. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Hosted libSQL (Turso) database for cloud/serverless hosting. Persistent and shared across instances. |
| `CRON_SECRET` | Optional bearer secret for `/api/jobs/drain` (set automatically by Vercel Cron when configured). |
| `EMBEDDED_WORKER` | `true` runs the worker inside the Next.js process. |

## Credentials needed from the founder
- `FIRECRAWL_API_KEY` (free plan) — without it no new website research runs; stored pages can still be re-analyzed.
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

## Deployment
### Vercel (current: https://opportunity-radar-sage-five.vercel.app)
The app runs on Vercel in "serverless mode": no long-lived worker (jobs run after each
response via `next/server` `after()` and a daily cron at `/api/jobs/drain`), and the
database must be hosted because each function instance has its own ephemeral `/tmp`.

1. Create a free Turso database: https://turso.tech → create database → copy the
   `libsql://...` URL and create an auth token (`turso db tokens create <name>`).
2. In the Vercel project add environment variables `TURSO_DATABASE_URL` and
   `TURSO_AUTH_TOKEN` (production + preview), optionally `ANTHROPIC_API_KEY`.
3. Redeploy. Migrations run automatically on first connection.

Without `TURSO_DATABASE_URL` the deployment is a read-only demo: a banner says so, demo
data is re-seeded on every cold start, and writes are not reliably kept.

Deploy manually with `pnpm dlx vercel deploy --prod` from the repo root (the project is
linked in `.vercel/`), or connect the GitHub repository in the Vercel dashboard for
automatic deployments on push.

### VM / container
Also supported: any host with a persistent disk runs the local SQLite file with the
embedded worker (`pnpm build && pnpm start`). Put it behind HTTPS and add authentication
before exposing it publicly.

## Cost considerations (estimates)
- Google Maps via SerpApi: free plan 250 searches/month (budget guard `SERPAPI_MONTHLY_SEARCH_BUDGET`; usage in `provider_usage`). OSM/Overture: disabled (D25).
- AI per business (Opus 5.5 list prices): extraction ~15–45K input tokens → ~$0.06–0.20;
  analysis ~5–10K in / 2–4K out → ~$0.06–0.12; outreach ~3K in / 0.5K out → ~$0.02.
  Roughly **$0.15–0.35 per fully processed business**; 100 businesses ≈ $15–35.
  Lower by setting extraction to a cheaper model/effort.

## Search engine: cells, releases, live checks
Every fetched source record is kept in `source_places` by 0.2° grid cell; `source_cells` records
which (provider, industry, cell) is cached from which release and when. Cells are refreshed after
`OVERTURE_CACHE_DAYS` or when Overture publishes a new release (`OVERTURE_RELEASE=auto` reads the
STAC catalog daily; pin a tag to freeze it). First reads are slow (Overture 45–110 s, Overpass
40–210 s per metro) and run in the background job; repeats are local. To force a refresh, delete
the rows for that provider from `source_cells`. Live check without the worker:
`DATABASE_PATH=./data/dev.db pnpm exec tsx scripts/search-live.ts --industry auto_repair --country US --region TX --city Austin --radius 8 --providers overture,osm --max 100`
(stop `pnpm start`/`pnpm dev` first). Public Overpass and Nominatim are shared infrastructure:
one bounded query per fetch, identifying user agent (`OSM_USER_AGENT`), ≥ 1 s between geocoder
calls, everything cached; use a paid or self-hosted instance for sustained volume.

## Regenerating the bundled location data
`src/data/countries.json`, `regions.json` (GeoNames admin1) and `world-places.json` (every place
≥ 15,000 inhabitants outside the US) come from GeoNames exports (CC BY 4.0):
`pnpm exec tsx scripts/build-geo-data.ts <dir with countryInfo.txt, admin1CodesASCII.txt, cities15000.txt>`.
The US list (`us-places.json`, ≥ 1,000 inhabitants) is regenerated as described below.

## Regenerating the bundled US places list
`src/data/us-places.json` comes from GeoNames `cities1000.zip` (CC BY 4.0): US rows,
neighbourhood records (feature code PPLX) dropped, one entry per name + state keeping
the largest population, sorted by population, as `[name, state, population, lat, lon]`.
Download https://download.geonames.org/export/dump/cities1000.zip, unzip, and run the
same filter (see git history of this file for the Python used). Keep the attribution in
the README and the settings page.

## Discovery with Overture Maps (DuckDB)
`@duckdb/node-api` ships a native binary; the first query installs the `httpfs` extension
(downloaded once) and reads the public release from `s3://overturemaps-us-west-2` anonymously.
A city-sized pull reads tens of MB and takes 4–10 s; results are cached in `place_cache`
(`OVERTURE_CACHE_DAYS`). Bump `OVERTURE_RELEASE` when Overture publishes a new monthly release
(list: https://overturemaps-us-west-2.s3.amazonaws.com/?prefix=release/&delimiter=/); the cache
key includes the release, so old pulls are simply ignored. State-sized areas are refused: search
city by city or by radius. On serverless hosts the provider reports itself unavailable and
OpenStreetMap is used.

## Website research with Firecrawl
Firecrawl is the only way pages are fetched. Setup: create an account at firecrawl.dev (the
free plan includes 1,000 credits a month, no card), copy the key into `.env` as
`FIRECRAWL_API_KEY`, restart. Costs: 1 credit per page (charged even when the site answers
4xx; not charged when Firecrawl itself fails), 1 per site map; a business costs
`RESEARCH_MAX_PAGES` credits (+1 when a map is needed), finder checks 1 each. Guards:
`FIRECRAWL_MONTHLY_CREDIT_BUDGET` (new crawls stop when the month's recorded credits reach it),
`FIRECRAWL_CONCURRENCY` / `FIRECRAWL_RPM` (free plan: 2 and 10), `FIRECRAWL_TIMEOUT_MS`. Stored
pages (markdown + raw HTML) are reused for `RESEARCH_STALE_DAYS` days and re-analysis is free.
The System page shows credits used this month, the account's remaining balance and requests in
flight. Self-hosting: point `FIRECRAWL_API_URL` at your instance (Firecrawl is open source);
then no credits apply. Pages are marked `renderer=firecrawl` or `stored`.

## Jobs
`/system` shows recent jobs with retry/cancel and source health. Jobs are abandoned after a per-type
limit (discover 20 min, investigate 10 min, outreach 5 min): the worker aborts the handler's
network work through an `AbortSignal`, handlers check it before writing results, and the search
or business the job was for is marked failed so nothing stays "in progress". Cancelling a queued
job does the same for its search (failed) or business (back to new/profiled). Jobs locked by a
worker process that is gone are requeued at the next start, but only when that worker ran on this
machine (worker ids carry the hostname); with a shared database, another host's jobs wait for
the 15-minute cutoff.
