"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getConfig } from "@/lib/config";
import { businesses, jobs, outreachDrafts, prospects, searches, searchResults } from "@/db/schema";
import { csvToCandidates, upsertCandidate, type DiscoveryProviderKey } from "@/lib/discovery";
import { normalizeWebsite, websiteDomain } from "@/lib/discovery/normalize";
import { newId, nowIso } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { kickWorker } from "@/lib/jobs/kick";
import { enqueueInvestigation, enqueueOutreach } from "@/lib/jobs/handlers";
import { addValidationSignal, ensureProspect, logActivity, setNextAction, setStage } from "@/lib/pipeline/prospects";
import { PIPELINE_STAGE_KEYS, type PipelineStage, type ValidationSignalType } from "@/lib/pipeline/stages";
import { seedDemo } from "@/db/seed-demo";
import type { OutreachStyle } from "@/lib/ai/prompts";
import { parseSearchForm, type RawSearchValues, type SearchFieldErrors } from "@/lib/search-input";

const str = (fd: FormData, k: string) => (fd.get(k)?.toString() ?? "").trim();

export type CreateSearchState = { errors: SearchFieldErrors; values: RawSearchValues } | null;

/** Validates the search form; returns field errors (re-rendering the form with the submitted values) or starts discovery and redirects. */
export async function createSearch(_prev: CreateSearchState, fd: FormData): Promise<CreateSearchState> {
  const parsed = parseSearchForm(fd);
  if (!parsed.ok) return { errors: parsed.errors, values: parsed.raw };
  const { values: v, filters, name } = parsed;
  const id = newId();
  const db = await getDb();
  await db
    .insert(searches)
    .values({ id, name, industry: v.industry, categoryQuery: v.categoryQuery ?? null, keywords: v.keywords ?? null, country: v.country, region: v.region ?? null, city: v.city ?? null, maxResults: v.maxResults, requireWebsite: v.requireWebsite, autoInvestigate: v.autoInvestigate, filters, providers: v.providers as DiscoveryProviderKey[], status: "queued", isDemo: v.providers.length === 1 && v.providers[0] === "demo" })
    .run();
  await enqueueJob("discover_search", { searchId: id }, { idempotencyKey: `discover:${id}` });
  kickWorker();
  redirect(`/searches/${id}`);
}

export async function rerunSearch(fd: FormData) {
  const id = str(fd, "searchId");
  const db = await getDb();
  await db.update(searches).set({ status: "queued", error: null, updatedAt: nowIso() }).where(eq(searches.id, id)).run();
  await enqueueJob("discover_search", { searchId: id }, { idempotencyKey: `discover:${id}` });
  kickWorker();
  revalidatePath(`/searches/${id}`);
}

export async function investigateAction(fd: FormData) {
  const id = str(fd, "businessId");
  await enqueueInvestigation(id);
  kickWorker();
  revalidatePath(`/businesses/${id}`);
}

/** Investigate every un-investigated business with a website in a search (or in a list of ids). */
export async function investigateManyAction(fd: FormData) {
  const db = await getDb();
  const searchId = str(fd, "searchId");
  const ids = fd.getAll("businessId").map(String).filter(Boolean);
  const includeDone = fd.get("includeDone") === "on";
  const includeChains = fd.get("includeChains") === "on";
  const cols = { id: businesses.id, website: businesses.website, status: businesses.status, isDemo: businesses.isDemo, leadScore: businesses.leadScore, kind: businesses.kind };
  let targets: { id: string; website: string | null; status: string; isDemo: boolean; leadScore: number | null; kind: string }[] = [];
  if (searchId) {
    targets = await db.select(cols).from(searchResults).innerJoin(businesses, eq(searchResults.businessId, businesses.id)).where(eq(searchResults.searchId, searchId)).all();
  } else if (ids.length) {
    targets = await db.select(cols).from(businesses).where(inArray(businesses.id, ids)).all();
  }
  // Best leads first: the queue is FIFO, so enqueue order is investigation order.
  targets.sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
  let n = 0;
  for (const t of targets) {
    if (t.isDemo) continue;
    if (t.kind === "chain" && !includeChains) continue;
    if (!t.website && !getConfig().RESEARCH_FIND_WEBSITE) continue;
    if (!includeDone && t.status === "profiled") continue;
    if (t.status === "queued" || t.status === "investigating") continue;
    await enqueueInvestigation(t.id);
    n++;
  }
  if (n) kickWorker();
  revalidatePath(searchId ? `/searches/${searchId}` : "/businesses");
}

