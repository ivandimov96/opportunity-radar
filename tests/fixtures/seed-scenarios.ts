/**
 * Sample businesses for trying the product by hand: one or two for every situation a business can
 * be in, from "just found" to "won". Everything is fictional and every address ends in `.example`,
 * which cannot receive mail. Nothing is fetched, no model is called, nothing is sent.
 *
 *   DATABASE_PATH=./data/dev.db pnpm exec tsx tests/fixtures/seed-scenarios.ts
 *
 * Running it again replaces the earlier sample businesses (they all belong to one search,
 * "Sample scenarios"); businesses that came from real searches are not touched.
 */
import { eq, inArray } from "drizzle-orm";
import { closeDatabase, getDb } from "@/db/client";
import { activities, businesses, businessSources, campaigns, emailEvents, facts, inboundEmails, investigations, observations, opportunities, outreachDrafts, pages, prospects, searches, searchResults } from "@/db/schema";
import { newId, stableId } from "@/lib/ids";
import { applyReplyClassification } from "@/lib/jobs/mail-handlers";
import { addSuppression } from "@/lib/email/suppression";
import { planFollowUps } from "@/lib/pipeline/follow-up";
import { ensureProspect } from "@/lib/pipeline/prospects";
import type { PipelineStage } from "@/lib/pipeline/stages";

const SEARCH_ID = stableId("search:sample-scenarios");
const db = await getDb();
const now = Date.now();
const ago = (days: number, hours = 0) => new Date(now - days * 86_400_000 - hours * 3_600_000).toISOString();
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- start clean: remove the sample businesses of an earlier run (and what hangs off them)
const old = await db.select({ id: searchResults.businessId }).from(searchResults).where(eq(searchResults.searchId, SEARCH_ID)).all();
if (old.length) await db.delete(businesses).where(inArray(businesses.id, old.map((o) => o.id))).run();
await db.delete(searches).where(eq(searches.id, SEARCH_ID)).run();
await db.insert(searches).values({ id: SEARCH_ID, name: "Sample scenarios", industry: "generic", country: "GB", region: "ENG", city: "Leeds", maxResults: 40, providers: ["csv"], requireWebsite: false, autoInvestigate: false, status: "done", filters: { segments: [], areaMode: "area", radiusKm: 15, requirePhone: false, excludeChains: true, skipKnown: false, minLeadScore: 0, autoInvestigateLimit: null, customCategory: "sign makers", autoSave: true }, stats: { providerResults: { csv: { found: 0 } }, created: 0, merged: 0, skippedNoWebsite: 0, total: 0, attribution: ["Sample data"] } }).run();
const campaignOpen = (await db.select().from(campaigns).where(eq(campaigns.status, "open")).get())?.id ?? (await db.insert(campaigns).values({ id: newId(), name: "Outreach (samples)", status: "open" }).returning().get()).id;
const campaignSent = (await db.insert(campaigns).values({ id: newId(), name: "Outreach (samples, sent)", status: "sent", sentAt: ago(9) }).returning().get()).id;

const HOURS = { Monday: "8 AM–5 PM", Tuesday: "8 AM–5 PM", Wednesday: "8 AM–5 PM", Thursday: "8 AM–5 PM", Friday: "8 AM–4 PM", Saturday: "Closed", Sunday: "Closed" };
const CITIES = ["Leeds", "Bradford", "Wakefield", "Huddersfield", "Harrogate", "York", "Sheffield", "Doncaster", "Halifax", "Barnsley", "Rotherham", "Hull", "Scarborough", "Keighley", "Dewsbury", "Pontefract"];
let rank = 0;

interface Sample {
  name: string;
  kind?: string;
  website?: boolean;
  email?: boolean;
  rating?: number;
  reviews?: number;
  chain?: boolean;
  foundDaysAgo?: number;
}

