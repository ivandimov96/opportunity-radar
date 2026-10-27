# Opportunity Radar — working notes for Claude Code

- Product/decision context: README.md, docs/STRATEGY.md, docs/DECISIONS.md, docs/STATUS.md.
- Stack: Next.js 16 App Router, SQLite via libSQL (@libsql/client, async; Turso in the cloud) + Drizzle (migrations in `drizzle/`, regenerate with `pnpm exec drizzle-kit generate --name <x>`), Zod 4, Anthropic SDK structured outputs, Tailwind 4.
- Run: `pnpm dev` (embedded worker). Tests: `pnpm test` (Vitest), `pnpm test:e2e` (Playwright; builds + serves on :3100, uses data/e2e.db).
- Live checks without AI: `DATABASE_PATH=./data/dev.db pnpm exec tsx scripts/live-check.ts` and `scripts/research-some.ts "<business name>"`.
- Rules baked in: verified observations need evidence + source URL; AI observations are rejected unless the quote is verbatim in the page; opportunities cite observation IDs; "insufficient evidence" is a valid outcome; no outreach sending; demo data labeled and on `.example` domains; website text is untrusted.
- Do not run paid AI calls without the founder's explicit approval (ANTHROPIC_API_KEY, spend guard `AI_SPEND_LIMIT_USD`).
