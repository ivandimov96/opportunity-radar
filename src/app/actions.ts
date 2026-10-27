"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { businesses, outreachDrafts, searches, searchResults } from "@/db/schema";
import { csvToCandidates, upsertCandidate, type DiscoveryProviderKey } from "@/lib/discovery";
import { newId, nowIso } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { kickWorker } from "@/lib/jobs/kick";
import { enqueueAnalysis, enqueueOutreach, enqueueResearch } from "@/lib/jobs/handlers";
import { addValidationSignal, ensureProspect, logActivity, setNextAction, setStage } from "@/lib/pipeline/prospects";
import { PIPELINE_STAGE_KEYS, type PipelineStage, type ValidationSignalType } from "@/lib/pipeline/stages";
import { seedDemo } from "@/db/seed-demo";
import type { OutreachStyle } from "@/lib/ai/prompts";

const str = (fd: FormData, k: string) => (fd.get(k)?.toString() ?? "").trim();

const SearchInput = z.object({
  name: z.string().min(1).max(120),
  industry: z.string().min(1),
  categoryQuery: z.string().max(200).optional(),
  keywords: z.string().max(200).optional(),
  country: z.string().min(2).max(2).default("US"),
  region: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  maxResults: z.coerce.number().int().min(1).max(500).default(50),
  requireWebsite: z.boolean(),
  autoResearch: z.boolean(),
  providers: z.array(z.enum(["osm", "google_places", "demo"])).min(1),
});

export async function createSearch(fd: FormData) {
  const parsed = SearchInput.safeParse({
    name: str(fd, "name") || `${str(fd, "industry")} in ${str(fd, "city") || str(fd, "region") || str(fd, "country")}`,
    industry: str(fd, "industry"),
    categoryQuery: str(fd, "categoryQuery") || undefined,
    keywords: str(fd, "keywords") || undefined,
    country: str(fd, "country").toUpperCase() || "US",
    region: str(fd, "region") || undefined,
    city: str(fd, "city") || undefined,
    maxResults: str(fd, "maxResults") || 50,
    requireWebsite: fd.get("requireWebsite") === "on",
    autoResearch: fd.get("autoResearch") === "on",
    providers: fd.getAll("providers").map(String),
  });
  if (!parsed.success) redirect(`/searches/new?error=${encodeURIComponent(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))}`);
  const v = parsed.data;
  const id = newId();
  getDb()
    .insert(searches)
    .values({ id, name: v.name, industry: v.industry, categoryQuery: v.categoryQuery ?? null, keywords: v.keywords ?? null, country: v.country, region: v.region ?? null, city: v.city ?? null, maxResults: v.maxResults, requireWebsite: v.requireWebsite, autoResearch: v.autoResearch, providers: v.providers as DiscoveryProviderKey[], status: "queued", isDemo: v.providers.length === 1 && v.providers[0] === "demo" })
    .run();
  enqueueJob("discover_search", { searchId: id }, { idempotencyKey: `discover:${id}` });
  kickWorker();
  redirect(`/searches/${id}`);
}

export async function rerunSearch(fd: FormData) {
  const id = str(fd, "searchId");
  getDb().update(searches).set({ status: "queued", error: null, updatedAt: nowIso() }).where(eq(searches.id, id)).run();
  enqueueJob("discover_search", { searchId: id }, { idempotencyKey: `discover:${id}` });
  kickWorker();
  revalidatePath(`/searches/${id}`);
}

export async function researchBusinessAction(fd: FormData) {
  const id = str(fd, "businessId");
  const analyze = fd.get("analyze") !== "off";
  enqueueResearch(id, { analyze });
  kickWorker();
  revalidatePath(`/businesses/${id}`);
}

export async function analyzeBusinessAction(fd: FormData) {
  const id = str(fd, "businessId");
  enqueueAnalysis(id);
  kickWorker();
  revalidatePath(`/businesses/${id}`);
}

export async function researchSearchResults(fd: FormData) {
  const searchId = str(fd, "searchId");
  const onlyNew = fd.get("onlyUnresearched") === "on";
  const db = getDb();
  const rows = db.select({ business: businesses }).from(searchResults).innerJoin(businesses, eq(searchResults.businessId, businesses.id)).where(eq(searchResults.searchId, searchId)).all();
  let n = 0;
  for (const { business } of rows) {
    if (!business.website || business.isDemo) continue;
    if (onlyNew && business.researchStatus === "done") continue;
    enqueueResearch(business.id, { analyze: true });
    n++;
  }
  if (n > 0) kickWorker();
  revalidatePath(`/searches/${searchId}`);
  if (n === 0) logActivityNoop();
}

function logActivityNoop() {
  /* nothing queued: all results already researched or have no website */
}

export async function generateDraftAction(fd: FormData) {
  const businessId = str(fd, "businessId");
  const opportunityId = str(fd, "opportunityId") || null;
  const style = (["concise", "consultative", "casual"].includes(str(fd, "style")) ? str(fd, "style") : "concise") as OutreachStyle;
  enqueueOutreach(businessId, opportunityId, style, str(fd, "senderName") || null);
  kickWorker();
  revalidatePath(`/businesses/${businessId}`);
}