/** A business as a search leaves it: found, listed, not researched. */
async function found(s: Sample) {
  rank++;
  const id = stableId(`business:sample:${s.name}`);
  const domain = `${slug(s.name)}.example`;
  const city = CITIES[rank % CITIES.length];
  const website = s.website === false ? null : `https://${domain}`;
  const phone = `0113496${String(1000 + rank).slice(1)}`;
  const reviews = s.reviews ?? 12 + rank * 3;
  const rating = s.rating ?? 4.2 + (rank % 8) / 10;
  const reasons = [website ? "own website" : "no website yet (finder will try)", "phone", "street address", reviews >= 20 ? `established (${reviews} reviews, ${rating}★)` : "few reviews"];
  await db
    .insert(businesses)
    .values({ id, name: s.name, nameNormalized: s.name.toLowerCase(), industry: "generic", category: s.kind ?? "Sign shop", firstProvider: "csv", country: "GB", region: "ENG", city, street: `${10 + rank} Sample Road`, postalCode: `LS${rank} 1AA`, phone, website, websiteDomain: website ? domain : null, status: website ? "new" : "no_website", kind: s.chain ? "chain" : "independent", brand: s.chain ? "SignRight UK" : null, rating, reviewCount: reviews, leadScore: s.chain ? 35 : website ? 78 + (rank % 15) : 46, leadReasons: s.chain ? ["chain / franchise", ...reasons] : reasons, createdAt: ago(s.foundDaysAgo ?? 12), updatedAt: ago(s.foundDaysAgo ?? 12) })
    .run();
  await db.insert(businessSources).values({ id: newId(), businessId: id, provider: "csv", providerId: `sample-${slug(s.name)}`, searchId: SEARCH_ID, attribution: "Sample data", raw: { type: s.kind ?? "Sign shop", types: [s.kind ?? "Sign shop"], rating, ratingCount: reviews, openingHours: HOURS, address: `${10 + rank} Sample Road, ${city}`, cid: String(900000000000 + rank) } }).run();
  await db.insert(searchResults).values({ searchId: SEARCH_ID, businessId: id, rank, wasNew: true }).run();
  await ensureProspect(id);
  await db.insert(activities).values({ id: newId(), businessId: id, type: "system", content: "Sample business: fictional, added for trying the product.", createdAt: ago(s.foundDaysAgo ?? 12) }).run();
  return { id, domain, email: `hello@${domain}`, name: s.name, city };
}
type B = Awaited<ReturnType<typeof found>>;

