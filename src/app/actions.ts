"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { businesses, jobs, outreachDrafts, prospects, searches, searchResults } from "@/db/schema";
import { csvToCandidates, upsertCandidate, type DiscoveryProviderKey } from "@/lib/discovery";
import { normalizeWebsite, websiteDomain } from "@/lib/discovery/normalize";
import { newId, nowIso } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs/queue";
import { kickWorker } from "@/lib/jobs/kick";
import { enqueueInvestigation, enqueueOutreach } from "@/lib/jobs/handlers";
import { saveCandidates } from "@/lib/discovery/engine";
import { isFirecrawlConfigured } from "@/lib/research/firecrawl";
import { filtersOf } from "@/lib/search-input";
import { advanceStageIfBehind, ensureProspect, logActivity, moveOnBoard, setNextAction, setStage, syncStageWithVerdict } from "@/lib/pipeline/prospects";
import { PIPELINE_STAGE_KEYS, type PipelineStage } from "@/lib/pipeline/stages";
import { emailEvents, inboundEmails } from "@/db/schema";
import { suggestSubjectsFor, approveAllReady, approveDraft, excludeDraft, restoreDraft, saveDraftEdit, unapproveDraft } from "@/lib/outreach/drafts";
import { cancelQueued, retryFailed, sendCampaign } from "@/lib/outreach/send";
import { contactBlockers } from "@/lib/outreach/eligibility";
import { addSuppression, removeSuppression } from "@/lib/email/suppression";
import { checkEmailAddress, normalizeAddress } from "@/lib/email/address";
import { getSettings, saveSettings, type AppSettings } from "@/lib/settings";
import { settingsHref } from "@/lib/settings-nav";
import { chooseIdea } from "@/lib/outreach/ideas";
import { allowAgain, findRemoved, removeBusiness } from "@/lib/pipeline/removed";
import { getMailProvider } from "@/lib/mail";
import { applyReplyClassification } from "@/lib/jobs/mail-handlers";
import { maybeAutoDraft } from "@/lib/jobs/handlers";
import { REPLY_CATEGORIES, type ReplyCategory } from "@/lib/ai/schemas";
import { composeEmailBody } from "@/lib/outreach/drafts";
import { makeMessageId } from "@/lib/outreach/send";
import { parseSearchForm, type RawSearchValues, type SearchFieldErrors } from "@/lib/search-input";

const str = (fd: FormData, k: string) => (fd.get(k)?.toString() ?? "").trim();

export type CreateSearchState = { errors: SearchFieldErrors; values: RawSearchValues } | null;

/** Validates the search form; returns field errors (re-rendering the form with the submitted values) or starts discovery and redirects. */
export async function createSearch(_prev: CreateSearchState, fd: FormData): Promise<CreateSearchState> {
  await requireOwner();
  const parsed = parseSearchForm(fd);
  if (!parsed.ok) return { errors: parsed.errors, values: parsed.raw };
  const { values: v, filters, name } = parsed;
  const id = newId();
  const db = await getDb();
  await db
    .insert(searches)
    .values({ id, name, industry: v.industry, categoryQuery: v.categoryQuery ?? null, keywords: v.keywords ?? null, country: v.country, region: v.region ?? null, city: v.city ?? null, maxResults: v.maxResults, requireWebsite: v.requireWebsite, autoInvestigate: v.autoInvestigate, filters, providers: v.providers as DiscoveryProviderKey[], status: "queued" })
    .run();
  await enqueueJob("discover_search", { searchId: id }, { idempotencyKey: `discover:${id}` });
  kickWorker();
  redirect(`/searches/${id}`);
}

export async function rerunSearch(fd: FormData) {
  await requireOwner();
  const id = str(fd, "searchId");
  const db = await getDb();
  await db.update(searches).set({ status: "queued", error: null, updatedAt: nowIso() }).where(eq(searches.id, id)).run();
  await enqueueJob("discover_search", { searchId: id }, { idempotencyKey: `discover:${id}` });
  kickWorker();
  revalidatePath(`/searches/${id}`);
}

