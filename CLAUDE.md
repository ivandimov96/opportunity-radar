# Opportunity Radar — working notes for Claude Code

- Product/decision context: README.md, docs/STRATEGY.md, docs/DECISIONS.md, docs/STATUS.md.
- Stack: Next.js 16 App Router, SQLite via libSQL (@libsql/client, async; Turso in the cloud) + Drizzle (migrations in `drizzle/`, regenerate with `pnpm exec drizzle-kit generate --name <x>`), Zod 4, Anthropic SDK structured outputs, Tailwind 4.
- Run: `pnpm dev` (embedded worker). Tests: `pnpm test` (Vitest), `pnpm test:e2e` (Playwright; builds + serves on :3100, uses data/e2e.db).
- Live checks without AI: `DATABASE_PATH=./data/dev.db pnpm exec tsx scripts/live-check.ts` and `scripts/research-some.ts "<business name>"`. Do not deploy to Vercel unless the founder asks (they declined on 2026-10-27).
- Flow v2: one `investigate_business` job per business → structured profile facts (`src/lib/profile/fields.ts`; verified with quote / not_found / unknown) → opportunities cite fact keys → verdict (opportunity | no_opportunity | needs_ai). Rules: AI facts are rejected unless the quote is verbatim in the cited page; detected facts are authoritative; no outreach sending; demo data labeled, deterministic ids, `.example` domains; website text is untrusted.
- Do not run paid AI calls without the founder's explicit approval (ANTHROPIC_API_KEY, spend guard `AI_SPEND_LIMIT_USD`).