/** Research ran: pages, facts, observations and (when `idea` is given) one idea with an alternative. */
async function researched(b: B, o: { verdict: "qualified" | "needs_review" | "insufficient_evidence" | "not_a_fit" | "no_contact"; reason: string; idea?: { title: string; pitch: string; category?: string }; daysAgo?: number; email?: boolean }) {
  const inv = newId();
  const site = `https://${b.domain}`;
  const at = ago(o.daysAgo ?? 10);
  const hasEmail = o.email !== false && o.verdict !== "no_contact";
  await db.insert(investigations).values({ id: inv, businessId: b.id, status: "done", startedAt: at, finishedAt: at, durationMs: 7200, pagesFetched: 4, pagesFailed: 0, factsVerified: 8, factsRejected: 0, model: "sample (no model call)", costUsd: 0, creditsUsed: 0, verdict: o.verdict, verdictReason: o.reason, workflows: [{ name: "Quote requests by form and phone", factKeys: ["estimate_policy"] }, { name: "Fitting by their own team", factKeys: ["services"] }], promptVersion: "sample" }).run();
  for (const [kind, path, text] of [["home", "/", `${b.name} makes shop signs, vehicle graphics and site hoardings in ${b.city}. Registered in England and Wales. Company number 0${1234500 + rank}. ${b.name} Ltd.`], ["services", "/services", "Shop fronts, vehicle wraps, safety signs, hoardings. Request a quote: tell us the sizes and send your artwork."], ["contact", "/contact", hasEmail ? `Email ${b.email} or call us.` : "Call us or use the form."], ["about", "/about", "A family firm since 2004, with our own fitting team."]] as const)
    await db.insert(pages).values({ id: newId(), investigationId: inv, businessId: b.id, url: `${site}${path}`, kind, statusCode: 200, title: `${b.name} · ${kind}`, text, renderer: "stored", credits: 0, fetchedAt: at }).run();
  const fact = (key: string, value: string | null, quote: string | null, path: string | null, status: "verified" | "not_found" = "verified") => db.insert(facts).values({ id: newId(), businessId: b.id, investigationId: inv, key, status, value, evidenceQuote: quote, sourceUrl: path ? `${site}${path}` : null, method: "detected" }).run();
  await fact("summary", `Sign maker in ${b.city}: shop fronts, vehicle graphics and site hoardings, fitted by their own team.`, "shop signs, vehicle graphics and site hoardings", "/");
  await fact("services", "Shop fronts, vehicle wraps, safety signs, hoardings", "Shop fronts, vehicle wraps, safety signs, hoardings.", "/services");
  await fact("years_in_business", "Since 2004", "A family firm since 2004", "/about");
  await fact("estimate_policy", "quote on request", "Request a quote: tell us the sizes and send your artwork.", "/services");
  await fact("contact_form", "yes", "Call us or use the form.", "/contact");
  await fact("phone", "on the site", "call us", "/contact");
  if (hasEmail) await fact("email", b.email, b.email, "/contact");
  else await fact("email", null, "Not detected across 4 fetched page(s)", null, "not_found");
  for (const k of ["booking_tool", "customer_updates", "chat_tool"]) await fact(k, null, "Not detected across 4 fetched page(s)", null, "not_found");
  await db.insert(observations).values({ id: newId(), businessId: b.id, investigationId: inv, ref: "o1", kind: "process", statement: "A quote starts with the customer sending sizes and artwork.", evidenceQuote: "Request a quote: tell us the sizes and send your artwork.", sourceUrl: `${site}/services` }).run();
  await db.insert(observations).values({ id: newId(), businessId: b.id, investigationId: inv, ref: "o2", kind: "offering", statement: "They fit the signs themselves.", evidenceQuote: "with our own fitting team", sourceUrl: `${site}/about` }).run();
  let oppId: string | null = null;
  if (o.idea) {
    const opp = (title: string, pitch: string, role: "primary" | "secondary", r: number, category: string, scope: string, a: number, c: number) =>
      db
        .insert(opportunities)
        .values({ id: newId(), investigationId: inv, businessId: b.id, category, rank: r, role, source: "ai", title, problemHypothesis: "Quote requests may arrive without sizes or usable artwork, so pricing takes several messages (a guess, not verified).", proposedSolution: "A short quote form per kind of sign that asks for exactly what is needed to price it, with an upload for artwork.", whyRelevant: "Their site asks customers to send sizes and artwork to get a quote.", salesAngle: pitch, expectedValue: "Fewer back-and-forth messages per quote, and quotes that go out the same day.", scope, supportingFactKeys: ["o1", "estimate_policy"], assumptions: ["Quotes are priced by hand today"], validationQuestions: ["How do quote requests reach you today?", "How often is something missing from them?"], implementationEffort: "small", reusability: "high", risks: ["They may already use a quoting tool that is not visible on the site"], aiRatings: { value: 4, feasibility: 4, evidenceStrength: 3 }, attractivenessScore: a, confidenceScore: c, scoreBreakdown: { attractiveness: [], confidence: [], notes: ["Sample data"] }, components: [{ name: "Quote form per sign type", description: "Asks for sizes, finish, fitting and artwork.", evidence: ["o1"] }, { name: "One list of open quotes", description: "Every request with what is still missing.", evidence: ["estimate_policy"] }], promptVersion: "sample" })
        .returning()
        .get();
    oppId = (await opp(o.idea.title, o.idea.pitch, "primary", 1, o.idea.category ?? "estimate_quote_followup", "existing", 82, 71)).id;
    await opp("Fitting diary customers can see", "Saw you fit the signs yourselves: do customers ever ask when the fitters are coming?", "secondary", 2, "job_tracking", "new_for_customers", 64, 55);
  }
  await db.update(businesses).set({ status: "profiled", verdict: o.verdict, verdictReasons: [o.reason], statusMessage: o.reason, summary: `Sign maker in ${b.city}: shop fronts, vehicle graphics and site hoardings, fitted by their own team.`, email: hasEmail ? b.email : null, emailSource: hasEmail ? "site" : null, emailSourceUrl: hasEmail ? `${site}/contact` : null, emailStatus: hasEmail ? "valid" : null, bestAttractiveness: o.idea ? 82 : null, bestConfidence: o.idea ? 71 : null, priority: o.idea ? 70 + (rank % 20) : null, investigatedAt: at, updatedAt: at }).where(eq(businesses.id, b.id)).run();
  await db.insert(activities).values({ id: newId(), businessId: b.id, type: "system", content: `Researched: ${o.reason}`, createdAt: at }).run();
  if (o.verdict === "qualified") await setStage(b, "qualified", at);
  return oppId;
}