export async function investigateAction(fd: FormData) {
  await requireOwner();
  const id = str(fd, "businessId");
  const mode = fd.get("mode");
  await enqueueInvestigation(id, mode === "recrawl" || mode === "reanalyze" ? mode : "auto");
  kickWorker();
  revalidatePath(`/businesses/${id}`);
}

/** Investigate every un-investigated business with a website in a search (or in a list of ids). */
export async function investigateManyAction(fd: FormData) {
  await requireOwner();
  const db = await getDb();
  const searchId = str(fd, "searchId");
  const ids = fd.getAll("businessId").map(String).filter(Boolean);
  const includeDone = fd.get("includeDone") === "on";
  const includeChains = fd.get("includeChains") === "on";
  const cols = { id: businesses.id, website: businesses.website, status: businesses.status, leadScore: businesses.leadScore, kind: businesses.kind };
  let targets: { id: string; website: string | null; status: string; leadScore: number | null; kind: string }[] = [];
  if (searchId) {
    targets = await db.select(cols).from(searchResults).innerJoin(businesses, eq(searchResults.businessId, businesses.id)).where(eq(searchResults.searchId, searchId)).all();
  } else if (ids.length) {
    targets = await db.select(cols).from(businesses).where(inArray(businesses.id, ids)).all();
  }
  // Best leads first: the queue is FIFO, so enqueue order is investigation order.
  targets.sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
  let n = 0;
  for (const t of targets) {
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

/** Write (or rewrite) the email for a business; an optional note tells the writer what to change. */
export async function generateDraftAction(fd: FormData) {
  await requireOwner();
  const businessId = str(fd, "businessId");
  await enqueueOutreach(businessId, { step: str(fd, "step") === "1" ? 1 : 0, feedback: str(fd, "feedback") || null });
  kickWorker();
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/outreach");
}

/** Board drag: `orderedIds` is the target column top to bottom after the drop (including the moved card). */
export async function moveOnBoardAction(businessId: string, stage: PipelineStage, orderedIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner();
  if (!PIPELINE_STAGE_KEYS.includes(stage)) return { ok: false, error: "unknown stage" };
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string") || orderedIds.length > 1000) return { ok: false, error: "invalid order" };
  const cfg = getConfig();
  // Without a shared database every serverless instance has its own copy, so a move would seem to
  // succeed and then vanish (or appear to move other cards) on the next request. Refuse it honestly.
  if (cfg.serverless && !cfg.TURSO_DATABASE_URL) return { ok: false, error: "this preview has no persistent database, so moves cannot be saved (connect a Turso database in the Vercel project settings)" };
  try {
    await moveOnBoard(businessId, stage, orderedIds);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/pipeline");
  return { ok: true };
}

export async function updateStageAction(fd: FormData) {
  await requireOwner();
  const businessId = str(fd, "businessId");
  const stage = str(fd, "stage") as PipelineStage;
  if (!PIPELINE_STAGE_KEYS.includes(stage)) return;
  await setStage(businessId, stage, str(fd, "note") || undefined);
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/pipeline");
}

export async function addNoteAction(fd: FormData) {
  await requireOwner();
  const businessId = str(fd, "businessId");
  const content = str(fd, "content");
  const type = ["note", "call", "email", "meeting"].includes(str(fd, "type")) ? str(fd, "type") : "note";
  if (!content) return;
  await ensureProspect(businessId);
  await logActivity(businessId, type, content);
  if (type !== "note") {
    const db = await getDb();
    const p = await db.select().from(prospects).where(eq(prospects.businessId, businessId)).get();
    if (p && ["discovered", "researching", "qualified", "ready_to_contact"].includes(p.stage)) await setStage(businessId, "contacted", `${type} logged`);
  }
  revalidatePath(`/businesses/${businessId}`);
}

export async function setNextActionAction(fd: FormData) {
  await requireOwner();
  const businessId = str(fd, "businessId");
  const nextAction = str(fd, "nextAction") || null;
  const at = str(fd, "nextActionAt") || null;
  const priority = ["low", "normal", "high"].includes(str(fd, "priority")) ? str(fd, "priority") : undefined;
  await setNextAction(businessId, nextAction, at ? new Date(at).toISOString() : null, priority);
  revalidatePath(`/businesses/${businessId}`);
}

/** The planned next action was carried out: log it and clear it. */
export async function completeNextActionAction(fd: FormData) {
  await requireOwner();
  const businessId = str(fd, "businessId");
  const db = await getDb();
  const p = await db.select().from(prospects).where(eq(prospects.businessId, businessId)).get();
  if (!p?.nextAction) return;
  await logActivity(businessId, "note", `Done: ${p.nextAction}`, { nextActionAt: p.nextActionAt });
  await setNextAction(businessId, null, null);
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/");
}

export async function updateWebsiteAction(fd: FormData) {
  await requireOwner();
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
  await requireOwner();
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
  let removedEarlier = 0;
  for (const c of candidates) {
    // A business the operator removed earlier is not brought back by a file either.
    if (await findRemoved(db, { name: c.name, city: c.city, website: c.website, phone: c.phone, sources: [{ provider: c.provider, providerId: c.providerId }] })) {
      removedEarlier++;
      continue;
    }
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
  await db.update(searches).set({ stats: { ...s.stats!, created, merged, total: rank, skippedRemoved: removedEarlier } }).where(eq(searches.id, id)).run();
  if (queued) kickWorker();
  redirect(`/searches/${id}`);
}

/** Remove a business for good and remember it, so later searches leave it out. `returnTo` keeps the list the operator was on. */
export async function removeBusinessAction(fd: FormData) {
  await requireOwner();
  const ids = fd.getAll("businessId").map(String).filter(Boolean);
  const back = str(fd, "returnTo") || "/businesses";
  let removed = 0;
  let firstName = "";
  const problems: string[] = [];
  for (const id of ids) {
    const res = await removeBusiness(id);
    if (res.ok) {
      removed++;
      firstName ||= res.name;
    } else problems.push(res.error);
  }
  revalidatePath("/businesses");
  revalidatePath("/pipeline");
  revalidatePath("/outreach");
  if (!removed) redirect(withMessage(ids.length === 1 ? `/businesses/${ids[0]}` : back, "error", problems[0] ?? "Nothing was removed."));
  redirect(withMessage(back, problems.length ? "error" : "ok", `${removed === 1 ? `${firstName} was removed` : `${removed} businesses were removed`} and will be left out of future searches.${problems.length ? ` ${problems.length} could not be removed: ${problems[0]}` : ""}`));
}

export async function allowBusinessAgainAction(fd: FormData) {
  await requireOwner();
  await allowAgain(str(fd, "id"));
  revalidatePath("/settings");
  redirect(withMessage(settingsHref("removed"), "ok", "It can be found by a search again."));
}

/** Requeue a failed job (attempt counter reset) so it runs again. */
export async function retryJobAction(fd: FormData) {
  await requireOwner();
  const id = str(fd, "jobId");
  const db = await getDb();
  await db.update(jobs).set({ status: "queued", attempts: 0, error: null, lockedBy: null, scheduledAt: nowIso() }).where(and(eq(jobs.id, id), inArray(jobs.status, ["failed", "queued"]))).run();
  kickWorker();
  revalidatePath("/system");
}

/** Cancel a queued job: it is marked failed with an explicit reason and never picked up. */
export async function cancelJobAction(fd: FormData) {
  await requireOwner();
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


/** Save candidates of a search as businesses: the selected ids, or every listed candidate. Optionally queue the saved ones for investigation. */
export async function saveCandidatesAction(fd: FormData) {
  await requireOwner();
  const searchId = str(fd, "searchId");
  const ids = fd.getAll("candidateId").map(String).filter(Boolean);
  const all = fd.get("all") === "on";
  const investigate = fd.get("investigate") === "on";
  const db = await getDb();
  const search = await db.select().from(searches).where(eq(searches.id, searchId)).get();
  if (!search || (!all && !ids.length)) return;
  const outcome = await saveCandidates(db, search, all ? undefined : ids);
  let queued = 0;
  if (investigate && isFirecrawlConfigured()) {
    const limit = filtersOf(search).autoInvestigateLimit ?? outcome.investigable.length;
    for (const t of outcome.investigable.slice(0, limit)) {
      await enqueueInvestigation(t.id);
      queued++;
    }
    if (queued) kickWorker();
  }
  const stats = search.stats ? { ...search.stats } : null;
  if (stats) {
    stats.saved = (stats.saved ?? 0) + outcome.created + outcome.merged;
    stats.created = (stats.created ?? 0) + outcome.created;
    stats.merged = (stats.merged ?? 0) + outcome.merged;
    stats.queuedForInvestigation = (stats.queuedForInvestigation ?? 0) + queued;
    stats.notes = [...(stats.notes ?? []), `Operator saved ${outcome.created + outcome.merged} candidate(s) (${outcome.created} new, ${outcome.merged} merged)${queued ? `; ${queued} queued for investigation` : investigate ? "; investigation needs FIRECRAWL_API_KEY" : ""}`];
    await db.update(searches).set({ stats, updatedAt: nowIso() }).where(eq(searches.id, searchId)).run();
  }
  revalidatePath(`/searches/${searchId}`);
}

// ------------------------------------------------------------------ outreach
const backTo = (fd: FormData, fallback: string) => {
  const to = str(fd, "returnTo");
  return to.startsWith("/") && !to.startsWith("//") ? to : fallback;
};
/** Adds a flash message to a path; the query goes before any #section so the page still scrolls to it. */
const withMessage = (path: string, key: "ok" | "error", message: string) => {
  const [base, hash] = path.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
};

/**
 * The "Suggest" button in the subject field of the review page: one small model
 * call, started by the operator. It is submitted with the email's own form, so
 * anything typed but not saved yet is saved first and is what the subjects are
 * suggested for.
 */
export async function suggestSubjectsAction(fd: FormData) {
  await requireOwner();
  const id = str(fd, "draftId");
  const here = `/outreach/${id}`;
  if (fd.has("body")) {
    const saved = await saveDraftEdit(id, str(fd, "subject"), fd.get("body")?.toString() ?? "");
    if (!saved.ok) redirect(withMessage(here, "error", saved.error ?? "Could not save"));
  }
  let res: Awaited<ReturnType<typeof suggestSubjectsFor>>;
  try {
    res = await suggestSubjectsFor(id);
  } catch (err) {
    res = { ok: false, error: (err as Error).message.split("\n")[0] };
  }
  revalidatePath("/outreach");
  revalidatePath(here);
  redirect(withMessage(here, res.ok ? "ok" : "error", res.ok ? `${res.count} other subject${res.count === 1 ? "" : "s"} under the subject field. Click one to use it.` : (res.error ?? "Could not suggest subjects")));
}

/** Save the operator's edit of an email; "then" decides what happens next (stay, approve, approve and open the next one). */
export async function saveDraftAction(fd: FormData) {
  await requireOwner();
  const id = str(fd, "draftId");
  const then = str(fd, "then");
  const here = `/outreach/${id}`;
  const saved = await saveDraftEdit(id, str(fd, "subject"), (fd.get("body")?.toString() ?? ""));
  if (!saved.ok) redirect(withMessage(here, "error", saved.error ?? "Could not save"));
  if (then === "approve" || then === "approve_next") {
    const res = await approveDraft(id);
    if (!res.ok) redirect(withMessage(here, "error", res.error ?? "Could not approve"));
  }
  revalidatePath("/outreach");
  revalidatePath(here);
  const next = str(fd, "nextId");
  redirect(then === "approve_next" ? (next ? `/outreach/${next}` : withMessage("/outreach", "ok", "Approved. That was the last one in this list.")) : withMessage(here, "ok", then === "approve" ? "Approved" : "Saved"));
}

export async function draftStatusAction(fd: FormData) {
  await requireOwner();
  const id = str(fd, "draftId");
  const op = str(fd, "op");
  const back = backTo(fd, "/outreach");
  if (op === "approve") {
    const res = await approveDraft(id);
    if (!res.ok) redirect(withMessage(back, "error", res.error ?? "Could not approve"));
  } else if (op === "unapprove") await unapproveDraft(id);
  else if (op === "exclude") await excludeDraft(id);
  else if (op === "restore") await restoreDraft(id);
  revalidatePath("/outreach");
  revalidatePath(`/outreach/${id}`);
  redirect(back);
}

export async function approveAllReadyAction(fd: FormData) {
  await requireOwner();
  const n = await approveAllReady(str(fd, "campaignId"));
  revalidatePath("/outreach");
  redirect(withMessage("/outreach", "ok", n ? `Approved ${n} email${n === 1 ? "" : "s"}.` : "Nothing was waiting for approval."));
}

/** "Send approved emails": queues every sendable approved email of the batch at its paced time. */
export async function sendCampaignAction(fd: FormData) {
  await requireOwner();
  const res = await sendCampaign(str(fd, "campaignId"));
  revalidatePath("/outreach");
  revalidatePath("/pipeline");
  if (!res.ok) redirect(withMessage("/outreach/send", "error", res.error ?? "Nothing was sent"));
  kickWorker();
  redirect(withMessage("/outreach?tab=sent", "ok", `${res.queued} email${res.queued === 1 ? "" : "s"} queued${res.skipped ? `, ${res.skipped} held back` : ""}. They go out one at a time.`));
}

export async function cancelQueuedAction(fd: FormData) {
  await requireOwner();
  const n = await cancelQueued(str(fd, "campaignId"));
  revalidatePath("/outreach");
  redirect(withMessage("/outreach?tab=ready", "ok", n ? `Stopped. ${n} email${n === 1 ? " is" : "s are"} back under Ready, still approved.` : "Nothing was waiting to be sent."));
}

export async function retryFailedAction(fd: FormData) {
  await requireOwner();
  const ok = await retryFailed(str(fd, "draftId"));
  if (ok) kickWorker();
  revalidatePath("/outreach");
  redirect(withMessage(backTo(fd, "/outreach?tab=sent"), ok ? "ok" : "error", ok ? "Trying again now." : "This email cannot be retried."));
}

/**
 * The operator sent the email by hand (or found it in their Sent folder after an interrupted attempt): record it.
 * The app sends nothing here.
 */
export async function markDraftSentAction(fd: FormData) {
  await requireOwner();
  const id = str(fd, "draftId");
  const db = await getDb();
  const cur = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, id)).get();
  if (!cur || !["ready", "approved", "needs_review", "failed"].includes(cur.status)) redirect(backTo(fd, "/outreach"));
  const at = nowIso();
  await db.update(outreachDrafts).set({ status: "sent", sentAt: at, lastError: null, messageId: cur.messageId ?? makeMessageId(getMailProvider()?.address ?? "manual@local"), updatedAt: at }).where(eq(outreachDrafts.id, id)).run();
  await db.insert(emailEvents).values({ id: newId(), draftId: id, businessId: cur.businessId, type: "sent", detail: { by: "operator", manual: true } }).run();
  await logActivity(cur.businessId, "email", `Marked as sent by you: "${cur.subject ?? "(no subject)"}"${cur.toEmail ? ` to ${cur.toEmail}` : ""}`, { draftId: id });
  if (cur.step === 0) await advanceStageIfBehind(cur.businessId, "contacted", "outreach email sent by the operator");
  revalidatePath("/outreach");
  revalidatePath("/pipeline");
  redirect(withMessage(backTo(fd, "/outreach?tab=sent"), "ok", "Recorded as sent."));
}

/** Read the inbox now instead of waiting for the next scheduled check. */
export async function syncMailboxAction(fd: FormData) {
  await requireOwner();
  await enqueueJob("sync_mailbox", {}, { idempotencyKey: "sync_mailbox", maxAttempts: 1 });
  kickWorker();
  redirect(withMessage(backTo(fd, "/outreach?tab=sent"), "ok", "Checking the inbox now."));
}

// ------------------------------------------------------------------ business
/** Set or correct the email address of a business by hand (source: manual), then continue where research or drafting stopped. */
export async function setBusinessEmailAction(fd: FormData) {
  await requireOwner();
  const id = str(fd, "businessId");
  const back = backTo(fd, `/businesses/${id}`);
  const email = normalizeAddress(str(fd, "email"));
  const db = await getDb();
  const biz = await db.select().from(businesses).where(eq(businesses.id, id)).get();
  if (!biz) redirect(back);
  if (!email) redirect(withMessage(back, "error", "Enter an email address"));
  const check = await checkEmailAddress(email, { mx: getConfig().RESEARCH_FOOTPRINT });
  if (check.status === "invalid") redirect(withMessage(back, "error", `That address cannot be used: ${check.reason}.`));
  await db.update(businesses).set({ email, emailSource: "manual", emailSourceUrl: null, emailStatus: check.status, updatedAt: nowIso() }).where(eq(businesses.id, id)).run();
  await logActivity(id, "note", `Email address set by hand: ${email}`);
  // Emails still under review now have a recipient: re-check them (saving re-runs the recipient checks).
  const open = await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.businessId, id), inArray(outreachDrafts.status, ["needs_review", "ready", "approved"]))).all();
  const settings = await getSettings();
  for (const d of open) {
    const blockers = await contactBlockers({ ...biz, email, emailStatus: check.status }, settings);
    const issues = [...(d.validation?.issues ?? []).filter((i) => i.code !== "recipient"), ...blockers.map((message) => ({ severity: "block" as const, code: "recipient", message }))];
    const passed = !issues.some((i) => i.severity === "block");
    await db.update(outreachDrafts).set({ toEmail: email, validation: { ...(d.validation ?? { checkedAt: nowIso() }), issues, passed }, status: d.status === "approved" && passed ? "approved" : passed ? "ready" : "needs_review", updatedAt: nowIso() }).where(eq(outreachDrafts.id, d.id)).run();
  }
  // Research that stopped for lack of an address continues; a qualified business gets its email written.
  if (biz.verdict === "no_contact" && biz.website) {
    await enqueueInvestigation(id);
    kickWorker();
  } else if (await maybeAutoDraft(id)) kickWorker();
  revalidatePath(`/businesses/${id}`);
  revalidatePath("/outreach");
  redirect(withMessage(back, "ok", biz.verdict === "no_contact" ? "Saved. Research continues now." : "Saved."));
}

