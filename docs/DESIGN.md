# Design system and UX principles

## Principle: guided funnel, evidence first
Every screen answers three questions without scrolling: **where is this business in the
funnel**, **what is the single next action**, and **why should I trust what I see**.

Implemented as:
- `src/lib/workflow.ts` derives, for any business, five step states
  (Discovered → Researched → Analyzed → Outreach → In conversation) and one recommended
  next action with a reason. Lists show it as a 5-dot mini stepper + "Next" column; the
  profile shows the full stepper, a "Next step" banner and a context-dependent primary
  button. Nothing else in the UI decides what to do next.
- The overview is an inbox ("Needs your attention": failures, drafts to review, due
  actions, businesses ready for the next stage) above a 7-stage funnel with counts.
- Evidence is always one hop away: findings show the quote and source link beside each
  observation; opportunities list the observations they cite; the outreach editor
  highlights supported (green) and unsupported (amber) claims inline, with a claims →
  evidence panel. Scores are rings with a "Why these scores" breakdown.
- Empty states say what the state means and offer the one action that changes it.
- Demo data is marked in every list row, card and page.

## Tokens
Defined once in `src/app/globals.css` as CSS variables and mapped into Tailwind via
`@theme inline`, so dark mode (prefers-color-scheme) is a variable swap:
surface/surface-2/surface-3, line, ink/ink-muted/ink-faint, accent (+soft/text/fg),
ok/warn/bad/info/demo (+soft). Radius 12 px cards, 8 px controls. One accent (indigo);
semantic colors only for meaning (status, evidence support, demo).

## Components (`src/components/ui.tsx`, `icons.tsx`, `nav.tsx`, `outreach-editor.tsx`)
Badge, StatusPill, Card, Stat, ScoreRing/ScoreBar, Stepper (full and compact),
EmptyState, Callout, PageHeader (with breadcrumbs), Tabs, KeyValue, Flash, inline SVG
icon set, responsive AppShell (sidebar on desktop, drawer + top bar on phones),
OutreachEditor (client: evidence view / edit toggle, word count, copy, claim highlight).

Component classes (`.btn`, `.input`, `.table`, `.chip`, …) live in `@layer components`
and base element styles in `@layer base`, so Tailwind utilities always win.

## Layout rules
- Page width ≤ 1440 px, 32 px gutters on desktop, 16 px on phones, no horizontal scroll
  (asserted by an e2e test at 390 px).
- Profile pages: content column + 300 px sticky rail (contact, scores, pipeline,
  validation signal, sources). The rail stacks under the content on phones.
- Tables: sticky uppercase headers, hover rows, 13 px text; the business name is the
  row link; secondary facts sit under it in 12 px faint text.
- Buttons: one primary per view; secondary bordered; ghost for low-emphasis actions.
