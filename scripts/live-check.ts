/**
 * Live smoke check against real external services (no AI key needed):
 * 1. OpenStreetMap discovery for the pilot market via the job queue.
 * 2. Website research of the first discovered business with a website.
 * Run with the dev server up (its embedded worker processes the jobs) or it
 * drains the queue itself when no worker picks the job up.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, observations, pages, researchRuns, searchResults, searches } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { drainQueue } from "@/lib/jobs/worker";
import { enqueueResearch } from "@/lib/jobs/handlers";

const db = getDb();
const city = process.argv[2] ?? "Austin";
const region = process.argv[3] ?? "TX";
const industry = process.argv[4] ?? "auto_repair";
const id = newId();
db.insert(searches).values({ id, name: `LIVE CHECK ${industry} ${city}`, industry, country: "US", region, city, maxResults: 15, providers: ["osm"], requireWebsite: true }).run();
enqueueJob("discover_search", { searchId: id }, { idempotencyKey: `discover:${id}` });
console.log("Discovery job queued; draining locally…");
await drainQueue(["discover_search"]);
const s = db.select().from(searches).where(eq(searches.id, id)).get()!;
console.log("Search status:", s.status, JSON.stringify(s.stats), s.error ?? "");
const rows = db.select({ b: businesses }).from(searchResults).innerJoin(businesses, eq(searchResults.businessId, businesses.id)).where(eq(searchResults.searchId, id)).all();
for (const { b } of rows) console.log(` - ${b.name} | ${b.website ?? "-"} | ${b.phone ?? "-"} | ${b.street ?? ""}`);
const target = rows.find((r) => r.b.website)?.b;
if (!target) {
  console.log("No business with a website to research.");
  process.exit(0);
}
console.log(`\nResearching ${target.name} (${target.website}) …`);
enqueueResearch(target.id, { analyze: false });
await drainQueue(["research_business"]);
const run = db.select().from(researchRuns).where(eq(researchRuns.businessId, target.id)).get()!;
console.log("Run:", run.status, `pages ${run.pagesFetched}/${run.pagesFetched + run.pagesFailed}`, run.error ?? "", (run.notes ?? []).join(" | "));
for (const p of db.select().from(pages).where(eq(pages.businessId, target.id)).all()) console.log(`   page ${p.kind} ${p.url} -> ${p.statusCode ?? p.error} (${(p.text ?? "").length} chars)`);
for (const o of db.select().from(observations).where(eq(observations.businessId, target.id)).all()) console.log(`   [${o.kind}/${o.method}] ${o.statement} — "${(o.evidenceQuote ?? "").slice(0, 70)}"`);
console.log(`\nOpen http://localhost:3000/businesses/${target.id}`);
