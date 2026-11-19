# Architecture

Current as of 2026-11-12. The code is the source of truth; this document says
where things are and why they are shaped the way they are.

## The shape of it

One Next.js process serves the pages and server actions and runs a background
worker. All state is one SQLite file. Pages only read and enqueue; the worker
does everything that takes time or costs money.

```
src/app/            pages (server components), server actions (actions.ts), API routes
src/components/     small UI primitives, navigation, the email editor, the activity timeline
src/db/             schema.ts, client.ts (one connection, migrations on open)
src/lib/config.ts   environment: keys, limits, the mailbox (secrets live only here)
src/lib/settings.ts operator settings in the database: sender, sending limits, automation
src/lib/discovery/  finding businesses: Google Maps via Serper, merge, dedupe, CSV import
src/lib/research/   Firecrawl client, staged crawl, stored pages, deterministic fact detection
src/lib/ai/         model client (spend guard, usage), research call, email writer and checker
src/lib/scoring/    lead score, rule patterns, opportunity scores, qualification
src/lib/outreach/   evidence pack, fixed email checks, review operations, batches, sending
src/lib/email/      address checks, the do-not-contact list
src/lib/mail/       the mailbox: SMTP + IMAP adapter, in-memory test mailbox, parsing, inbox sync
src/lib/pipeline/   the ten stages, stage changes, activity log
src/lib/jobs/       queue, worker, scheduler, job handlers
```

## The flow

1. **Find** (`discover_search`). Google Maps listings through Serper, cached per
   page. Records are merged and deduplicated, scored from listing data alone
   (website, phone, address, review count; chains are set aside) and saved.
2. **Research** (`investigate_business`), one job per business:
   - *Email probe.* The homepage and the contact page are read first (2 credits).
     If neither publishes a business email, research stops there with the
     outcome `no_contact`: the remaining pages and the model call would be spent
     on a business nobody can write to. Adding an address by hand continues it.
   - *Pages and public records.* Up to `RESEARCH_MAX_PAGES` pages (6) through
     Firecrawl, kept with their HTML so later analysis is free; in parallel the
     domain's registration year, mail servers and first archive capture. Pages
     are chosen by what they are likely to show, one of each kind first:
     services or products, quote/booking/order, "how it works", forms to
     download, about, pricing, careers, FAQ. The kinds are not tied to one
     industry (`KIND_PATTERNS` in `src/lib/research/html.ts`).
   - *Detected facts.* Deterministic: tools from the resources a page loads,
     structured data, contact channels, a customer portal link, online payments,
     conservative text cues, and explicit `not_found` for things looked for.
   - *What the model reads.* The pages in order of how much they explain the
     business, not in crawl order: the contact page (already mined for the
     address) and testimonials come last and short, so they never push a
     services or quote page out of the 40,000-character budget.
   - *One model call.* Returns profile facts, **observations** (free-form things a
     page shows, each with a verbatim quote), and **one primary opportunity**
     made of components that each cite evidence, plus at most two independent
     secondary ideas, or `no_opportunity`. Fixed rule patterns that matched are
     handed to the model as candidates; they are never kept beside its answer.
     The model chooses from a catalogue of solution families (quotes, job
     tracking, planning deliveries, stock, customer self-service, paperwork,
     connecting tools, reporting, AI help and others; `SOLUTION_GUIDE`) and
     labels each idea with its kind: improves something they offer, new for
     their customers, or a tool for the team. The alternatives must differ from
     the main idea, and the operator can choose one of them for the email
     (`src/lib/outreach/ideas.ts`).
     The prompt sets a bar for a proposal: a problem the owner would recognise,
     tied to something on the pages; who uses it and what gets easier; a first
     version small enough for one developer in a few weeks; working with what
     they already have; never a category ("a portal", "a CRM"). It also returns
     the idea in plain words (`sales_angle`), which is what the email is built on.
   - *Validation in code.* A fact or observation is dropped unless its quote is
     verbatim on the cited page. A component that cites nothing established is
     dropped; an opportunity with no established evidence is dropped; the model's
     "no" is final.
   - *Scores and qualification.* Attractiveness and confidence are computed in
     code and stay separate. `qualify()` then gives one outcome, stored in
     `businesses.verdict` with its reasons: `qualified`, `needs_review`,
     `not_a_fit`, `insufficient_evidence` (or `no_contact` from the probe).
     Things not found on a website never count as evidence that qualifies.
   - Without a model, rule patterns are grouped into one idea in code and the
     business always lands in `needs_review`.
