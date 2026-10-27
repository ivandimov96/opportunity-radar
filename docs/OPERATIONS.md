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
