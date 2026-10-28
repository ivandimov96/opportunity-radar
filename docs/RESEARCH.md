# How a business is researched (research engine v3)

## Why this exists
A software consultancy does not need more contacts; it needs to know **what it could
build for a specific business and why**, with evidence it can put in the first email.
Discovery tools answer "who". This engine answers "what and why" for one local business
at a time, at near-zero marginal cost, so that outreach is specific, honest and cheap to
produce at volume. Everything below serves one rule: **never state what we did not
observe.** A gap on a website is a reason to ask a question, never a fact about how the
business operates.

## The pipeline for one business
```
discover ──► lead score ──► locate website ──► crawl ‖ footprint ──► detect facts
         (order the queue)  (if missing/dead)   (parallel)          (deterministic)
                                                                         │
                 verdict ◄── score & rank ◄── rules (+ AI when configured) ◄┘
```
Everything runs inside one job (`investigate_business`), so a business is either
new, queued, investigating, profiled, failed, or no_website. Measured on 12 real Austin
shops without AI: 1.3–9.4 s per business, 7–22 verified facts each, 2–4 of them from
off-site records.

### 1. Discover (the start: `src/lib/search-input.ts`, `src/app/searches/new`)
A search is defined by: **business type** with optional **sub-types** (auto repair:
general, body & collision, tires, transmission, European/import, quick lube; home
services: HVAC, plumbing, electrical; dental: general, orthodontics; landscaping), an
**area**: country, a US state dropdown and a city typeahead (bundled GeoNames places,
16,000 US cities with coordinates, CC BY 4.0) — whole geocoded city/region, or a radius
around the picked center using Overpass `around` (no geocoding call when the center came
from the typeahead), **sources** (OpenStreetMap, Google Places when keyed, demo), **filters**
applied during discovery with skip counts (exclude chains, phone required, website
required, skip known), a result cap and a name keyword, and **automation**: investigate
the best leads first, only above a minimum lead score, at most N. The form validates
server-side and re-renders with field errors and the submitted values. Sources: OpenStreetMap
Overpass by sub-type selectors (free, storable, attribution kept); the **Texas sales tax
permit registry** (Comptroller open data, free, no key): every active business by NAICS
code and city with name, outlet address and permit dates, but no phone or website.
Measured for Austin: 376 general repair outlets, 92 body shops, 53 oil-change shops,
164 plumbing/HVAC, 171 electrical, 58 dental, 415 landscaping, versus 205 map places of
which 94 had a website. Registry records get a verified `permit_since` fact and depend
on the website finder (address + name verification) for a site. Four dedupe rules:
provider id → website domain → phone → name + city, so map and registry records merge.

### 1b. Discovery ranking and healthy searching
Discovery runs in two phases: collect from every selected source (each fails on its
own), then score every candidate from discovery data alone and store only the best up
to the result cap, so a cap of 25 means the 25 most promising businesses, not the first
25 a source returned. Beyond the lead score, sources contribute hints: listings with
opening hours (maintained records), years trading from a permit date (established
businesses up, brand-new ones slightly down), and outlets under one owner (3+ reads as
a chain, 2 slightly down). OpenStreetMap is queried with the industry's tag selectors
plus a name-pattern net (e.g. "auto repair", "mechanic", "collision") that catches
mis-tagged entries when no sub-type narrows the search. Candidates beyond the cap that
match a listed business (name + city, phone or domain) are still merged so their source
record is kept. Healthy by construction: one Overpass query per search, cached
geocoding, identifying user agents, per-source rate limits, four-rule deduplication,
chains set aside rather than crawled, investigations bounded by a threshold and a limit,
and never re-investigating a profiled business automatically.

### 2. Lead score (before spending research time)
`src/lib/scoring/lead.ts`. From discovery data alone, 0–100: own website +35, phone +12,
email +8, street address +10, city +5, category matches the playbook +10, listing-only
website +8, chain/franchise −45. **Chains** are detected by name (per-industry pattern
lists: Firestone, Caliber, NTB, Pep Boys, Jiffy Lube, …), by franchised-dealer names and
dealer-style domains (`mercedesbenzofaustin.com`, `austintoyota.com`), by store-locator
URLs (`local.brand.com`, `/locations/`, `/store/123`), and by three or more registry
outlets under one owner. Adjacent businesses that share map tags (tint, detailing,
towing, car wash…) are dropped from map results by name. They are never
hidden, only set aside: "Investigate all" skips them, lists show a `chain` badge, and a
quick filter shows them. Live check: 3 of 15 and 10 of 40 Austin results were chains.

### 3. Locate the website (fallback for the biggest data gap)
OSM lists many shops without a website. Instead of dropping them, the investigation
first tries to find one (`src/lib/discovery/find-website.ts`):
0. **Email domain**: a business email on its own domain (map data often has one).
1. **Web search** `"<name>" <city> <state>` via Brave Search (keyed). Aggregator and
   directory domains are dropped (Yelp, Facebook, YellowPages, BBB, RepairPal, …).
2. **Domain guesses** from the name: `compactname.com`, `compact-name.com`,
   `compactname.net`, `compactnamecity.com`, `shortname.com` ("automotive" → "auto"),
   DNS-checked before any fetch.