async function setStage(b: B, stage: PipelineStage, at: string) {
  await db.update(prospects).set({ stage, updatedAt: at }).where(eq(prospects.businessId, b.id)).run();
  await db.insert(activities).values({ id: newId(), businessId: b.id, type: "stage_change", content: `Stage set to ${stage}`, metadata: { to: stage, automatic: true }, createdAt: at }).run();
}

const SUBJECT = "Quotes that arrive ready to price?";
const firstBody = (b: B) => `Hi ${b.name} team,\n\nI saw that a quote with you starts with the customer sending sizes and artwork. I'm Ivan, a software developer, and I wondered whether a short form that asks for exactly those things would save you a few messages per quote.\n\nMay I send a short mock-up of how it could look for ${b.name}?`;
const followBody = (b: B) => `Hi ${b.name} team,\n\nOne more thought: since you fit the signs yourselves, would it help if customers could see when the fitters are booked? If this isn't a priority, no worries at all.`;
const lastBody = (b: B) => `Hi ${b.name} team,\n\nThis is my last note on the quote form idea. If the timing is ever right, just reply and I'll pick it up from there.`;

/** One email of the conversation. `sentDaysAgo` set = it went out then; otherwise it waits in the open batch with `status`. */
async function email(b: B, oppId: string | null, o: { step?: number; status?: string; sentDaysAgo?: number; body?: string; issue?: string }) {
  const id = newId();
  const step = o.step ?? 0;
  const sent = o.sentDaysAgo != null;
  const status = sent ? (o.status ?? "sent") : (o.status ?? "ready");
  const messageId = sent ? `<${id}@samples.example>` : null;
  const first = step > 0 ? await db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, b.id)).orderBy(outreachDrafts.step).get() : null;
  const body = o.body ?? (step === 1 ? followBody(b) : step === 2 ? lastBody(b) : firstBody(b));
  const issues = o.issue ? [{ severity: "block" as const, code: "placeholder", message: o.issue }] : [];
  await db.insert(outreachDrafts).values({ id, businessId: b.id, opportunityId: oppId, campaignId: sent ? campaignSent : campaignOpen, step, style: "personal", channel: "email", toEmail: b.email, subject: SUBJECT, body, claims: step === 0 ? [{ text: "a quote with you starts with the customer sending sizes and artwork", factKeys: ["o1"] }] : [], warnings: issues.map((i) => i.message), validation: { passed: !issues.length, issues, statements: step === 0 ? [{ text: "a quote starts with sizes and artwork", verdict: "supported" as const, evidence: ["o1"] }] : [], checkedBy: "sample", checkedAt: ago(o.sentDaysAgo ?? 0) }, status, model: "sample (no model call)", costUsd: 0, promptVersion: "sample", messageId, inReplyTo: first?.messageId ?? null, sentAt: sent ? ago(o.sentDaysAgo!) : null, approvedBy: sent || status === "approved" ? "operator" : null, lastError: status === "bounced" ? "Bounced: the address does not exist." : null, createdAt: ago((o.sentDaysAgo ?? 0) + 0.2), updatedAt: ago(o.sentDaysAgo ?? 0) }).run();
  if (sent) {
    await db.insert(emailEvents).values({ id: newId(), draftId: id, businessId: b.id, type: status === "bounced" ? "bounced" : "sent", detail: { response: "250 OK (sample)" }, createdAt: ago(o.sentDaysAgo!) }).run();
    await db.insert(activities).values({ id: newId(), businessId: b.id, type: "email", content: `${step === 0 ? "Outreach email" : step === 1 ? "Follow-up" : "Last note"} sent: "${SUBJECT}" to ${b.email}`, metadata: { draftId: id }, createdAt: ago(o.sentDaysAgo!) }).run();
    if (step === 0 && status === "sent") await setStage(b, "contacted", ago(o.sentDaysAgo!));
  } else if (step === 0 && status !== "needs_review") await setStage(b, "ready_to_contact", ago(0.1));
  return { id, messageId };
}

