import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, observations, pages, researchRuns } from "@/db/schema";
import { drainQueue } from "@/lib/jobs/worker";
import { enqueueResearch } from "@/lib/jobs/handlers";

const db = getDb();
const names = process.argv.slice(2);
const targets = db.select().from(businesses).where(inArray(businesses.name, names)).all();
for (const t of targets) enqueueResearch(t.id, { analyze: false });
await drainQueue(["research_business"]);
for (const t of targets) {
  const run = db.select().from(researchRuns).where(eq(researchRuns.businessId, t.id)).orderBy(researchRuns.startedAt).all().at(-1)!;
  console.log(`\n== ${t.name} (${t.website}) -> ${run.status}; pages ${run.pagesFetched} ok / ${run.pagesFailed} failed ${run.error ?? ""}`);
  console.log("   notes:", (run.notes ?? []).join(" | "));
  for (const p of db.select().from(pages).where(eq(pages.researchRunId, run.id)).all()) console.log(`   page ${p.kind.padEnd(9)} ${p.statusCode ?? p.error} ${(p.text ?? "").length.toString().padStart(6)} chars  ${p.url}`);
  for (const o of db.select().from(observations).where(eq(observations.businessId, t.id)).all()) console.log(`   * [${o.category}] ${o.statement} — "${(o.evidenceQuote ?? "").slice(0, 80)}"`);
  const b = db.select().from(businesses).where(eq(businesses.id, t.id)).get()!;
  console.log(`   contact: email=${b.email ?? "-"} phone=${b.phone ?? "-"}  http://localhost:3000/businesses/${t.id}`);
}