3. **Write** (`generate_outreach`), automatically for a qualified business with a
   usable address:
   - An **evidence pack** is built: verified facts and observations with the
     business's own words. Measurements, registry dates and contact details are
     left out. Things not seen on the site are listed separately and may only be
     raised as questions.
   - The writer produces subject, body and the list of statements it makes about
     the business with the evidence for each. The email is a short, friendly
     note of four parts (40 to 60 words): the greeting by the company's own
     name (`company-name.ts`), one sentence on something specific it noticed,
     who is writing with the idea as a gain, and one closing question that
     takes a word to answer (may I send a short mock-up?). One idea only; a
     different idea from the research is kept for the follow-up. No call is
     proposed in a first email. The parts of the
     solution are given to the writer as background only; it is told not to
     list them.
   - **Fixed checks** read the text: length, stock phrases, placeholders,
     statements of absence, numbers and product names that are not in the
     evidence, links, a first email without a question (held back) or with
     several questions, a proposed call or a long opening sentence (remarks), a
     subject or opening repeated within the batch.
   - An **independent claim check** (a second call that did not write the email)
     lists every statement about the business and marks it supported, phrased as
     a question, or unsupported.
   - Any failure triggers one rewrite with the problems named. The result is
     `ready`, or `needs_review` with the reasons. The signature, postal address
     and opt-out line are appended by code from Settings, never by the model.
4. **Review and send.** Under Outreach the operator reads, edits (the fixed
   checks run again on the edit), approves or excludes. **Send approved emails**
   shows a summary computed by the same function that then queues: recipients are
   checked again (valid address, allowed country, not on the do-not-contact list,
   never emailed before, no duplicate in the batch), each email gets its
   Message-ID and a send time (paced, inside the sending hours, within the daily
   cap), and one `send_email` job per email is queued.
5. **Replies** (`sync_mailbox`, `process_reply`). The inbox is read every few
   minutes while sent mail is waiting for an answer. Only messages that belong to
   an email sent from here are stored: a reply in the thread, a message from an
   address that was written to, or a bounce naming the email. A person's reply
   moves the business to "Replied" and withdraws a pending follow-up. An opt-out
   is recognised by a fixed rule and suppresses the address at once. Other
   replies are classified by the model (the original text is kept; the label can
   be corrected) with a suggested answer that is never sent by the app.
6. **Follow-up.** After the configured working days without an answer the
   scheduler drafts one follow-up in the same thread. It waits for approval like
   any other email.

## Data model

- `searches`, `search_candidates`, `search_results`, `businesses`,
  `business_sources`: what was found and where it came from. A business carries
  its research `status`, its `verdict` with `verdict_reasons`, its scores, the
  email address with `email_source` (site | listing | manual), its source URL
  and `email_status`.
- `investigations` → `pages` (text and HTML of what was read), `facts` (one row
  per profile field: verified with quote and URL, or not found), `observations`
  (free-form, quote and URL), `opportunities` (`role` primary | secondary,
  `components`, `why_relevant`, scores with their breakdown, prompt version).
- `campaigns` (batches), `outreach_drafts` (one outbound email per business and
  step: status, validation result, Message-ID, schedule, attempts, cost),
  `email_events` (append-only: queued, attempt, sent, failed, bounced, reconciled,
  unconfirmed, cancelled), `inbound_emails` (replies and bounces, with
  classification), `suppressions` (do-not-contact).
- `prospects` (pipeline stage, order on the board, next action), `activities`
  (everything that happened to a business, including every stage change).
- `jobs`, `ai_usage`, `provider_usage`, `provider_cache`, `settings` (operator
  settings and small pieces of system state such as the inbox cursor).
