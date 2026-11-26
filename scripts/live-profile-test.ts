/**
 * Live check of the profile-driven research and writing: researches the named businesses and writes their
 * first email, then prints what came out. It spends (the model and Firecrawl): run it only with the founder's
 * approval, and against a copy of the database:
 *
 *   DATABASE_PATH=/path/to/copy.db MAIL_PROVIDER=fake EMBEDDED_WORKER=false \
 *     pnpm exec tsx --env-file=.env.development.local scripts/live-profile-test.ts "Business one" "Business two"
 *
 * Nothing is sent: only research and writing jobs are run.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aiUsage, businesses, investigations, observations, opportunities, outreachDrafts } from "@/db/schema";
import { enqueueInvestigation, enqueueOutreach } from "@/lib/jobs/handlers";
import { drainQueue } from "@/lib/jobs/worker";

const started = new Date().toISOString();
const db = await getDb();
const names = process.argv.slice(2);
const targets = await db.select().from(businesses).where(inArray(businesses.name, names)).all();
// EMAILS_ONLY=1 keeps the research as it is and only writes emails that are missing (for comparing prompt versions).
if (!process.env.EMAILS_ONLY) {
  for (const t of targets) await enqueueInvestigation(t.id);
  await drainQueue(["investigate_business"]);
}

for (const t of targets) {
  const b = (await db.select().from(businesses).where(eq(businesses.id, t.id)).get())!;
  if (b.verdict !== "qualified" && b.verdict !== "needs_review") continue;
  const written = await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, t.id)).all();
  const ideas = await db.select().from(opportunities).where(eq(opportunities.businessId, t.id)).all();
  // REWRITE=1 writes the email again even when one exists (the unsent one is replaced).
  if ((!written.length || process.env.REWRITE) && ideas.length) await enqueueOutreach(t.id).catch((e) => console.log("could not queue the email:", String(e)));
}
await drainQueue(["generate_outreach"]);

for (const t of targets) {
  const b = (await db.select().from(businesses).where(eq(businesses.id, t.id)).get())!;
  const inv = (await db.select().from(investigations).where(eq(investigations.businessId, t.id)).orderBy(desc(investigations.startedAt)).all())[0];
  console.log(`\n==================== ${b.name} (${b.website})`);
  console.log(`verdict: ${b.verdict} | pages ${inv?.pagesFetched} | credits ${inv?.creditsUsed} | prompt ${inv?.promptVersion} | ${b.statusMessage ?? ""}`);
  console.log(`reasons: ${(b.verdictReasons ?? []).join(" | ")}`);
  if (inv?.verdictReason) console.log(`research said: ${inv.verdictReason}`);
  for (const o of await db.select().from(observations).where(eq(observations.businessId, t.id)).all()) console.log(`  obs ${o.ref} [${o.kind}] ${o.statement}`);
  for (const o of await db.select().from(opportunities).where(eq(opportunities.businessId, t.id)).all()) {
    console.log(`  IDEA (${o.role}, ${o.category}, ${o.scope}) ${o.title}  [A${o.attractivenessScore}/C${o.confidenceScore}]`);
    console.log(`     angle: ${o.salesAngle}`);
    console.log(`     first step: ${o.proposedSolution}`);
    console.log(`     why: ${o.whyRelevant}`);
  }
  for (const d of await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, t.id)).all()) {
    console.log(`  EMAIL [${d.status}] to ${d.toEmail} | prompt ${d.promptVersion}`);
    console.log(`  Subject: ${d.subject}`);
    console.log(d.body.split("\n").map((l) => `  | ${l}`).join("\n"));
    for (const i of d.validation?.issues ?? []) console.log(`     ${i.severity}: ${i.message}`);
  }
}
const calls = (await db.select().from(aiUsage).orderBy(desc(aiUsage.createdAt)).limit(60).all()).filter((u) => u.createdAt >= started);
console.log(`\nAI calls in this run: ${calls.length}, $${calls.reduce((s, u) => s + (u.estimatedCostUsd ?? 0), 0).toFixed(3)} (${calls.map((u) => u.stage).join(", ")})`);
process.exit(0);