3. **Verification** fetches each candidate homepage and accepts it only when the
   business **phone** appears on the page, or the **street address + name**, or the
   **full name + city/region**. A page that merely contains the name is rejected
   (there are Longhorn Automotives in several states). Guesses need ≥0.8 confidence.
The same finder runs when a recorded website is dead (404/DNS). Live: Gujarat Auto
Center's OSM URL was dead; the finder guessed `gujaratautocenter.com` and verified it by
phone + name. The DuckDuckGo HTML endpoint was tried as a keyless search and answered
every automated query with a bot challenge, so it is opt-in only; without a Brave key
the finder relies on verified guesses. Nothing unverified is ever stored.

### 4. Crawl (bounded, parallel) ‖ footprint (off-site, keyless)
Crawl (`src/lib/research/crawler.ts`): homepage, then up to 4 key pages chosen by
kind priority (services, booking, about, contact, pricing, fleet, financing, FAQ,
reviews), one of each kind before a second of any. Fallbacks: dead deep link → site
root; connection failure → https/http and www/bare variants; fewer than two internal
links (JS-rendered menus) → `sitemap.xml`. Same site only, robots.txt respected,
SSRF-guarded, 10 s per page, duplicate pages skipped.

Footprint (`src/lib/research/footprint.ts`), in parallel, each lookup optional:
- RDAP registry record → `domain_registered` year (business longevity).
- DNS MX → `email_provider` (Google Workspace, Microsoft 365, GoDaddy, none…).
- DNS SPF includes → `email_senders` (Mailchimp, HubSpot, ServiceTitan, Podium… — a
  marketing/CRM stack that is invisible on the page).
- Internet Archive CDX → `site_first_seen` year.
Each fact links to the public record it came from.

### 5. Detect facts (deterministic, evidence attached)
`src/lib/research/detect.ts`, in order of reliability:
1. **Resources the page loads**: 45 tool signatures (booking, shop management, chat,
   reviews, financing, marketing, website platform) + `meta generator`.
2. **schema.org JSON-LD** declared by the site: address, opening hours, rating/review
   count, social profiles, phone, email.
3. **Contact channels**: mailto/tel links, real contact forms (search boxes excluded),
   social links. The business's own domain email wins; vendor/widget addresses
   (e.g. `support@autowatch.com`) are rejected.
4. **Text cues** on the main content only (navigation, header, footer stripped):
   booking method, text/SMS updates, maintenance plans, fleet program, financing,
   free estimates, warranty terms, ASE certification, years in business, reviews,
   promotions, conveniences, hours, multiple locations. Evidence is the matched
   sentence.
5. **Measured**: HTTPS, mobile viewport, homepage size and response time; latest
   copyright/dated-content year; summary from the meta description.
6. **Explicit gaps**: 14 fields we actively looked for are recorded as `not_found`
   when absent. Gaps drive hypotheses but cap confidence (≤45).

### 6. Reason: rules always, AI when configured
`src/lib/scoring/rules.ts` turns fact patterns into hypotheses with fixed, cautious
wording and conservative 1–5 ratings: phone-only booking, request form without
scheduling, fleet accounts without a portal, free estimates without follow-up tooling,
shop system present but booking/updates not connected, financing without a provider,
website not mobile-ready / unmaintained / no lead capture, and three **weak** gap-only
patterns (no update channel, no reminder program, no review collection) that are added
only while fewer than three stronger patterns fired. When `ANTHROPIC_API_KEY` is set,
one model call reads the pages plus all detected facts; its facts must quote the page
verbatim, its hypotheses must cite fact keys, and its hypotheses are always kept. Rule
patterns then fill categories the model did not cover (max 5 total).

### 6b. Outreach without a model
`src/lib/outreach/template.ts` writes a draft from templates when AI is not configured
(or over budget): each company-specific sentence comes from a verified fact or an
explicit gap in the opportunity's supporting keys and is registered as a claim with its
fact keys, then passes the same validator as model drafts. Labeled "template draft".

### 7. Score, rank, verdict
Same code for model and rule hypotheses (`src/lib/scoring/score.ts`): attractiveness
(value, feasibility, reusability, capability fit, reachability, readiness) and
confidence (evidence cited, strength, research depth, assumption load). Priority =
0.6 × attractiveness + 0.4 × confidence. Verdict: `insufficient_evidence` when fewer than
five facts about the business itself were verified (seven for a single-page site; measured
keys such as site health, dates and email hosting exist for nearly every site and do not
count), `opportunity` if anything survived, `no_opportunity` when the model (or the stack)
says so, `needs_ai` when no rule matched and the model did not run. Every opportunity shows
its source: `rule-based` or `AI`.

## Known limits (honest list)
- Keyless web search is effectively unavailable; a Brave key (free tier) unlocks it.
- A multi-location regional group reads as independent unless its name is on the
  chain list; the `multi_location` fact flags it for the operator.
- Text cues are English and tuned on auto repair / home services; other industries get
  the generic cues plus tools, structured data and footprint.
- Reviews, job postings and social activity are not collected (paid APIs or blocked).
- Off-site lookups depend on rdap.org, DNS and archive.org availability; a failed lookup
  simply yields no fact.
