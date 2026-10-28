/** Live check: discover with websites NOT required, then investigate a few businesses that have none (exercises the website finder). */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, searchResults, searches } from "@/db/schema";
import { newId } from "@/lib/ids";
import { drainQueue } from "@/lib/jobs/worker";
import { osmProvider } from "@/lib/discovery/osm";
import { upsertCandidate } from "@/lib/discovery/dedupe";
import { enqueueInvestigation } from "@/lib/jobs/handlers";

const db = await getDb();
const n = Number(process.argv[2] ?? 5);
// Ask the provider directly so we can pick candidates WITHOUT a website (the provider lists sites-first for operators).
const result = await osmProvider.discover({ industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: 400, requireWebsite: false }, { onProgress: (m) => console.log("  ", m) });
const noSiteCands = result.candidates.filter((c) => !c.website && c.phone);
console.log(`${result.candidates.length} OSM places; ${result.candidates.filter((c) => c.website).length} with website; ${noSiteCands.length} without website but with phone`);
const id = newId();
await db.insert(searches).values({ id, name: `LIVE no-website check Austin`, industry: "auto_repair", country: "US", region: "TX", city: "Austin", maxResults: n, providers: ["osm"], requireWebsite: false, autoInvestigate: false, status: "done" }).run();
const targets: (typeof businesses.$inferSelect)[] = [];
for (const c of noSiteCands) {
  const { businessId } = await upsertCandidate(db, c, { industry: "auto_repair", searchId: id });
  const b = (await db.select().from(businesses).where(eq(businesses.id, businessId)).get())!;
  if (b.website || b.kind === "chain") continue;
  await db.insert(searchResults).values({ searchId: id, businessId, rank: targets.length + 1, wasNew: true }).onConflictDoNothing().run();
  targets.push(b);
  if (targets.length >= n) break;
}
for (const b of targets) {
  console.log(` - ${b.name} | phone ${b.phone ?? "-"} | ${b.street ?? ""} | lead ${b.leadScore}`);
  await enqueueInvestigation(b.id);
}
const t0 = Date.now();
await drainQueue(["investigate_business"]);
console.log(`\nInvestigated ${targets.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const t of targets) {
  const b = (await db.select().from(businesses).where(eq(businesses.id, t.id)).get())!;
  console.log(`== ${b.name}: ${b.status}/${b.verdict ?? "-"} · ${b.website ?? "no website"} (${b.websiteSource ?? "-"}) · ${b.statusMessage ?? ""}`);
}