/** They wrote back. The reply is read by the product's own code, so answers and next actions appear as they would for a real one. */
async function reply(b: B, draft: { id: string; messageId: string | null }, o: { text: string; from: string; daysAgo: number; category: Parameters<typeof applyReplyClassification>[1]; summary: string; suggested?: string; confidence?: number }) {
  const id = newId();
  await db.insert(inboundEmails).values({ id, businessId: b.id, draftId: draft.id, messageId: `<reply-${id}@${b.domain}>`, inReplyTo: draft.messageId, fromEmail: `${o.from.toLowerCase()}@${b.domain}`, fromName: o.from, subject: `Re: ${SUBJECT}`, bodyText: o.text, receivedAt: ago(o.daysAgo), kind: "reply", matchedBy: "thread" }).run();
  await db.insert(activities).values({ id: newId(), businessId: b.id, type: "email", content: `Reply received from ${o.from}: ${o.text.slice(0, 120)}`, metadata: { inboundId: id }, createdAt: ago(o.daysAgo) }).run();
  await setStage(b, "replied", ago(o.daysAgo));
  await applyReplyClassification(id, o.category, "sample-reader", { confidence: o.confidence ?? 0.94, summary: o.summary, suggestedReply: o.suggested ?? null });
  return id;
}

const IDEA = { title: "Quote requests that arrive ready to price", pitch: "You ask customers to send sizes and artwork for a quote: I wondered how often something is missing when they do." };
const qualified = async (s: Sample, daysAgo = 10) => {
  const b = await found(s);
  const opp = await researched(b, { verdict: "qualified", reason: `“${IDEA.title}” is backed by 2 verified observation(s).`, idea: IDEA, daysAgo });
  return { b, opp };
};

// ---- 1. Found, not researched yet
for (const name of ["Aire Valley Signs", "Kirkstall Sign Studio", "Roundhay Graphics"]) await found({ name, foundDaysAgo: 1 });
await found({ name: "Briggate Banners", website: false, foundDaysAgo: 1 });
await found({ name: "SignRight Leeds", chain: true, foundDaysAgo: 1 });

// ---- 2. Research that needs a person
{
  const b = await found({ name: "Calder Sign Works", foundDaysAgo: 3 });
  await db.insert(investigations).values({ id: newId(), businessId: b.id, status: "failed", startedAt: ago(2), finishedAt: ago(2), durationMs: 1300, error: `Website could not be fetched: DNS lookup failed for ${b.domain}` }).run();
  await db.update(businesses).set({ status: "failed", statusMessage: `Website could not be fetched: DNS lookup failed for ${b.domain}` }).where(eq(businesses.id, b.id)).run();
}
await researched(await found({ name: "Headingley Signs" }), { verdict: "no_contact", reason: "No public email address was found on the 4 pages read; research stopped there." });
await researched(await found({ name: "Otley Road Signs" }), { verdict: "needs_review", reason: "One idea, but it rests on a single observation: have a look before an email is written.", idea: IDEA });
await researched(await found({ name: "Pudsey Print and Sign" }), { verdict: "insufficient_evidence", reason: "Only 3 facts could be verified on a one-page site: too little to say anything specific." });
await researched(await found({ name: "Wharfedale Neon", kind: "Neon sign shop" }), { verdict: "not_a_fit", reason: "They already run an online configurator with instant prices; no convincing idea." });

// ---- 3. An email is waiting for you
{
  const { b, opp } = await qualified({ name: "Meanwood Signs" }, 1);
  await email(b, opp, { status: "ready" });
}
{
  const { b, opp } = await qualified({ name: "Horsforth Sign Co." }, 1);
  await email(b, opp, { status: "needs_review", body: `Hi Horsforth Sign Co. team,\n\nI saw that a quote with you starts with sizes and artwork. I'm Ivan, a software developer. I built the same form for [client name] last year.\n\nMay I send a short mock-up?`, issue: "The email contains a placeholder that was not filled in." });
}
{
  const { b, opp } = await qualified({ name: "Armley Signs and Wraps" }, 2);
  await email(b, opp, { status: "approved" });
}

