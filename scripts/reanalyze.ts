/**
 * Re-analyze stored pages with the current research prompt (no Firecrawl credits;
 * one model call per business that has a public email), then optionally write the
 * emails for the businesses that qualify. Stop `pnpm dev` first, or two workers
 * compete for the jobs.
 *
 *   pnpm exec tsx --env-file=.env scripts/reanalyze.ts --limit 3             # the first three by priority
 *   pnpm exec tsx --env-file=.env scripts/reanalyze.ts "Northside Air" "Harbour Plumbing"  # by name
 *   pnpm exec tsx --env-file=.env scripts/reanalyze.ts --all --emails         # everything researched, then write the emails
 *   pnpm exec tsx --env-file=.env scripts/reanalyze.ts --all --emails-only    # only write the emails that are queued
 */
import { desc, eq, inArray, like, or } from "drizzle-orm";
import { closeDatabase, getDb } from "@/db/client";
import { businesses, opportunities, outreachDrafts } from "@/db/schema";
import { monthSpendUsd } from "@/lib/ai/usage";
import { enqueueInvestigation } from "@/lib/jobs/handlers";
import { drainQueue } from "@/lib/jobs/worker";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : null;
const names = args.filter((a, i) => !a.startsWith("--") && !(limitArg >= 0 && i === limitArg + 1));

const db = await getDb();
const before = await monthSpendUsd();
let rows = await db.select().from(businesses).where(eq(businesses.status, "profiled")).orderBy(desc(businesses.priority)).all();
if (names.length) rows = await db.select().from(businesses).where(or(...names.map((n) => like(businesses.name, `%${n}%`)))).all();
else if (!flag("all")) rows = rows.slice(0, limit ?? 3);
if (limit && flag("all")) rows = rows.slice(0, limit);

if (!flag("emails-only")) {
  for (const b of rows) await enqueueInvestigation(b.id, "reanalyze");
  console.log(`Re-analyzing ${rows.length} business(es) from stored pages…`);
  await drainQueue(["investigate_business"], 200);
}
if (flag("emails") || flag("emails-only")) {
  const n = await drainQueue(["generate_outreach"], 200);
  console.log(`Ran ${n} email-writing job(s).`);
}

const after = await db.select().from(businesses).where(inArray(businesses.id, rows.map((r) => r.id))).orderBy(desc(businesses.priority)).all();
for (const b of after) {
  const opps = await db.select().from(opportunities).where(eq(opportunities.businessId, b.id)).orderBy(opportunities.rank).all();
  const live = (await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, b.id)).all()).filter((d) => d.status !== "archived");
  console.log(`\n■ ${b.name} — ${b.verdict}${b.priority != null ? ` (priority ${b.priority}, attractive ${b.bestAttractiveness}, confidence ${b.bestConfidence})` : ""} · ${b.email ?? "no email"} [${b.emailStatus ?? "-"}]`);
  console.log(`  ${(b.verdictReasons ?? []).join(" ")}`);
  for (const o of opps) console.log(`  ${o.role === "primary" ? "★" : "·"} [${o.source}] ${o.title} — ${(o.components ?? []).map((c) => c.name).join(" + ") || "single idea"} (evidence: ${o.supportingFactKeys.join(", ")})`);
  for (const d of live) console.log(`  ✉ ${d.status}: "${d.subject}" ($${d.costUsd.toFixed(3)})${d.validation?.issues.length ? ` — ${d.validation.issues.map((i) => `${i.severity}:${i.code}`).join(", ")}` : ""}`);
}
const spent = (await monthSpendUsd()) - before;
console.log(`\nAI spend this run: $${spent.toFixed(2)} (this month so far: $${(await monthSpendUsd()).toFixed(2)})`);
closeDatabase();
