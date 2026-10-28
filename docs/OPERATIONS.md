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
- OSM: free (respect policies). Google Places: pay-per-request.
- AI per business (Opus 5.5 list prices): extraction ~15–45K input tokens → ~$0.06–0.20;
  analysis ~5–10K in / 2–4K out → ~$0.06–0.12; outreach ~3K in / 0.5K out → ~$0.02.
  Roughly **$0.15–0.35 per fully processed business**; 100 businesses ≈ $15–35.
  Lower by setting extraction to a cheaper model/effort.

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

## Headless rendering
`playwright` (Chromium) renders JavaScript-only homepages when the static fetch is thin. Install
browsers once with `pnpm exec playwright install chromium`. Disabled on serverless and by
`RESEARCH_BROWSER_RENDER=false`. Rendered pages are marked `renderer=browser`.

## Jobs
`/system` shows recent jobs with retry/cancel and source health. Jobs are abandoned after a per-type
limit (discover 20 min, investigate 10 min, outreach 5 min): the worker aborts the handler's
network work through an `AbortSignal`, handlers check it before writing results, and the search
or business the job was for is marked failed so nothing stays "in progress". Cancelling a queued
job does the same for its search (failed) or business (back to new/profiled). Jobs locked by a
worker process that is gone are requeued at the next start, but only when that worker ran on this
machine (worker ids carry the hostname); with a shared database, another host's jobs wait for
the 15-minute cutoff.