/** The operator's own judgement on a business the research left open: qualify it, or set it aside. */
/** The operator prefers one of the alternative ideas: make it the one outreach is built on and have its email written. */
export async function chooseIdeaAction(fd: FormData) {
  await requireOwner();
  const businessId = str(fd, "businessId");
  const res = await chooseIdea(businessId, str(fd, "opportunityId"));
  const back = `/businesses/${businessId}?tab=opportunities`;
  if (!res.ok) redirect(withMessage(back, "error", res.error));
  const writing = await maybeAutoDraft(businessId);
  if (writing) kickWorker();
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/outreach");
  redirect(withMessage(back, "ok", `“${res.title}” is now the idea to raise.${writing ? " Its email is being written." : ""}`));
}

export async function setVerdictAction(fd: FormData) {
  await requireOwner();
  const id = str(fd, "businessId");
  const verdict = str(fd, "verdict");
  if (!["qualified", "not_a_fit"].includes(verdict)) return;
  const db = await getDb();
  const reason = verdict === "qualified" ? "Qualified by you." : "Set aside by you as not a fit.";
  await db.update(businesses).set({ verdict, verdictReasons: [reason], statusMessage: verdict === "qualified" ? "Qualified by you" : "Not a fit (your decision)", updatedAt: nowIso() }).where(eq(businesses.id, id)).run();
  await logActivity(id, "note", reason);
  await syncStageWithVerdict(id, verdict);
  if (verdict === "qualified" && (await maybeAutoDraft(id))) kickWorker();
  if (verdict === "not_a_fit") await db.update(outreachDrafts).set({ status: "archived", updatedAt: nowIso() }).where(and(eq(outreachDrafts.businessId, id), inArray(outreachDrafts.status, ["needs_review", "ready", "approved", "excluded"]))).run();
  revalidatePath(`/businesses/${id}`);
  revalidatePath("/outreach");
  revalidatePath("/pipeline");
}