export async function generateDraftAction(fd: FormData) {
  const businessId = str(fd, "businessId");
  const opportunityId = str(fd, "opportunityId") || null;
  const style = (["concise", "consultative", "casual"].includes(str(fd, "style")) ? str(fd, "style") : "concise") as OutreachStyle;
  await enqueueOutreach(businessId, opportunityId, style, str(fd, "senderName") || null);
  kickWorker();
  revalidatePath(`/businesses/${businessId}`);
}

export async function updateDraftAction(fd: FormData) {
  const id = str(fd, "draftId");
  const businessId = str(fd, "businessId");
  const status = str(fd, "status");
  const db = await getDb();
  const cur = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, id)).get();
  if (!cur) return;
  const subject = str(fd, "subject");
  const body = str(fd, "body");
  const edited = subject !== (cur.subject ?? "") || body !== cur.body;
  await db
    .update(outreachDrafts)
    .set({ subject, body, status: ["draft", "approved", "archived"].includes(status) ? status : cur.status, editedByUser: cur.editedByUser || edited, updatedAt: nowIso() })
    .where(eq(outreachDrafts.id, id))
    .run();
  if (status === "approved" && cur.status !== "approved") await logActivity(businessId, "system", "Outreach draft approved for manual sending.", { draftId: id });
  if (edited) await logActivity(businessId, "note", "Outreach draft edited by operator.", { draftId: id });
  revalidatePath(`/businesses/${businessId}`);
}

export async function updateStageAction(fd: FormData) {
  const businessId = str(fd, "businessId");
  const stage = str(fd, "stage") as PipelineStage;
  if (!PIPELINE_STAGE_KEYS.includes(stage)) return;
  await setStage(businessId, stage, str(fd, "note") || undefined);
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/pipeline");
}

export async function addNoteAction(fd: FormData) {
  const businessId = str(fd, "businessId");
  const content = str(fd, "content");
  const type = ["note", "call", "email", "meeting"].includes(str(fd, "type")) ? str(fd, "type") : "note";
  if (!content) return;
  await ensureProspect(businessId);
  await logActivity(businessId, type, content);
  if (type !== "note") {
    const db = await getDb();
    const p = await db.select().from(prospects).where(eq(prospects.businessId, businessId)).get();
    if (p && ["lead", "qualified"].includes(p.stage)) await setStage(businessId, "contacted", `${type} logged`);
  }
  revalidatePath(`/businesses/${businessId}`);
}

export async function setNextActionAction(fd: FormData) {
  const businessId = str(fd, "businessId");
  const nextAction = str(fd, "nextAction") || null;
  const at = str(fd, "nextActionAt") || null;
  const priority = ["low", "normal", "high"].includes(str(fd, "priority")) ? str(fd, "priority") : undefined;
  await setNextAction(businessId, nextAction, at ? new Date(at).toISOString() : null, priority);
  revalidatePath(`/businesses/${businessId}`);
}

export async function addValidationSignalAction(fd: FormData) {
  const businessId = str(fd, "businessId");
  const category = str(fd, "category");
  const type = str(fd, "signalType") as ValidationSignalType;
  if (!category || !type) return;
  await addValidationSignal(businessId, category, type, str(fd, "notes") || undefined);
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/patterns");
}

export async function updateWebsiteAction(fd: FormData) {
  const id = str(fd, "businessId");
  const website = normalizeWebsite(str(fd, "website"));
  const db = await getDb();
  await db.update(businesses).set({ website, websiteDomain: websiteDomain(website), status: website ? "new" : "no_website", statusMessage: website ? null : "No website on record", updatedAt: nowIso() }).where(eq(businesses.id, id)).run();
  await logActivity(id, "note", website ? `Website set to ${website}` : "Website cleared");
  if (website && fd.get("investigate") !== "off") {
    await enqueueInvestigation(id);
    kickWorker();
  }
  revalidatePath(`/businesses/${id}`);
}