export async function updateDraftAction(fd: FormData) {
  const id = str(fd, "draftId");
  const businessId = str(fd, "businessId");
  const status = str(fd, "status");
  const db = getDb();
  const cur = db.select().from(outreachDrafts).where(eq(outreachDrafts.id, id)).get();
  if (!cur) return;
  const subject = str(fd, "subject");
  const body = str(fd, "body");
  const edited = subject !== (cur.subject ?? "") || body !== cur.body;
  db.update(outreachDrafts)
    .set({ subject, body, status: ["draft", "approved", "archived"].includes(status) ? status : cur.status, editedByUser: cur.editedByUser || edited, updatedAt: nowIso() })
    .where(eq(outreachDrafts.id, id))
    .run();
  if (status === "approved" && cur.status !== "approved") logActivity(businessId, "system", "Outreach draft approved for manual sending.", { draftId: id });
  if (edited) logActivity(businessId, "note", "Outreach draft edited by operator.", { draftId: id });
  revalidatePath(`/businesses/${businessId}`);
}

export async function updateStageAction(fd: FormData) {
  const businessId = str(fd, "businessId");
  const stage = str(fd, "stage") as PipelineStage;
  if (!PIPELINE_STAGE_KEYS.includes(stage)) return;
  setStage(businessId, stage, str(fd, "note") || undefined);
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/pipeline");
}

export async function addNoteAction(fd: FormData) {
  const businessId = str(fd, "businessId");
  const content = str(fd, "content");
  const type = ["note", "call", "email", "meeting"].includes(str(fd, "type")) ? str(fd, "type") : "note";
  if (!content) return;
  ensureProspect(businessId);
  logActivity(businessId, type, content);
  if (type !== "note") {
    const db = getDb();
    const { prospects } = await import("@/db/schema");
    const p = db.select().from(prospects).where(eq(prospects.businessId, businessId)).get();
    if (p && ["discovered", "researched", "qualified", "outreach_ready"].includes(p.stage)) setStage(businessId, "contacted", `${type} logged`);
  }
  revalidatePath(`/businesses/${businessId}`);
}

export async function setNextActionAction(fd: FormData) {
  const businessId = str(fd, "businessId");
  const nextAction = str(fd, "nextAction") || null;
  const at = str(fd, "nextActionAt") || null;
  const priority = ["low", "normal", "high"].includes(str(fd, "priority")) ? str(fd, "priority") : undefined;
  setNextAction(businessId, nextAction, at ? new Date(at).toISOString() : null, priority);
  revalidatePath(`/businesses/${businessId}`);
}

export async function addValidationSignalAction(fd: FormData) {
  const businessId = str(fd, "businessId");
  const category = str(fd, "category");
  const type = str(fd, "signalType") as ValidationSignalType;
  if (!category || !type) return;
  addValidationSignal(businessId, category, type, str(fd, "notes") || undefined);
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/patterns");
}

export async function importCsvAction(fd: FormData) {
  const file = fd.get("file");
  const industry = str(fd, "industry") || "generic";
  const country = (str(fd, "country") || "US").toUpperCase();
  const city = str(fd, "city") || null;
  const region = str(fd, "region") || null;
  const autoResearch = fd.get("autoResearch") === "on";
  if (!(file instanceof File) || file.size === 0) redirect("/import?error=Choose%20a%20CSV%20file");
  if (file.size > 5_000_000) redirect("/import?error=File%20too%20large%20(5MB%20max)");
  const text = await file.text();
  const { candidates, errors } = csvToCandidates(text, { country, city, region });
  if (!candidates.length) redirect(`/import?error=${encodeURIComponent(errors.join("; ") || "No rows found")}`);
  const db = getDb();
  const id = newId();
  db.insert(searches).values({ id, name: `CSV import: ${file.name}`, industry, country, region, city, maxResults: candidates.length, providers: ["csv"], requireWebsite: false, autoResearch, status: "done", stats: { providerResults: { csv: { found: candidates.length, error: errors.length ? `${errors.length} row error(s): ${errors.slice(0, 3).join("; ")}` : undefined } }, created: 0, merged: 0, skippedNoWebsite: 0, total: 0, attribution: ["Operator-supplied CSV import"] } }).run();
  let created = 0;
  let merged = 0;
  let rank = 0;
  for (const c of candidates) {
    const r = upsertCandidate(db, c, { industry, searchId: id });
    rank++;
    if (r.wasNew) created++;
    else merged++;
    db.insert(searchResults).values({ searchId: id, businessId: r.businessId, rank, wasNew: r.wasNew }).onConflictDoNothing().run();
    ensureProspect(r.businessId);
    if (autoResearch) {
      const b = db.select({ website: businesses.website }).from(businesses).where(eq(businesses.id, r.businessId)).get();
      if (b?.website) enqueueResearch(r.businessId, { analyze: true });
    }
  }
  const s = db.select().from(searches).where(eq(searches.id, id)).get()!;
  db.update(searches).set({ stats: { ...s.stats!, created, merged, total: rank } }).where(eq(searches.id, id)).run();
  if (autoResearch) kickWorker();
  redirect(`/searches/${id}`);
}

export async function updateWebsiteAction(fd: FormData) {
  const id = str(fd, "businessId");
  const { normalizeWebsite, websiteDomain } = await import("@/lib/discovery/normalize");
  const website = normalizeWebsite(str(fd, "website"));
  const db = getDb();
  db.update(businesses).set({ website, websiteDomain: websiteDomain(website), researchStatus: website ? "not_started" : "no_website", updatedAt: nowIso() }).where(eq(businesses.id, id)).run();
  logActivity(id, "note", website ? `Website set to ${website}` : "Website cleared");
  if (website && fd.get("research") === "on") {
    enqueueResearch(id, { analyze: true });
    kickWorker();
  }
  revalidatePath(`/businesses/${id}`);
}

export async function seedDemoAction() {
  seedDemo();
  revalidatePath("/");
  redirect("/searches");
}

export async function deleteBusinessAction(fd: FormData) {
  const id = str(fd, "businessId");
  getDb().delete(businesses).where(eq(businesses.id, id)).run();
  revalidatePath("/businesses");
  redirect("/businesses");
}
