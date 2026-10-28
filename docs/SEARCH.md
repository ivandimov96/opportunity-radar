# How business search works (search engine v2, 2026-10-28)

> **2026-10-28, D25: Google Maps (via SerpApi) is the only active source.** Overture Maps and
> OpenStreetMap are disabled: their code, tests and cell cache remain, they are never offered on
> the form and the engine refuses them. The sections below that describe them document the
> disabled path. See "Google Maps" for the live one.

## What it is for
Find real businesses anywhere in the world for a given industry and place, from open
data, with every record traceable to its source, merged across sources without
inventing anything, ranked by how researchable it is, and saved into Radar so website
research and opportunity analysis can start from clean records. Nothing in this layer
reads websites, calls a model or writes outreach: those start from the saved business.

## The journey, end to end
```
form ──► validated search row ──► discover_search job ──► engine
                                                            │
   resolve area once ──► providers (isolated) ──► merge + dedupe ──► filters ──► rank
                                                            │
                     candidates (every source kept) ──► businesses (saved) ──► research
```
1. **Form** (`/searches/new`, `src/lib/search-input.ts`): business type + categories (or a free-text
   category for "Other"), name keyword, country → region → city (bundled worldwide list), whole
   city or radius, sources, filters, and what happens after (save automatically, research
   automatically). Validated server-side; errors render inline with the submitted values.
2. **Engine** (`src/lib/discovery/engine.ts`): one `runDiscovery(db, search)` per job. Future
   providers are refused before any call. The area is resolved once and shared. Each provider runs
   on its own; a failure is recorded against that source and the others continue (the search shows
   "partial"). Records are merged, filtered with skip counts, ranked, stored as candidates, and
   saved as businesses when the search asks for it.
3. **Results** (`/searches/[id]`): states queued → searching → results / no results / partial /
   failed; "from local cache" when nothing was read remotely. One table for candidates with search,
   source/website/phone/saved filters, a date range on the discovery date, sort, pagination, row
   and bulk selection, "Save selected" / "Save all", and the saved business's research status.

## Sources (`src/lib/discovery/index.ts`)
| Key | Status | What it is | Key |
|---|---|---|---|
| `google_maps` | active | Google Maps listings through SerpApi (`engine=google_maps`), 20 per page | `SERPAPI_API_KEY` (free plan) |
| `overture` | disabled | Overture Maps Places, GeoParquet on public S3, read with DuckDB | none |
| `osm` | disabled | OpenStreetMap via Overpass (nodes, ways, relations) | none |
| `demo` | internal | Synthetic, labeled; seeded by "Load demo data" and used by the tests, never offered on the form | — |
| `google_places`, `foursquare`, `web_search`, `linkedin` | future | Shown with a "New" badge, disabled, never executed, no keys asked | — |

The Texas sales tax permit registry was removed on 2026-10-28 (D24): Texas-only, no phone or
website, and Overture already covers what it added. Registries can return as a provider later.

A provider implements `DiscoveryProvider` (`src/lib/discovery/types.ts`): key, label, status,
description, attribution, `isAvailable()`, `discover(query)` → candidates with provenance. To add
one: write the module, add it to `PROVIDERS` and `PROVIDER_ORDER`, give it a taxonomy mapping if it
has categories, and the form, engine, validation and results page pick it up. Flip `status` from
`future` to `active` when it is real.

## Google Maps via SerpApi (the active source)
- **Request**: `https://serpapi.com/search.json?engine=google_maps&type=search&q=…&ll=@lat,lon,{m}m&gl=…&hl=en&start=…`.
  `q` is one query per chosen sub-type (`googleQuery` in the industry playbooks), the industry's
  query when no sub-type is chosen, or the free text for "Other business type"; a whole-city search
  appends "in City, Region". `ll` is the city center from the bundled place list with a map height
  covering the radius (population-based metro radius for a whole city): no geocoder call.
