/** Live check: re-investigate every real (non-demo, non-chain) business and print a compact report. */
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, facts, investigations, opportunities } from "@/db/schema";
import { drainQueue } from "@/lib/jobs/worker";
import { enqueueInvestigation } from "@/lib/jobs/handlers";

const db = await getDb();
const only = process.argv[2];
const rows = (await db.select().from(businesses).where(and(eq(businesses.isDemo, false), ne(businesses.kind, "chain"))).all()).filter((b) => !only || b.name.toLowerCase().includes(only.toLowerCase()));
for (const b of rows) await enqueueInvestigation(b.id);
console.log(`Queued ${rows.length} investigation(s)…`);
const t0 = Date.now();
await drainQueue(["investigate_business"]);
console.log(`Drained in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
for (const b0 of rows) {
  const b = (await db.select().from(businesses).where(eq(businesses.id, b0.id)).get())!;
  const inv = (await db.select().from(investigations).where(eq(investigations.businessId, b.id)).all()).at(-1) ?? ({ durationMs: 0, pagesFetched: 0, pagesFailed: 0, error: "no investigation row", notes: [] } as unknown as typeof investigations.$inferSelect);
  const fs = await db.select().from(facts).where(eq(facts.businessId, b.id)).all();
  const opps = await db.select().from(opportunities).where(eq(opportunities.businessId, b.id)).all();
  const verified = fs.filter((f) => f.status === "verified");
  const foot = verified.filter((f) => ["domain_registered", "site_first_seen", "email_provider", "email_senders"].includes(f.key));
  console.log(`== ${b.name} [${b.status}/${b.verdict ?? "-"}] lead ${b.leadScore} · ${((inv.durationMs ?? 0) / 1000).toFixed(1)}s · pages ${inv.pagesFetched}/${inv.pagesFetched + inv.pagesFailed} · verified ${verified.length} (${foot.length} off-site) · opps ${opps.length} · priority ${b.priority ?? "-"}`);
  if (inv.error) console.log(`   ERROR ${inv.error}`);
  for (const n of inv.notes ?? []) console.log(`   note: ${n}`);
  for (const f of verified) console.log(`   ✓ ${f.key}: ${(f.value ?? "").slice(0, 90)}${f.evidenceQuote && f.evidenceQuote !== f.value ? `  «${f.evidenceQuote.slice(0, 70)}»` : ""}`);
  console.log(`   gaps: ${fs.filter((f) => f.status === "not_found").map((f) => f.key).join(", ")}`);
  for (const o of opps.sort((a, b) => a.rank - b.rank)) console.log(`   #${o.rank} [${o.source}] ${o.title} (A${o.attractivenessScore}/C${o.confidenceScore}) ← ${o.supportingFactKeys.join(",")}`);
}