export async function importCsvAction(fd: FormData) {
  const file = fd.get("file");
  const industry = str(fd, "industry") || "generic";
  const country = (str(fd, "country") || "US").toUpperCase();
  const city = str(fd, "city") || null;
  const region = str(fd, "region") || null;
  const autoInvestigate = fd.get("autoInvestigate") !== "off";
  if (!(file instanceof File) || file.size === 0) redirect("/import?error=Choose%20a%20CSV%20file");
  if (file.size > 5_000_000) redirect("/import?error=File%20too%20large%20(5MB%20max)");
  const text = await file.text();
  const { candidates, errors } = csvToCandidates(text, { country, city, region });
  if (!candidates.length) redirect(`/import?error=${encodeURIComponent(errors.join("; ") || "No rows found")}`);
  const db = await getDb();
  const id = newId();
  await db.insert(searches).values({ id, name: `CSV import: ${file.name}`, industry, country, region, city, maxResults: candidates.length, providers: ["csv"], requireWebsite: false, autoInvestigate, status: "done", stats: { providerResults: { csv: { found: candidates.length, error: errors.length ? `${errors.length} row error(s): ${errors.slice(0, 3).join("; ")}` : undefined } }, created: 0, merged: 0, skippedNoWebsite: 0, total: 0, attribution: ["Operator-supplied CSV import"] } }).run();
  let created = 0;
  let merged = 0;
  let rank = 0;
  let queued = 0;
  for (const c of candidates) {
    const r = await upsertCandidate(db, c, { industry, searchId: id });
    rank++;
    if (r.wasNew) created++;
    else merged++;
    await db.insert(searchResults).values({ searchId: id, businessId: r.businessId, rank, wasNew: r.wasNew }).onConflictDoNothing().run();
    await ensureProspect(r.businessId);
    if (autoInvestigate) {
      const b = await db.select({ website: businesses.website, status: businesses.status }).from(businesses).where(eq(businesses.id, r.businessId)).get();
      if (b?.website && b.status !== "profiled") {
        await enqueueInvestigation(r.businessId);
        queued++;
      }
    }
  }
  const s = (await db.select().from(searches).where(eq(searches.id, id)).get())!;
  await db.update(searches).set({ stats: { ...s.stats!, created, merged, total: rank } }).where(eq(searches.id, id)).run();
  if (queued) kickWorker();
  redirect(`/searches/${id}`);
}

export async function seedDemoAction() {
  await seedDemo();
  revalidatePath("/");
  redirect("/searches");
}

export async function deleteBusinessAction(fd: FormData) {
  const id = str(fd, "businessId");
  const db = await getDb();
  await db.delete(businesses).where(eq(businesses.id, id)).run();
  revalidatePath("/businesses");
  redirect("/businesses");
}

/** Requeue a failed job (attempt counter reset) so it runs again. */
export async function retryJobAction(fd: FormData) {
  const id = str(fd, "jobId");
  const db = await getDb();
  await db.update(jobs).set({ status: "queued", attempts: 0, error: null, lockedBy: null, scheduledAt: nowIso() }).where(and(eq(jobs.id, id), inArray(jobs.status, ["failed", "queued"]))).run();
  kickWorker();
  revalidatePath("/system");
}

/** Cancel a queued job: it is marked failed with an explicit reason and never picked up. */
export async function cancelJobAction(fd: FormData) {
  const id = str(fd, "jobId");
  const db = await getDb();
  const job = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  const res = await db.update(jobs).set({ status: "failed", error: "Cancelled by the operator", finishedAt: nowIso(), lockedBy: null }).where(and(eq(jobs.id, id), eq(jobs.status, "queued"))).run();
  if (job && res.rowsAffected) {
    // What the job was for must not look "in progress" forever.
    if (job.type === "discover_search") {
      await db.update(searches).set({ status: "failed", error: "Cancelled by the operator", updatedAt: nowIso() }).where(and(eq(searches.id, String(job.payload.searchId)), eq(searches.status, "queued"))).run();
    } else if (job.type === "investigate_business") {
      const businessId = String(job.payload.businessId);
      const biz = await db.select({ investigatedAt: businesses.investigatedAt }).from(businesses).where(eq(businesses.id, businessId)).get();
      await db.update(businesses).set({ status: biz?.investigatedAt ? "profiled" : "new", statusMessage: "Investigation cancelled by the operator", updatedAt: nowIso() }).where(and(eq(businesses.id, businessId), eq(businesses.status, "queued"))).run();
    }
  }
  revalidatePath("/system");
}