// ---- 4. Emailed, at each point of the sequence
{
  const { b, opp } = await qualified({ name: "Morley Signs" }, 3);
  await email(b, opp, { sentDaysAgo: 1 }); // waiting: the follow-up is days away
}
{
  const { b, opp } = await qualified({ name: "Garforth Graphics" }, 12);
  await email(b, opp, { sentDaysAgo: 9 });
  await email(b, opp, { step: 1, status: "ready" }); // the follow-up is written and waits for review
}
{
  const { b, opp } = await qualified({ name: "Rothwell Sign Makers" }, 20);
  await email(b, opp, { sentDaysAgo: 16 });
  // Two days ago, on purpose: a follow-up that is past its waiting time would make the running app
  // write the last note with the real model (money). Nothing in this file may be "due" for paid work.
  await email(b, opp, { step: 1, sentDaysAgo: 2 }); // the last note comes next, in a few days
}
{
  const { b, opp } = await qualified({ name: "Wetherby Signs" }, 34);
  await email(b, opp, { sentDaysAgo: 30 });
  await email(b, opp, { step: 1, sentDaysAgo: 22 });
  await email(b, opp, { step: 2, sentDaysAgo: 14 }); // no answer to anything: call or close
}
{
  const { b, opp } = await qualified({ name: "Ilkley Sign Workshop" }, 6);
  await email(b, opp, { sentDaysAgo: 4, status: "bounced" });
  await addSuppression(b.email, "bounced", "The address rejected an outreach email");
  await db.update(businesses).set({ emailStatus: "invalid" }).where(eq(businesses.id, b.id)).run();
  await setStage(b, "qualified", ago(4));
}

// ---- 5. They answered, in every way people answer
{
  const { b, opp } = await qualified({ name: "Chapel Allerton Signs" }, 8);
  const d = await email(b, opp, { sentDaysAgo: 5 });
  await reply(b, d, { from: "Maria", daysAgo: 0, text: "Hi Ivan,\n\nYes please, send the mock-up over. We lose a lot of time chasing artwork.\n\nMaria", category: "interested", summary: "They would like to see the mock-up; chasing artwork costs them time.", suggested: "Hi Maria,\n\nGlad to. I'll put the mock-up together and send it over shortly." });
}
{
  const { b, opp } = await qualified({ name: "Seacroft Signs" }, 8);
  const d = await email(b, opp, { sentDaysAgo: 4 });
  await reply(b, d, { from: "Tom", daysAgo: 1, text: "Sounds interesting. Can we have a quick call this week?\n\nTom", category: "wants_meeting", summary: "They would like a short call this week.", suggested: "Hi Tom,\n\nGlad to. Would [time] suit you?" });
}
{
  const { b, opp } = await qualified({ name: "Beeston Sign Shop" }, 9);
  const d = await email(b, opp, { sentDaysAgo: 6 });
  await reply(b, d, { from: "Priya", daysAgo: 2, text: "Thanks, how much would something like this cost, and how long does it take?\n\nPriya", category: "wants_info", summary: "They ask about price and how long it takes.", suggested: "Hi Priya,\n\nThanks for asking. A first version usually takes two to three weeks; I can give you a price once I know which kinds of sign you quote most." });
}
{
  const { b, opp } = await qualified({ name: "Crossgates Signs" }, 9);
  const d = await email(b, opp, { sentDaysAgo: 6 });
  await reply(b, d, { from: "Alan", daysAgo: 3, text: "Not right now, we are flat out until spring. Try me again then.\n\nAlan", category: "not_now", summary: "Not now; busy until spring and open to hearing from you then.", suggested: "Hi Alan,\n\nUnderstood, thanks for letting me know. I'll check back in the spring." });
}
{
  const { b, opp } = await qualified({ name: "Yeadon Signs" }, 9);
  const d = await email(b, opp, { sentDaysAgo: 6 });
  await reply(b, d, { from: "Karen", daysAgo: 2, text: "I only do the accounts. You want Dave, he runs the workshop: dave@yeadon-signs.example\n\nKaren", category: "wrong_person", summary: "They point to Dave, who runs the workshop.", suggested: "Hi Karen,\n\nThank you, I'll write to Dave." });
}
{
  const { b, opp } = await qualified({ name: "Guiseley Sign Studio" }, 10);
  const d = await email(b, opp, { sentDaysAgo: 7 });
  await reply(b, d, { from: "Neil", daysAgo: 5, text: "Not relevant to us. Thank you for your time.\n\nNeil", category: "declined", summary: "They said the offer is not relevant to them." });
  await setStage(b, "lost", ago(5));
}
{
  const { b, opp } = await qualified({ name: "Bramley Signs" }, 10);
  const d = await email(b, opp, { sentDaysAgo: 7 });
  await reply(b, d, { from: "Office", daysAgo: 6, text: "Please remove us from your list.", category: "unsubscribe", summary: "Asked not to be contacted again." });
  await setStage(b, "lost", ago(6));
}