// -------------------------------------------------------------------- replies
/** Correct how a reply was classified. An opt-out set here is honoured exactly like one the system recognised. */
export async function reclassifyReplyAction(fd: FormData) {
  await requireOwner();
  const id = str(fd, "inboundId");
  const category = str(fd, "category") as ReplyCategory;
  if (!REPLY_CATEGORIES.includes(category)) return;
  await applyReplyClassification(id, category, "operator");
  revalidatePath(backTo(fd, "/"));
}

/** The reply was dealt with (answered from the mailbox, or nothing to do): it leaves the "to answer" list. */
export async function markReplyHandledAction(fd: FormData) {
  await requireOwner();
  const id = str(fd, "inboundId");
  const db = await getDb();
  const row = await db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).get();
  if (!row) return;
  await db.update(inboundEmails).set({ handledAt: row.handledAt ? null : nowIso() }).where(eq(inboundEmails.id, id)).run();
  if (!row.handledAt) await logActivity(row.businessId, "note", "Reply handled.", { inboundId: id });
  revalidatePath(backTo(fd, "/"));
  revalidatePath("/");
}

// ------------------------------------------------------------------- settings
export async function saveSettingsAction(fd: FormData) {
  await requireOwner();
  const section = str(fd, "section");
  const fields: Record<string, (keyof AppSettings)[]> = {
    sender: ["senderName", "senderTitle", "senderCompany", "senderWebsite", "postalAddress", "offer", "bookingLink", "voiceSamples"],
    sending: ["dailySendCap", "sendSpacingSeconds", "sendWindowStart", "sendWindowEnd", "allowedCountries", "followUpDays"],
    automation: ["autoDraft", "autoResearch", "researchPerDay", "readyBuffer", "monthlyAiBudgetUsd"],
  };
  const patch: Partial<Record<keyof AppSettings, unknown>> = {};
  for (const key of fields[section] ?? []) patch[key] = key === "autoDraft" || key === "autoResearch" ? fd.get(key) === "on" : (fd.get(key)?.toString() ?? "");
  await saveSettings(patch);
  revalidatePath("/settings");
  redirect(withMessage(settingsHref(section), "ok", "Saved."));
}

