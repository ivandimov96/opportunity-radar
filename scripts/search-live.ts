/**
 * Live check of the search engine against the real sources. Creates a search row
 * and runs discovery in-process (no worker), then prints what happened.
 *
 *   DATABASE_PATH=./data/dev.db pnpm exec tsx scripts/search-live.ts \
 *     --industry auto_repair --country US --region TX --city Austin --radius 8 --providers google_maps --max 100
 *
 * Flags: --industry, --segments a,b, --category (generic industry), --country, --region, --city,
 *        --radius km (omit for the whole city), --providers a,b, --max n, --keywords, --no-save
 * Stop `pnpm dev`/`pnpm start` first or run it with EMBEDDED_WORKER=false; otherwise two workers compete.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { searches, searchCandidates } from "@/db/schema";
import { runDiscovery } from "@/lib/discovery/engine";
import type { DiscoveryProviderKey } from "@/lib/discovery/types";
import { newId } from "@/lib/ids";

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args.set(argv[i].slice(2), argv[i + 1]?.startsWith("--") || argv[i + 1] == null ? "true" : argv[++i]);
const get = (k: string, d = "") => args.get(k) ?? d;

const industry = get("industry", "auto_repair");
const segments = get("segments") ? get("segments").split(",") : [];
const country = get("country", "US").toUpperCase();
const region = get("region") || null;
const city = get("city") || null;
const radius = get("radius") ? Number(get("radius")) : null;
const providers = (get("providers", "google_maps").split(",") as DiscoveryProviderKey[]).filter(Boolean);
const maxResults = Number(get("max", "100"));
const customCategory = get("category") || null;
const autoSave = get("no-save") !== "true";

const db = await getDb();
const id = newId();
const name = `LIVE ${customCategory ?? industry}${segments.length ? ` [${segments.join(",")}]` : ""} · ${[city, region, country].filter(Boolean).join(", ")}${radius ? ` · ${radius} km` : ""} · ${providers.join("+")}`;
await db
  .insert(searches)
  .values({ id, name, industry, country, region, city, maxResults, providers, requireWebsite: false, autoInvestigate: false, keywords: get("keywords") || null, filters: { segments, areaMode: radius ? "radius" : "area", radiusKm: radius ?? 15, requirePhone: false, excludeChains: true, skipKnown: false, minLeadScore: 50, autoInvestigateLimit: null, customCategory, autoSave }, status: "running" })
  .run();
const search = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
console.log(`→ ${name}`);
const t0 = Date.now();
const run = await runDiscovery(db, search, { onProgress: (m) => console.log(`   … ${m}`) });
await db.update(searches).set({ status: run.errors.length && !Object.values(run.stats.providerResults).some((r) => !r.error) ? "failed" : "done", stats: run.stats, error: run.errors.join("; ") || null }).where(eq(searches.id, id)).run();
const s = run.stats;
console.log(`✓ ${((Date.now() - t0) / 1000).toFixed(1)} s · area: ${s.area} · cached: ${s.cached} · partial: ${s.partial}`);
for (const [k, r] of Object.entries(s.providerResults)) console.log(`   ${k.padEnd(12)} ${r.error ? `ERROR ${r.error}` : `${r.found} records · ${r.cached ?? "-"} · ${r.release ?? ""} · ${((r.durationMs ?? 0) / 1000).toFixed(1)} s`}`);
console.log(`   records ${s.candidates} → unique ${s.ranked! + (s.skippedClosed ?? 0) + (s.skippedChains ?? 0) + (s.skippedNoWebsite ?? 0) + (s.skippedNoPhone ?? 0) + (s.skippedKnown ?? 0)} → listed ${s.total} (closed ${s.skippedClosed}, chains ${s.skippedChains}, known ${s.skippedKnown}) · saved ${s.saved} (${s.created} new, ${s.merged} merged)`);
const rows = await db.select().from(searchCandidates).where(eq(searchCandidates.searchId, id)).all();
const multi = rows.filter((r) => r.sources.length > 1).length;
const withSite = rows.filter((r) => r.website).length;
const withPhone = rows.filter((r) => r.phone).length;
const withEmail = rows.filter((r) => r.email).length;
console.log(`   listed: ${withSite} website · ${withPhone} phone · ${withEmail} email · ${multi} seen by both sources · ${rows.filter((r) => r.possibleDuplicateOf).length} possible duplicates`);
for (const r of rows.slice(0, 8)) console.log(`   ${String(r.rank).padStart(3)} ${r.leadScore.toString().padStart(3)} ${r.name.slice(0, 36).padEnd(36)} ${(r.websiteDomain ?? "-").padEnd(28)} ${(r.phone ?? "-").padEnd(12)} ${r.sources.map((x) => x.provider).join("+").padEnd(13)} ${r.matchedBy?.[0] ?? ""}`);
for (const n of s.notes ?? []) console.log(`   · ${n}`);
console.log(`   search id ${id}`);
process.exit(0);
