/**
 * Live smoke check against real external services (no AI key needed):
 * 1. OpenStreetMap discovery for the pilot market via the job queue.
 * 2. Website research of the first discovered business with a website.
 * Run with the dev server up (its embedded worker processes the jobs) or it
 * drains the queue itself when no worker picks the job up.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, facts, investigations, searchResults, searches } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { drainQueue } from "@/lib/jobs/worker";
import { enqueueInvestigation } from "@/lib/jobs/handlers";

const db = await getDb();
const city = process.argv[2] ?? "Austin";
const region = process.argv[3] ?? "TX";
const industry = process.argv[4] ?? "auto_repair";
const id = newId();
await db.insert(searches).values({ id, name: `LIVE CHECK ${industry} ${city}`, industry, country: "US", region, city, maxResults: 15, providers: ["osm"], requireWebsite: true, autoInvestigate: false }).run();
await enqueueJob("discover_search", { searchId: id }, { idempotencyKey: `discover:${id}` });
console.log("Discovery job queued; draining locally…");
await drainQueue(["discover_search"]);
const s = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
console.log("Search status:", s.status, JSON.stringify(s.stats), s.error ?? "");
const rows = await db.select({ b: businesses }).from(searchResults).innerJoin(businesses, eq(searchResults.businessId, businesses.id)).where(eq(searchResults.searchId, id)).all();
for (const { b } of rows) console.log(` - ${b.name} | ${b.website ?? "-"} | ${b.phone ?? "-"} | ${b.street ?? ""}`);
const target = rows.find((r) => r.b.website)?.b;
if (!target) {
  console.log("No business with a website to research.");
  process.exit(0);
}
console.log(`\nInvestigating ${target.name} (${target.website}) …`);
await enqueueInvestigation(target.id);
await drainQueue(["investigate_business"]);
const inv = (await db.select().from(investigations).where(eq(investigations.businessId, target.id)).all()).at(-1)!;
console.log("Investigation:", inv.status, `pages ${inv.pagesFetched}/${inv.pagesFetched + inv.pagesFailed}`, `${((inv.durationMs ?? 0) / 1000).toFixed(1)}s`, inv.error ?? "", (inv.notes ?? []).join(" | "));
for (const f of await db.select().from(facts).where(eq(facts.businessId, target.id)).all()) console.log(`   ${f.status === "verified" ? "✓" : "–"} ${f.key}: ${f.value ?? ""}`);
console.log(`\nOpen http://localhost:3000/businesses/${target.id}`);
