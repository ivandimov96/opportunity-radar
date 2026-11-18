# Opportunity Radar

A business development tool for one person running a software consultancy. It
finds local businesses, researches each one from its own website, works out
**one** software idea worth raising, writes a short personal email about it,
and waits for you: you review, approve and send the batch with one button.
Replies are picked up from your inbox and the business moves through a simple
pipeline.

```
Find → Research → One idea → Qualify → Write + check the email → You review and send → Replies → Pipeline
        (automatic, in the background)                              (yours)            (automatic)
```

The rule everything else serves: **nothing is said about a business that was
not observed.** Every fact and observation carries the exact words from the
business's website; an email whose statements cannot be traced to them does not
reach the "ready" list.

## What you do, and what runs on its own

| You | The system |
|---|---|
| Start a search (business type + city) | Reads each website, builds the profile, looks for one consolidated idea |
| Read, edit and approve emails under **Outreach** | Decides: qualified / needs review / not a fit / too little evidence / no public email |
| Press **Send approved emails** | Writes the email from verified research and checks every statement in it |
| Answer replies from your own mailbox | Sends one at a time, paced, never twice; reads replies and bounces; honours opt-outs |
| Move cards on the **Pipeline** board | Drafts one follow-up for your approval when nobody answers |

Nothing is ever sent without your approval of each email and your click.

## Quick start

Requirements: Node 22+, pnpm 11+. No Docker; a local SQLite file.

```bash
pnpm install
cp .env.example .env     # add your keys (see below)
pnpm dev                 # http://localhost:3000, background worker included
```

Keys in `.env` (each has a free tier or is pay-as-you-go):

| Key | For | Without it |
|---|---|---|
| `SERPER_API_KEY` | Finding businesses (Google Maps listings) | No new searches; CSV import still works |
| `FIRECRAWL_API_KEY` | Reading websites | No new research; stored pages can be re-analyzed |
| `ANTHROPIC_API_KEY` | Research, email writing, claim checks, reading replies | Rule-based ideas that wait for your review; no emails written |
| `MAIL_PROVIDER`, `MAIL_USER`, `MAIL_PASSWORD` | Sending from your mailbox and reading replies | Review and approve only; copy an email and send it yourself |

Then open **Settings** and fill in who you are (name, postal address, optionally a company):
sending is refused until that is done. Details: [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | The app, with the background worker and scheduler inside |
| `pnpm test` | Unit and integration tests (in-memory database, no network, no spend) |
| `pnpm test:e2e` | Browser journey on a production build, with an in-memory mailbox |
| `pnpm typecheck` | TypeScript |
| `pnpm exec tsx scripts/reanalyze.ts --all --emails` | Re-run the research prompt on stored pages (no Firecrawl credits; uses the AI budget) and write the emails |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it works: data model, jobs, research, outreach, sending, replies, safeguards
- [docs/OPERATIONS.md](docs/OPERATIONS.md): setup, mailbox, budgets and costs, backups, compliance notes
- [docs/DECISIONS.md](docs/DECISIONS.md): why it is built this way (D28 onward describe the current design)
- [docs/STATUS.md](docs/STATUS.md): what was built and tested when, and what has not been exercised live
- Older design notes, kept for history: docs/AUDIT.md, docs/RESEARCH.md, docs/SEARCH.md, docs/STRATEGY.md, docs/DESIGN.md

City suggestions use data from [GeoNames](https://www.geonames.org/) (CC BY 4.0); business listings are Google Maps listings served by Serper (internal prospecting use).