// ---- 6. Conversations you moved on yourself
{
  const { b, opp } = await qualified({ name: "Farsley Signs" }, 20);
  const d = await email(b, opp, { sentDaysAgo: 15 });
  const r = await reply(b, d, { from: "Helen", daysAgo: 10, text: "Yes, let's talk. Thursday at 10 works.\n\nHelen", category: "wants_meeting", summary: "They accepted a call on Thursday at 10." });
  await db.update(inboundEmails).set({ handledAt: ago(9) }).where(eq(inboundEmails.id, r)).run();
  await setStage(b, "meeting_scheduled", ago(9));
}
{
  const { b, opp } = await qualified({ name: "Kippax Sign Makers" }, 30);
  const d = await email(b, opp, { sentDaysAgo: 25 });
  const r = await reply(b, d, { from: "Owen", daysAgo: 20, text: "Send me a proposal with a price.\n\nOwen", category: "interested", summary: "They asked for a proposal with a price." });
  await db.update(inboundEmails).set({ handledAt: ago(19) }).where(eq(inboundEmails.id, r)).run();
  await db.update(outreachDrafts).set({ status: "archived" }).where(eq(outreachDrafts.inboundId, r)).run();
  await setStage(b, "proposal_sent", ago(12));
  // The operator's own plan, overdue: the app never replaces it.
  await db.update(prospects).set({ nextAction: "Call Owen about the proposal", nextActionAt: ago(2), nextActionKey: null, priority: "high" }).where(eq(prospects.businessId, b.id)).run();
}
{
  const { b, opp } = await qualified({ name: "Boston Spa Signs" }, 50);
  const d = await email(b, opp, { sentDaysAgo: 45 });
  const r = await reply(b, d, { from: "Grace", daysAgo: 40, text: "Looks great, let's go ahead.\n\nGrace", category: "interested", summary: "They want to go ahead." });
  await db.update(inboundEmails).set({ handledAt: ago(39) }).where(eq(inboundEmails.id, r)).run();
  await db.update(outreachDrafts).set({ status: "archived" }).where(eq(outreachDrafts.inboundId, r)).run();
  await setStage(b, "won", ago(30));
}

