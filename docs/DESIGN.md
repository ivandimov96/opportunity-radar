# Interface design

How the screens are organised and why (rewritten 2026-11-18, decision D37). The
code is the source of truth; this explains the intent behind it.

## Principles

1. **One question per screen.** Dashboard: what should I do now, and where does
   everything stand. Businesses: what do we know. Outreach: what goes out.
   Pipeline: where is each conversation. Settings: how it behaves.
2. **What needs the operator comes first**, as a short list with one button per
   line. Numbers come second, in one strip, not a wall of tiles.
3. **Show a thing once.** A count lives in one place (a tab, the funnel strip,
   the sidebar badge), never as a tile and a tab and a sentence.
4. **Detail on request.** Rarely used controls sit behind one click: filters,
   move history, where a business came from, the pages that were read, planning
   a next action.
5. **Empty takes no room.** Views with nothing in them are hidden; a section
   with nothing to say is one line.
6. **Evidence stays one step away.** Every statement about a business links to
   the words it was read from. What was not found is listed once, as questions,
   never among the facts.

## Screens

- **Shell** (`src/components/nav.tsx`, `navStatus` in `src/lib/queries.ts`):
  five destinations. A badge on Businesses, Outreach and Pipeline counts what is
  waiting there (businesses to judge, emails to decide on, replies to answer).
  The foot of the sidebar is one line: everything connected, or what is left to
  set up, linking to the right Settings tab.
- **Dashboard** (`src/app/page.tsx`): "Finish setting up" (only while something
  is missing) → "Waiting for you" (replies, emails to send, emails to review,
  emails that failed, businesses to judge) → the funnel in one strip (Found,
  Researched, Qualified, Contacted, Replied, Meetings, Won) → replies and
  planned actions beside "This month" (emails today, AI spend, research and
  search credits against their limits).
- **Businesses** (`src/app/businesses/page.tsx`): search, one row of views
  (All, Not researched, Qualified, Needs review; others appear only when they
  hold something), filters collapsed. Columns: business, result, what we know,
  priority, stage and next step. Searches, import and export are secondary links.
- **Business** (`src/app/businesses/[id]/page.tsx`): name with result and stage,
  one "Next step" line, four tabs. *Overview* (default): what they do, the
  verdict with its reasons, the one idea and what each part rests on, other
  ideas. *Research*: coverage, verified facts, what was looked for and not
  found, the pages read. *Emails*: drafts, replies, contact history.
  *Activity*: notes and the log. Side column: contact, pipeline stage and next
  action, where it came from (collapsed).
- **Outreach** (`src/app/outreach/`): the counts are the tabs (Ready, Needs
  review, Can't contact, Excluded, Sent); one primary button sends the batch.
- **Pipeline** (`src/app/pipeline/`): a Board and a History view sharing the
  period dropdown. The board shows what moved in the period in two rows of
  three columns ("Reaching out", "In conversation") plus Won and Lost, twelve
  cards a column with a link to the rest; columns stack on a phone. A card
  shows the full name, what is waiting, when it last moved and an always
  visible "Move to" menu: nothing appears or shifts on hover. History is the
  whole process across businesses, by day.
- **Settings** (`src/app/settings/page.tsx`, `src/lib/settings-nav.ts`): five
  tabs: You, Mailbox and sending, Automation and budgets, Do not contact,
  Connections. Links and redirects go through `settingsHref(section)` so the
  right tab opens.

The Dashboard funnel and the Businesses list share one period dropdown
(`DateRangePicker`): it applies when picked and defaults to the last 7 days.

## Tokens and components

Defined once in `src/app/globals.css` as CSS variables and mapped into Tailwind
via `@theme inline`, so dark mode (prefers-color-scheme) is a variable swap:
surface/surface-2/surface-3, line, ink/ink-muted/ink-faint, accent (+soft, text,
fg), ok/warn/bad/info (+soft). Radius 12 px for cards, 8 px for controls. One
accent (indigo); semantic colours only for meaning.

`src/components/ui.tsx`: Badge, StatusPill, Card, Stat, Meter (a budget line),
ScoreRing, ScoreBar, EmptyState, Callout, PageHeader, Tabs, KeyValue, Flash.
`table.tsx`: FilterBar, SortHeader, Pagination. Component classes (`.btn`,
`.input`, `.table`, `.chip`) live in `@layer components`.

## Layout rules

- Page width ≤ 1440 px; forms ≤ 768 px wide so lines stay readable.
- One primary button per view; secondary bordered; ghost for low emphasis.
- No horizontal scroll at 390 px (asserted by a browser test).
- Collapsible blocks are native `<details>`; the arrow turns when open.
- Every confirmation uses the one dialog (`ConfirmButton`): question as title,
  consequence below, Cancel and a named action; red for deleting or stopping.
- What you do on a page leaves you where you were on it (`KeepScroll` in
  `src/components/keep-scroll.tsx`, mounted once in the layout): a filter, a sort,
  a search with Enter, a dropdown or a row action answers without jumping to the
  top. Page buttons (`data-scroll="top"`) go to the start of their list; opening
  another page starts at the top.
- Every list is in pages with the same footer (`Pagination` for lists paged by the
  query, `Pager` for lists paged by the page itself, as on Outreach: 25 per page).
- A number a button acts on sits in a pill inside it (`.btn-count`), not in brackets.
- A button that can spend credits (Research, Run again on a search) asks first.

## Look (decision D45)

- Palette "airmail" as tokens in `src/app/globals.css` (light and dark): paper, sheet, ink, airmail
  blue (`--accent`, every action and link), postmark green (`--ok`), and airmail red (`--stamp`),
  which is used only by `.airmail`, the striped band on top of the sidebar.
- One typeface, Inter, for everything: interface, page titles and the email text (changed 2026-11-20 at the
  founder's request; it replaced Avenir Next and the Charter serif). It is loaded through `next/font` in
  `src/app/layout.tsx`: fetched once when the app is built and served by the app itself.
- Sizes: `html` is 106.25%, body text about 15px, the smallest text 12px. Buttons 2.4rem high
  (small 2rem, large 2.85rem). Labels and table headings in sentence case.
- One decoration only (the airmail band). Cards are flat with a hairline border; shadows are kept
  for things that float (dialog, dragged card).