export async function addSuppressionAction(fd: FormData) {
  await requireOwner();
  const res = await addSuppression(str(fd, "value"), "manual", str(fd, "note") || null);
  revalidatePath("/settings");
  redirect(withMessage(settingsHref("do-not-contact"), res.error ? "error" : "ok", res.error ?? (res.added ? "Added to the do-not-contact list." : "Already on the list.")));
}

export async function removeSuppressionAction(fd: FormData) {
  await requireOwner();
  await removeSuppression(str(fd, "id"));
  revalidatePath("/settings");
  redirect(settingsHref("do-not-contact"));
}

/** Checks the mailbox connection (sign-in to send and to read) without sending anything. */
export async function testMailboxAction() {
  await requireOwner();
  const provider = getMailProvider();
  if (!provider) redirect(withMessage(settingsHref("mailbox"), "error", getConfig().mail.reason ?? "No mailbox is connected."));
  const r = await provider.verify();
  const problems = [r.smtp ? `Sending: ${r.smtp}` : null, r.imap ? `Reading: ${r.imap}` : null].filter(Boolean);
  redirect(withMessage(settingsHref("mailbox"), problems.length ? "error" : "ok", problems.length ? problems.join(" · ") : `Connected as ${provider.address}: sending and reading both work.`));
}

/** Sends one test email to the operator's own address, with the signature exactly as recipients will see it. */
export async function sendTestEmailAction() {
  await requireOwner();
  const provider = getMailProvider();
  if (!provider) redirect(withMessage(settingsHref("mailbox"), "error", getConfig().mail.reason ?? "No mailbox is connected."));
  const settings = await getSettings();
  try {
    await provider.send({ from: { name: settings.senderName || "Opportunity Radar", address: provider.address }, to: provider.address, subject: "Test email from Opportunity Radar", text: composeEmailBody("Hello,\n\nThis is a test from your own Opportunity Radar. If you can read it, sending works, and this is what your signature looks like.", settings), messageId: makeMessageId(provider.address) });
  } catch (err) {
    redirect(withMessage(settingsHref("mailbox"), "error", `The test email could not be sent: ${(err as Error).message}`));
  }
  redirect(withMessage(settingsHref("mailbox"), "ok", `Test email sent to ${provider.address}.`));
}
