# Product strategy

## Target users
A small software consultancy / product studio (initially: us) that wants a steady flow of
**credible, evidence-backed** software opportunities at local SMBs, and wants to notice
when the same problem recurs across many businesses so it can be productized.

## Core problem
Generic lead tools (Apollo, Clay, ZoomInfo, Ocean.io, AI SDR agents) answer *who to
contact*. They do not answer *what to build for them and why*, and they routinely blur
AI guesses with facts. Consultants therefore either spray generic outreach or spend hours
per prospect doing manual research.

## Value proposition
For each business: what it verifiably does, what workflows its public footprint
documents, which existing tools it already uses, a **hypothesis** about a software
opportunity with supporting evidence and explicit unknowns, an honest score (how good /
how sure), and a draft conversation opener whose every claim is traceable. Across
businesses: which hypotheses recur, and which have been **validated by real
conversations**.

## Differentiation (vs. market, researched 2026-10)
- Apollo/Clay/Ocean.io: contact databases and enrichment workflows; strong at people
  data and sequencing, weak at operational understanding and evidence provenance. Clay
  "research agents" are generic and unverified.
- AI SDR agents (Artisan, 11x): volume outreach with deliverability risk; the opposite of
  our evidence-first, low-volume approach.
- Vertical SaaS vendors' own prospecting is proprietary.
- Our wedge: **verified-observation → hypothesis → validation** loop with provenance,
  explainable scoring, and recurring-pattern detection tied to real validation signals.

Commoditized (we do not compete on): contact databases, email sequencing, generic
company firmographics.

## What users would pay for (assumption, to validate)
A consultancy would pay for *qualified conversation starters that convert*, not for
rows. Pricing model TBD after Stage 2 validation; the first customer is ourselves.

## Pilot market (decision)
**Independent automotive repair shops, Austin TX metro**, with **home services
(HVAC/plumbing/electrical)** as a second built-in playbook. Rationale:
- Storefront POIs with good OpenStreetMap and Google Places coverage (data availability
  was an explicit criterion); contractors often lack a storefront and are weaker in OSM.
- Clear, frequent software-addressable workflows: scheduling, estimate approval,
  status updates, reminders, fleet accounts.
- Owner-operated; decision-maker reachable via public email/phone.
- Vertical SaaS (Tekmetric, Shopmonkey, AutoLeap, …) is strong, which the analysis
  must respect: opportunities skew to gaps/integrations around those tools. That is a
  feature: it forces the "why not an existing tool" discipline.
- Austin: large metro, growth, tech-friendly owners. Any other city works unchanged.

Attempted a live Overpass count of Austin categories during development; public
instances returned 502/timeouts, so the comparison could not be completed (see
docs/STATUS.md). The choice rests on the qualitative criteria above and should be
re-checked with live counts once an Overpass instance responds.

## Commercial assumptions (explicit)
1. Public websites contain enough operational signal to form credible hypotheses for a
   meaningful share of shops (expect 30–60%; measure).
2. Owners respond to specific, honest, evidence-based openers at a materially higher rate
   than generic outreach.
3. Some hypotheses recur across 10+ shops and are confirmed in conversation often enough
   to justify a reusable product.

## Validation strategy
- Stage 1: run 100 Austin shops through the pipeline; measure research coverage,
  share with ≥1 opportunity, share "insufficient evidence", and outreach reply rate.
- Record **validation signals** (conversation / confirmed / rejected / pilot / paying)
  per opportunity category. The Patterns page shows hypotheses and signals side by side.
- Only categories with repeated *confirmed* signals move to Stage 3 (reusable product).

## MVP scope
Included: discovery (OSM, Google adapter, CSV), dedupe, bounded research, grounded
extraction, analysis with "insufficient evidence", explainable scoring, outreach drafts
(no sending), pipeline, patterns (category grouping), demo mode.
Deliberately excluded: email sending, multi-user auth, embeddings/clustering,
enrichment vendors, mobile UI, billing.
