# Operations

## Setup

1. `pnpm install`, `cp .env.example .env.development.local`, add keys, `pnpm dev`.
2. **Settings → You**: name, postal address, optionally a company (and a sentence
   on what you do, a booking link and a few of your own emails if you like).
   Sending is refused until name and postal address are filled in.
3. **Settings → Mailbox and sending**: connect the mailbox (below), then "Check the
   connection" and "Send a test email to myself".
4. Start a search from Businesses → Find businesses. Research, qualification and
   email writing follow on their own; emails appear under Outreach.

Secrets stay in `.env.development.local` (see `.env.example` for every variable).
Everything the operator changes day to day is under Settings and stored in the
database.

## Development and production

Two environments, and nothing is shared between them: not the database, not a
secret, not a key, not a mailbox.

| | Development | Production |
|---|---|---|
| Where | this computer, `pnpm dev` | the live deployment |
| Settings | `.env.development.local` | the host's own settings (Vercel: Project, Settings, Environment Variables, "Production"), or `.env.production.local` on a machine of your own |
| Template | `.env.example` | `.env.production.example` |
| Database | the file in `DATABASE_PATH` (`./data/dev.db`) | the hosted Turso database |
| Shown as | a "Dev" mark beside the name | nothing |

- Do not keep a plain `.env`: the framework reads it in both environments.
- The environment is worked out by itself (`src/lib/app-env.ts`): `pnpm dev` is
  development, the production deployment is production, a Vercel preview is
  development, a test run is test. `APP_ENV` overrules it.