- Unused, kept because they may hold data: `source_places`, `source_cells`,
  `place_cache`, `geocode_cache` (the last is still used for whole-city
  boundaries), `validation_signals`.

## Pipeline stages

Discovered → Researching → Qualified → Ready to contact → Contacted → Replied →
Meeting scheduled → Proposal sent → Won / Lost. The first four and "Contacted"
and "Replied" are set by the system (research, qualification, a checked email,
a send, a reply). The board shows Qualified onward as columns; Discovered and
Researching can hold hundreds of businesses and are shown as counters. Every
change, automatic or manual, is logged in `activities`.

## Jobs

| Job | Does | Notes |
|---|---|---|
| `discover_search` | One search | Unchanged core; retries on provider errors |
| `investigate_business` | Research, consolidation, qualification | Queues the email when the outcome is `qualified` |
| `generate_outreach` | Write + check one email (step 0 or the follow-up) | Replaces an earlier unsent email for the same step |
| `send_email` | Send one email | One at a time; see below |
| `sync_mailbox` | Read the inbox | One at a time; queued by the scheduler or "Check now" |
| `process_reply` | Classify one reply, suggest an answer | Opt-outs need no model |

The queue is the `jobs` table: claimed with one atomic statement, idempotency
keys, exponential backoff for retryable errors, a time limit per type, recovery
of jobs left running by a dead process. The **scheduler** runs inside the worker
once a minute: inbox sync, follow-up drafts, emails for qualified businesses that
have none, and research of saved businesses (best leads first, within the daily
allowance, paused while enough emails wait for review). It never sends and never
starts a search.

## Sending exactly once

- The Message-ID is assigned when the email is queued, before any attempt.
- `queued → sending` is one `UPDATE … WHERE status = 'queued'`: only one run can
  take an email.
- A temporary refusal or a connection that never got as far as handing the
  message over puts the email back to `queued` and the job retries with a pause.
- A permanent refusal of the recipient is recorded as a bounce and the address
  is suppressed.
- If a run ends without a known outcome (crash, timeout, a connection that broke
  mid-message), the next step is to look for the Message-ID in the Sent folder.
  Found: it counts as sent. Not found, or no way to tell: the email is marked
  failed with an explanation and the operator decides (Retry, or "It was sent").
  The app never re-sends on a guess.
- The recipient checks and the daily cap run once more inside the send job.

## AI

- Four kinds of call, all structured output validated in code: research, write,
  check, read a reply. No agent loop, no tools given to the model.
- Website and email text is wrapped as untrusted data in every prompt.
- List sizes and rating ranges are stated in the schema descriptions and enforced
  in code after the call, not as schema constraints: the API's schema format does
  not carry them, and a strict local check would discard a paid answer.
- Every call records tokens and estimated cost in `ai_usage`. Work stops for the
  month when the monthly budget is reached. The cost of each email is stored on
  it; the cost of each investigation on its row.
- Prompt versions (`research-2`, `outreach-2`) are stored with each result.

## Security and privacy

- Secrets (model, search and crawl keys, the mailbox app password) are read from
  the environment only; the Settings page shows status, never values.
- No authentication: this is a local single-operator tool. Sending is disabled on
  serverless deployments. Do not put a mailbox or model key on a public
  deployment, and do not ship a database snapshot that contains `inbound_emails`
  or `suppressions` to one.
- Only replies to outreach are stored from the mailbox; nothing else is read into
  the database.
- Addresses are only ever those a business published on its own site, its
  listing, or ones the operator typed. Nothing is guessed. Provenance is stored.
- Crawling: robots.txt respected, URL guard, bot-protection pages recorded and
  never bypassed.

## Trade-offs accepted

- SQLite with one connection and no multi-statement transactions: simple and
  enough for one operator; atomic work is a single statement or a batch.
- The worker lives in the app process: automation runs while the app runs.
  Unattended operation needs an always-on host with authentication in front.
- SMTP + IMAP with an app password instead of a provider API: works with almost
  any mailbox with three lines of configuration; no delivery receipts beyond
  "accepted" and bounces, and no open tracking (by choice).
- The operator answers replies from their own mail program; the app suggests and
  records, it does not compose. Replies the operator sends are not synced back.
