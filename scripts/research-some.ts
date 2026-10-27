import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, facts, investigations, opportunities } from "@/db/schema";
import { drainQueue } from "@/lib/jobs/worker";
import { enqueueInvestigation } from "@/lib/jobs/handlers";

const db = await getDb();
const names = process.argv.slice(2);
const targets = await db.select().from(businesses).where(inArray(businesses.name, names)).all();
for (const t of targets) await enqueueInvestigation(t.id);
const t0 = Date.now();
await drainQueue(["investigate_business"]);
console.log(`Investigated ${targets.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s total`);
for (const t of targets) {
  const b = (await db.select().from(businesses).where(eq(businesses.id, t.id)).get())!;
  const inv = (await db.select().from(investigations).where(eq(investigations.businessId, t.id)).orderBy(investigations.startedAt).all()).at(-1)!;
  console.log(`\n== ${b.name} (${b.website}) -> ${b.status}/${b.verdict ?? "-"} in ${((inv.durationMs ?? 0) / 1000).toFixed(1)}s; pages ${inv.pagesFetched} ok / ${inv.pagesFailed} failed ${inv.error ?? ""}`);
  console.log("   notes:", (inv.notes ?? []).join(" | "));
  for (const f of await db.select().from(facts).where(eq(facts.businessId, t.id)).all()) console.log(`   ${f.status === "verified" ? "✓" : "–"} ${f.key.padEnd(22)} ${f.value ?? ""} ${f.evidenceQuote && f.evidenceQuote !== f.value ? `— "${f.evidenceQuote.slice(0, 70)}"` : ""}`);
  for (const o of await db.select().from(opportunities).where(eq(opportunities.businessId, t.id)).all()) console.log(`   ★ ${o.title} (A${o.attractivenessScore}/C${o.confidenceScore})`);
  console.log(`   http://localhost:3000/businesses/${t.id}`);
}