- **Paging**: 20 listings per page, up to `SERPAPI_MAX_PAGES` (3) pages per query; stops early on a
  short page, when no page brings a new listing, or when the monthly budget runs out (what was
  collected is kept and the search says so).
- **Budget**: each page fetched counts one SerpApi search in `provider_usage` (UTC month); the
  provider refuses to fetch past `SERPAPI_MONTHLY_SEARCH_BUDGET` (250 = free plan). Google's "no
  results" still costs a search; HTTP errors do not. Every page is cached in `provider_cache` for
  `SERPAPI_CACHE_DAYS` (30), so re-running or repeating a search is free.
- **Record**: name, Google category, address (street and postal code split out), phone, website,
  coordinates, rating, review count, hours, open/closed state ("permanently closed" → closed) and
  the place id; the candidate's source URL is the Google Maps place link; the raw listing is kept.
  Listings farther than the radius (+15 %) are dropped and counted.
- **Licensing**: Google's data served by SerpApi; SerpApi's "legal shield" covers paid plans only.
  Internal prospecting use; do not republish the listings.

## Overture Maps (disabled since D25)
- **Release**: `OVERTURE_RELEASE=auto` reads `latest` from the STAC catalog
  (https://stac.overturemaps.org/catalog.json) once a day; a tag pins it.
- **Schema (v2.0, verified on 2026-10-21.0)**: `names.primary`, `taxonomy.primary`,
  `taxonomy.hierarchy` (root → primary), `operating_status`, `confidence`, `websites`, `phones`,
  `emails`, `socials`, `brand.names.primary`, `addresses[1]`, `bbox`, `sources[1]`.
- **Query**: one bounded `read_parquet` over `s3://overturemaps-us-west-2/release/<r>/theme=places/type=place/*`
  filtered by bbox and `list_has_any(taxonomy.hierarchy, …) OR taxonomy.primary IN (…)` minus exclusions.
  S3 reads are serialized (one at a time); each is the expensive step (45–110 s for a metro).
- **Cells**: the area is split into 0.2° grid cells (`src/lib/discovery/cells.ts`). Cells already
  cached for the industry (its whole category set) and release, younger than `OVERTURE_CACHE_DAYS`,
  are not read again; missing cells are pulled with one query for their union and stored row by row
  in `source_places` (provider id unique; raw record kept). The search itself (bbox or radius,
  sub-types, keywords) runs on the local table, so repeated and adjacent searches cost nothing:
  measured 0.4 s for a repeat that first took 45 s.
- **Needs a long-lived host** (native DuckDB); disabled on serverless, where OpenStreetMap remains.

## OpenStreetMap (disabled since D25)
- Overpass with the industry's tag selectors plus a name-pattern net for mis-tagged entries,
  `nwr … out center tags` (nodes, ways, relations), four public mirrors with bounded retries, an
  identifying user agent, and the same cell cache (scope = industry, snapshot date as release).
  Stored tags are re-matched locally for sub-type narrowing (`parseOsmSelector` / `matchOsm`).
- Public Overpass is slow for metro-sized boxes (40–210 s measured) and shared; the cache keeps
  calls to one per area per month. For sustained volume use a paid/self-hosted instance or
  regional extracts (documented option, not built).
- **Licensing**: OSM data is ODbL, Overture is CDLA-Permissive 2.0. Every stored record carries its
  provider, id, attribution and raw payload (`source_places`, `business_sources`, candidate
  `sources`), so OSM-derived rows are always identifiable and attributable. Combining the two into
  one business record is a produced work for internal prospecting; anyone publishing a derived
  database must review ODbL share-alike obligations first.

## Category mapping (`src/lib/discovery/taxonomy.ts`)
An industry (and sub-types) resolves to an Overture spec — hierarchy nodes (any descendant
matches), exact primaries, exclusions for neighbours under the same parent (car washes, detailing,
towing live under `automotive_service`), an optional name pattern — and to OSM selectors. Names
were verified against the live taxonomy by scanning the Austin box (method: DuckDB `GROUP BY
taxonomy.primary, taxonomy.hierarchy`; see the probe in the session notes). The generic industry
takes a free-text category matched against the taxonomy path and the name. Every candidate records
what matched (`matchedBy`, e.g. "category tire_shop under automotive_repair", "tags [shop=car_repair]",
"name pattern"). Synonyms suggest an industry while typing (never switch automatically).

## Location resolution (`src/lib/discovery/area.ts`)
Countries, regions and 45,000 cities are bundled (GeoNames, CC BY 4.0; `scripts/build-geo-data.ts`).
A radius search uses the picked city's center: no lookup. A whole-city search asks Nominatim once
(structured query: city/state/country + country code, settlements only, ≥ 1 s between calls, cached
in `geocode_cache`) and keeps the answer only if it is a boundary near the city's known center;
otherwise a population-based metro radius around the bundled center is used, and the label says so.
Areas larger than ~130 km are refused: sources are read city by city. Measured failure modes that
drove these rules: free text "Berlin" → a Berlinstraße in Fürth; structured "Berlin" → a factory
named "Werk Berlin".

## Normalization and deduplication (`src/lib/discovery/engine.ts`)
Within a search, records merge by: same provider id (1.0) → same website domain within 1 km, or
with a similar name when coordinates are missing (0.95) → same phone within 2 km (0.9) → same
normalized name within 250 m (0.85). A similar name within 150 m with none of these is an
**uncertain** match: both stay listed, flagged "possible duplicate". Branches of one company with
their own addresses stay separate. Merged values take the first non-empty field by source trust
(Overture, Google, OSM, CSV); "closed" wins; nothing is invented. Saving a candidate uses the
established business rules (provider id → domain → phone → name + city) and records every
contributing source on the business.

## Persistence
`source_places` (every fetched source record, by cell), `source_cells` (what is cached, which
release, when), `search_candidates` (what a search found: merged record, sources, match rule and
confidence, completeness, lead score, saved business), `searches` (parameters, stats incl. partial /
cached / releases / area), `search_results` + `businesses` + `business_sources` (saved records and
provenance), `geocode_cache`, `jobs`. Migration `0006_search_engine`.

## Measured (2026-10-28, this machine)
| Scenario | Result |
|---|---|
| Austin auto repair, 8 km, Overture only | 429 records in 45 s (4 cells, 1,284 rows stored), 394 unique, 100 listed, all with website + phone |
| Same, OpenStreetMap only | 40 records in 41 s, 21 listed (18 chains set aside) |
| Both | 469 records, 14 businesses seen by both, served in 0.4 s from the cache |
| Repeat | 0.4 s, "from local cache" |
| Berlin dental, 6 km, both | 1,054 + 295 records, 45 seen by both, 60 listed |
| Berlin dental, whole city | geocoder returned a point → 30 km metro radius, 3,644 records, 60 listed |
| Marfa TX dental, 2 km | 0 records from both sources, reported honestly |
| Austin auto repair, whole city, cap 500 | 1,642 + 213 records, 1,581 unique, 500 listed in 281 s (Overpass 208 s) |
| "roofing" (free text), Austin 8 km | 67 + 1 records, 40 listed |

Live script: `DATABASE_PATH=./data/dev.db pnpm exec tsx scripts/search-live.ts --industry dental --country DE --region 16 --city Berlin --radius 6 --providers google_maps --max 60` (the Overture/OSM rows above were measured before D25).

## Known limits
- First read of an area is slow (Overture 45–110 s, Overpass 40–210 s); it runs in the background
  and is then cached for a month. There is no map view yet (candidates carry coordinates).
- Whole-city boundaries from Nominatim are unreliable for some names; the metro-radius fallback is
  used and labeled. The form's radius mode never needs the geocoder.
- Overture duplicates the same business occasionally; the merge handles the common cases
  (same domain or phone nearby) and flags near-identical names for review.
- Category mappings exist for automotive, home services, dental and landscaping; other industries
  use the free-text category. Chain detection is name-list based plus Overture's brand field.