- The app refuses to start when the settings of one are used in the other:
  development or a test with `TURSO_DATABASE_URL` (the customers' database), or
  production with the test mailbox. What production still lacks is listed on the
  System page under Environment and printed when the app starts.
- `pnpm env:check` (or `pnpm env:check production`) reads a settings file and
  says what is filled in and what does not fit. It prints names, never values,
  and warns when a secret is the same in both files.
- A change reaches production only by a deploy (`pnpm dlx vercel@latest --prod`);
  a push alone does not deploy. Database migrations apply when the deployed app
  first opens the database, so a deploy that adds a migration changes the
  production database: take the change through development and the tests first.
- Each sign-in app (Google, Microsoft) needs the redirect addresses of both
  environments registered: `http://localhost:3000/...` and `<APP_URL>/...`
  (the paths are in `.env.production.example`).
- Production has no worker of its own. Its background work runs by turns: every
  five minutes the GitHub workflow "Run queued jobs" calls `<APP_URL>/api/jobs/drain`
  with `CRON_SECRET` (repository secret `CRON_SECRET`, repository variable
  `APP_URL`; the same secret is set on the host). If replies or follow-ups seem
  late, look at that workflow's runs first (GitHub, Actions). A turn can also be
  started by hand there ("Run workflow").
- Scripts read the development file (`--env-file=.env.development.local`). Never
  point one at production settings without the founder's word.

## Connecting a mailbox

Create an **app password** in the mailbox's security settings and set:

```
MAIL_PROVIDER=gmail          # gmail | yahoo | icloud | zoho | fastmail | outlook | custom
MAIL_USER=you@yourcompany.com
MAIL_PASSWORD=the-app-password
```

- Gmail / Google Workspace: 2-step verification on, then Security → App
  passwords. Sent mail is filed in Sent by Gmail itself.
- Other providers: the same idea; the app appends its copy to the Sent folder.
- `custom`: also set `MAIL_SMTP_HOST` and `MAIL_IMAP_HOST` (ports default to 465
  and 993).
- Microsoft 365: app passwords are often switched off by the tenant; this
  adapter will then refuse to sign in. A Graph adapter can be added behind the
  same `MailProvider` interface (`src/lib/mail/types.ts`).
- `MAIL_PROVIDER=fake`: an in-memory mailbox for dry runs and tests; nothing
  leaves the machine.

Before real outreach, check that the sending domain has SPF, DKIM and DMARC set
up (your mailbox provider's admin pages show this), and keep the daily cap low
from a personal mailbox. Consider a separate domain for outreach if you want to
protect the reputation of your main one.

## What runs on its own

While the app is running (Settings → Automation and budgets switches each one):

- research of saved, not yet researched businesses, best leads first, up to the
  daily allowance, paused while enough emails wait for review;
- an email for every business that qualifies and has a usable address;
- inbox reading every five minutes while sent emails wait for an answer;
- a follow-up and then a last note after the configured working days without
  an answer; one check-back after a "not now";
- an answer to a reply, written into the open batch when one makes sense.

Off until you switch it on (Settings → Automation and budgets):

- **Find new businesses on its own.** List who to look for, one per line
  ("sign makers | GB", "roofers | US | TX"). One search of 20 listings (3
  search credits) starts when fewer than a day's research is waiting.
- **Who presses Send.** "Send checked emails after a waiting time" or "right
  away". It starts only after you have sent 20 emails yourself, sends only
  emails whose checks all passed, begins at 10 a day and rises by 5 a week up
  to your limit, and pauses itself on bounces, opt-outs or failed sends, or
  when you press "Stop sending". Resume it on the same Settings card. A UK
  business that does not show it is a company (Ltd, LLP, a company number)
  is never sent to automatically.
- **Also send simple answers to replies.** Only a booking link for a meeting
  request or a "noted" for "not now"; everything else waits for you.

### Running unattended

Automation only runs while the worker runs. For a machine that is always on:

```
pnpm build
EMBEDDED_WORKER=false pnpm start     # the pages
pnpm worker                           # the worker and scheduler, one process only
```

or simply `pnpm start` with the embedded worker. Use a host with a persistent
disk (or Turso: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`), HTTPS, `AUTH_SECRET`
set, and exactly one worker. Sending hours are the host's local time: set `TZ`.

The worker lives in the app process, so automation and queued sends only run
while the app is running. `EMBEDDED_WORKER=false` plus `pnpm worker` runs it as
a separate process. For unattended operation use a small always-on host with a
persistent disk, HTTPS and authentication in front; do not use a serverless
deployment for this (no long-lived worker, and sending is disabled there).

## Budgets and measured costs

| Budget | Where | Default |
|---|---|---|
| AI per month | Settings → Automation and budgets, or `AI_SPEND_LIMIT_USD` | $30 |
| Firecrawl credits per month | `FIRECRAWL_MONTHLY_CREDIT_BUDGET` | 1,000 (the free plan) |
| Serper credits in total | `SERPER_CREDIT_BUDGET` | 2,500 (sign-up credits, do not renew) |
| Emails per day | Settings → Mailbox and sending | 20 |
| Businesses researched per day | Settings → Automation and budgets | 15 |

Measured on 19 Houston businesses in October 2026 (Claude Opus 5.5, medium
effort): research $0.13 and about 107 s per business, 4.6 Firecrawl credits per
business, an email about $0.025 to write (the claim check adds roughly a cent).
Six of the 19 had no public email: with the email probe they now cost 2 credits
and no model call. At the free Firecrawl ceiling that is roughly 250 businesses
and 100 emails a month for about $25 to $30 of AI. The dashboard ("This month") shows
actual use. Measured again on 2026-11-18 with the current logic (research-3, up
to 6 pages; three UK metal fabrication firms): research $0.15 and 5 credits per
business, an email $0.05 including its check.

The worker loads its code when the app starts. After changing anything a job
uses (prompts, research, outreach, mail), restart `pnpm dev` before running
jobs, or they run on the previous version.

## Re-analyzing existing research

Research done before 2026-11-12 was produced by the old prompt (several separate
hypotheses). Those businesses show as "Needs review" (or "Not a fit" where the
model had already said so). To redo them under the current prompt without
spending Firecrawl credits:

```bash
# stop pnpm dev first, or two workers compete for the jobs
pnpm exec tsx --env-file=.env.development.local scripts/reanalyze.ts --limit 3       # try three first and read the output
pnpm exec tsx --env-file=.env.development.local scripts/reanalyze.ts --all --emails  # everything, then write the emails
```

Or per business: its page → Research → "Re-analyze stored pages". Cost: about
$0.13 per business that has a public email, nothing for the others.

## Database

- A SQLite file (`DATABASE_PATH`, default `./data/radar.db`). Migrations in
  `drizzle/` apply automatically when the app opens the database.
- After a schema change: `pnpm exec drizzle-kit generate --name <change>`; data
  fixes are appended to the generated SQL by hand.
- Backup: stop the app and copy the `.db` file with its `-wal` and `-shm` files,
  or `sqlite3 data/dev.db ".backup 'backup.db'"` while it runs.
- Removing a business ("Remove" on its page, or "Remove shown" on the Not a fit
  view) deletes it with its research and unsent emails, and remembers it so
  later searches and imports leave it out. Settings → Do not contact lists the
  removed ones and can allow one again. A business that was already emailed
  cannot be removed; move it to Lost.
- The Dashboard and the Businesses list show the last 7 days unless another
  period is chosen in the dropdown; choose "All time" to see everything.
- The database now holds replies from your inbox and your do-not-contact list.
  Do not publish it. The old "snapshot for the public showcase" procedure must
  not be used with a database that has been used for outreach.

## When something goes wrong

- **An email shows "Not sent".** Open it: the reason is there. "The previous
  attempt was interrupted" means the outcome is unknown: look in your Sent
  folder, then use "It is in my Sent folder" or "Retry now".
- **Sign-in refused.** Check `MAIL_USER` and the app password, restart, use
  Settings → Mailbox and sending → Check the connection, then Retry on the failed emails.
- **Nothing is being researched or written.** The dashboard, "This month" (a budget
  may be used up) and Settings → Connections → Jobs and health (failed jobs with their
  errors, retry and cancel).
- **Stop a batch.** Outreach → Sent → Stop sending: what has not gone out returns
  to Ready, still approved.
- Jobs left running by a crash are picked up again at the next start. A send job
  in that state is never repeated blindly (see ARCHITECTURE.md, "Sending exactly
  once").

## Compliance notes (not legal advice)

- Since 2026-11-20 (decision D55) the signature is your own text and no opt-out sentence is added after
  it; add one to your signature if you want it. What follows describes the earlier default.
- Every email carries your name, your company if you gave one, postal address and a plain way to opt
  out; opt-outs are recognised by a fixed rule and suppressed immediately and
  permanently; bounced addresses are suppressed.
- Recipient addresses are only those a business published itself (or that you
  typed), and where each came from is stored.
- Since 2026-11-20 (decision D51) no country is blocked by default: the operator may email businesses
  anywhere and can set a limit under Settings → Mailbox and sending. What follows is why a limit existed.
  The first default was the US, where this kind of business email is
  permitted with the elements above (CAN-SPAM). The UK was added on 2026-11-18:
  its regulator allows marketing email to companies and LLPs with an opt-out,
  but treats sole traders and ordinary partnerships as individuals who must have
  agreed first. The app does not check a business's legal form: look for "Ltd",
  "Limited", "LLP" or a company number before approving an email to the UK. (Automatic sending does this
  look itself, in the name and the pages it read, and leaves the email to you when it finds none; it does
  not consult a company register.) Rules elsewhere are stricter:
  several EU countries require prior consent even between businesses, the UK
  does for sole traders, Canada requires consent with narrow exceptions. Add a
  country under Settings → Mailbox and sending only after checking its rules for your case.
- Volume is deliberately low and paced. There is no open or click tracking.

## Regenerating bundled location data

`src/data/countries.json`, `regions.json`, `world-places.json` and
`us-places.json` come from GeoNames exports (CC BY 4.0):
`pnpm exec tsx scripts/build-geo-data.ts <dir with countryInfo.txt, admin1CodesASCII.txt, cities15000.txt>`.
Keep the attribution in the README.