// ---- 7. Volume, on request: `SAMPLE_EXTRA=150` adds that many more, spread over every state, to see the lists full.
// Nothing here may be "due" for paid work in a running app: no email older than the follow-up wait without its
// next step already written, no qualified business left without an email, no reply left unread by the reader.
const EXTRA = Math.max(0, Math.min(200, Number(process.env.SAMPLE_EXTRA) || 0));
if (EXTRA > 0) {
  const FIRST = ["Abbey", "Bridge", "Castle", "Dale", "Elm", "Forge", "Grange", "Harbour", "Ivy", "Junction", "Kings", "Lark", "Mill", "North", "Oak", "Park", "Quay", "River", "Stone", "Tower", "Union", "Vale", "West", "Yew", "Acorn", "Beacon", "Crown", "Derwent", "Eagle", "Fountain", "Garden", "Holly", "Iron", "Jubilee", "Kestrel", "Linden", "Market", "Nelson", "Orchard", "Priory", "Queens", "Rose", "Swan", "Trinity", "Upper", "Victoria", "Willow", "Zenith", "Anchor", "Bell"];
  const SECOND: [string, string][] = [["Signs", "Sign shop"], ["Sign Co.", "Sign shop"], ["Graphics", "Graphic designer"], ["Print and Sign", "Print shop"], ["Sign Studio", "Sign shop"], ["Signworks", "Sign shop"], ["Neon", "Neon sign shop"], ["Vehicle Wraps", "Vehicle wrapping service"]];
  const REPLIES: { category: Parameters<typeof applyReplyClassification>[1]; text: string; summary: string; from: string }[] = [
    { category: "interested", text: "Yes, have a look and send something over.", summary: "They would like to see something.", from: "Sam" },
    { category: "wants_info", text: "What would this cost us roughly?", summary: "They ask about the price.", from: "Jo" },
    { category: "not_now", text: "Not at the moment, maybe later in the year.", summary: "Not now; perhaps later in the year.", from: "Pat" },
    { category: "declined", text: "No thank you.", summary: "They declined.", from: "Chris" },
  ];
  for (let i = 0; i < EXTRA; i++) {
    const [suffix, kind] = SECOND[i % SECOND.length];
    const name = `${FIRST[(i * 7) % FIRST.length]} ${FIRST[(i * 3 + 11) % FIRST.length]} ${suffix}`;
    const foundDaysAgo = 1 + (i % 40);
    const roll = i % 20; // twenty slots: the share of each state in a working pipeline
    if (roll < 8) {
      await found({ name, kind, foundDaysAgo, website: roll !== 7, reviews: 3 + ((i * 13) % 140), rating: 3.6 + ((i * 7) % 14) / 10 });
      continue;
    }
    const b = await found({ name, kind, foundDaysAgo: foundDaysAgo + 6, reviews: 8 + ((i * 11) % 160), rating: 3.9 + ((i * 5) % 11) / 10 });
    if (roll === 8) await researched(b, { verdict: "no_contact", reason: "No public email address was found on the 4 pages read; research stopped there." });
    else if (roll === 9) await researched(b, { verdict: "not_a_fit", reason: "They already use a quoting tool with online prices; no convincing idea." });
    else if (roll === 10) await researched(b, { verdict: i % 40 < 20 ? "needs_review" : "insufficient_evidence", reason: "Too little on the site to say something specific: have a look yourself.", idea: i % 40 < 20 ? IDEA : undefined });
    else {
      const opp = await researched(b, { verdict: "qualified", reason: `“${IDEA.title}” is backed by 2 verified observation(s).`, idea: IDEA, daysAgo: foundDaysAgo + 4 });
      if (roll === 11 || roll === 12) await email(b, opp, { status: "ready" });
      else if (roll === 13) await email(b, opp, { status: i % 40 < 20 ? "approved" : "needs_review", issue: i % 40 < 20 ? undefined : "The email states something the research does not show." });
      else if (roll === 14 || roll === 15) await email(b, opp, { sentDaysAgo: 1 + (i % 2) }); // sent a day or two ago: nothing is due
      else if (roll === 16) {
        // the whole sequence went out long ago without an answer
        await email(b, opp, { sentDaysAgo: 28 + (i % 9) });
        await email(b, opp, { step: 1, sentDaysAgo: 20 + (i % 5) });
        await email(b, opp, { step: 2, sentDaysAgo: 9 + (i % 6) });
      } else if (roll === 17) {
        const d = await email(b, opp, { sentDaysAgo: 6 + (i % 5) });
        const r = REPLIES[(i / 20) % REPLIES.length | 0];
        await reply(b, d, { from: r.from, daysAgo: i % 4, text: `${r.text}\n\n${r.from}`, category: r.category, summary: r.summary, suggested: r.category === "not_now" ? `Hi ${r.from},\n\nUnderstood, thanks for letting me know. I'll check back later.` : r.category === "declined" ? undefined : `Hi ${r.from},\n\nThanks for coming back to me. I'll send that over.` });
        if (r.category === "declined") await setStage(b, "lost", ago(i % 4));
      } else {
        // conversations the operator moved on: a meeting, a proposal, won or lost
        const d = await email(b, opp, { sentDaysAgo: 18 + (i % 20) });
        const rid = await reply(b, d, { from: "Alex", daysAgo: 12 + (i % 6), text: "Let's talk.\n\nAlex", category: "wants_meeting", summary: "They agreed to a call." });
        await db.update(inboundEmails).set({ handledAt: ago(11) }).where(eq(inboundEmails.id, rid)).run();
        await db.update(outreachDrafts).set({ status: "archived" }).where(eq(outreachDrafts.inboundId, rid)).run();
        const stage = (["meeting_scheduled", "proposal_sent", "won", "lost"] as const)[(i / 20 | 0) % 4];
        await setStage(b, stage, ago(3 + (i % 7)));
      }
    }
  }
}

// ---- finish: the search knows what it found; every business gets its planned next action
await db.update(searches).set({ stats: { providerResults: { csv: { found: rank } }, created: rank, merged: 0, skippedNoWebsite: 0, total: rank, attribution: ["Sample data"] } }).where(eq(searches.id, SEARCH_ID)).run();
const plan = await planFollowUps();
console.log(`Sample scenarios: ${rank} fictional businesses added (search "Sample scenarios"); ${plan.planned} next actions planned. No email was sent and nothing was spent.`);
closeDatabase();
