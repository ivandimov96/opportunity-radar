/** Read-side queries for the Outreach screens and the dashboard. */
import { and, desc, eq, gte, inArray, isNull, ne, notInArray, sql, lte, type AnyColumn } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, campaigns, emailEvents, inboundEmails, observations, opportunities, facts, outreachDrafts, prospects } from "@/db/schema";
import { suppressionFor } from "@/lib/email/suppression";
import { getSettings } from "@/lib/settings";
import { openCampaign } from "./campaigns";
import { buildEvidencePack } from "./evidence";

export type OutreachTab = "ready" | "review" | "blocked" | "excluded" | "sent";
export const OUTREACH_TABS: { key: OutreachTab; label: string }[] = [
  { key: "ready", label: "Ready" },
  { key: "review", label: "Needs review" },
  { key: "blocked", label: "Can't contact" },
  { key: "excluded", label: "Excluded" },
  { key: "sent", label: "Sent" },
];

const hasRecipientIssue = (d: { validation: (typeof outreachDrafts.$inferSelect)["validation"] }) => Boolean(d.validation?.issues.some((i) => i.code === "recipient"));

/** Which tab an email belongs to. Emails that cannot reach anyone are kept apart from emails whose text needs work. */
export function tabOf(d: Pick<typeof outreachDrafts.$inferSelect, "status" | "validation">): OutreachTab | null {
  if (d.status === "ready" || d.status === "approved") return "ready";
  if (d.status === "needs_review") return hasRecipientIssue(d) ? "blocked" : "review";
  if (d.status === "excluded") return "excluded";
  if (["queued", "sending", "sent", "failed", "bounced"].includes(d.status)) return "sent";
  return null;
}

/** As `tabOf`, and an email with nobody to send it to is "can't contact" whatever its checks say. */
export function placeOf(d: Pick<typeof outreachDrafts.$inferSelect, "status" | "validation">, b: { email: string | null }): OutreachTab | null {
  const t = tabOf(d);
  return t === "review" && !b.email ? "blocked" : t;
}

export async function outreachOverview() {
  const db = await getDb();
  const campaign = await openCampaign();
  const rows = await db
    .select({ draft: outreachDrafts, business: businesses, stage: prospects.stage })
    .from(outreachDrafts)
    .innerJoin(businesses, eq(businesses.id, outreachDrafts.businessId))
    .leftJoin(prospects, eq(prospects.businessId, businesses.id))
    .where(ne(outreachDrafts.status, "archived"))
    .orderBy(desc(sql`coalesce(${businesses.priority}, 0)`), outreachDrafts.createdAt)
    .all();
  const byTab: Record<OutreachTab, typeof rows> = { ready: [], review: [], blocked: [], excluded: [], sent: [] };
  for (const r of rows) {
    const t = placeOf(r.draft, r.business);
    if (t) byTab[t].push(r);
  }
  byTab.sent.sort((a, b) => ((b.draft.sentAt ?? b.draft.scheduledAt ?? b.draft.updatedAt) > (a.draft.sentAt ?? a.draft.scheduledAt ?? a.draft.updatedAt) ? 1 : -1));
  // Qualified or paused businesses that have no email at all: nothing can be written to them yet.
  const withDraft = db.select({ id: outreachDrafts.businessId }).from(outreachDrafts).where(ne(outreachDrafts.status, "archived"));
  const unreachable = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.status, "profiled"), inArray(businesses.verdict, ["qualified", "no_contact"]), isNull(businesses.email), notInArray(businesses.id, withDraft)))
    .orderBy(desc(sql`coalesce(${businesses.priority}, ${businesses.leadScore}, 0)`))
    .limit(100)
    .all();
  // Qualified with an address, email not written yet (being written, or waiting for the AI budget or key).
  const pendingWrite = Number(
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(businesses)
        .where(and(eq(businesses.verdict, "qualified"), eq(businesses.status, "profiled"), sql`${businesses.email} is not null`, notInArray(businesses.id, withDraft)))
        .get()
    )?.n ?? 0,
  );
  const counts = {
    ready: byTab.ready.filter((r) => r.draft.status === "ready").length,
    approved: byTab.ready.filter((r) => r.draft.status === "approved").length,
    review: byTab.review.length,
    blocked: byTab.blocked.length + unreachable.length,
    excluded: byTab.excluded.length,
    inFlight: byTab.sent.filter((r) => r.draft.status === "queued" || r.draft.status === "sending").length,
    failed: byTab.sent.filter((r) => r.draft.status === "failed").length,
    sent: byTab.sent.filter((r) => r.draft.status === "sent").length,
    bounced: byTab.sent.filter((r) => r.draft.status === "bounced").length,
    pendingWrite,
  };
  return { campaign, byTab, unreachable, counts };
}

/** One email with everything needed to judge it: the business, the idea behind it, the evidence, and its neighbours in the queue. */
export async function draftDetail(id: string) {
  const db = await getDb();
  const draft = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, id)).get();
  if (!draft) return null;
  const business = (await db.select().from(businesses).where(eq(businesses.id, draft.businessId)).get())!;
  const prospect = (await db.select().from(prospects).where(eq(prospects.businessId, business.id)).get()) ?? null;
  const [factRows, obsRows, opps, events, inbound] = await Promise.all([
    db.select().from(facts).where(eq(facts.businessId, business.id)).all(),
    db.select().from(observations).where(eq(observations.businessId, business.id)).all(),
    db.select().from(opportunities).where(eq(opportunities.businessId, business.id)).orderBy(opportunities.rank).all(),
    db.select().from(emailEvents).where(eq(emailEvents.draftId, id)).orderBy(emailEvents.createdAt).all(),
    db.select().from(inboundEmails).where(eq(inboundEmails.draftId, id)).orderBy(inboundEmails.receivedAt).all(),
  ]);
  const opportunity = opps.find((o) => o.role === "primary") ?? opps[0] ?? null;
  const pack = buildEvidencePack(factRows, obsRows, opportunity);
  const settings = await getSettings();
  const suppression = await suppressionFor(business.email);
  // Neighbours: the other emails of the same tab, in the order the list shows them.
  const tab = placeOf(draft, business);
  const overview = tab ? (await outreachOverview()).byTab[tab] : [];
  const index = overview.findIndex((r) => r.draft.id === id);
  const prev = index > 0 ? overview[index - 1].draft.id : null;
  const next = index >= 0 && index < overview.length - 1 ? overview[index + 1].draft.id : null;
  return { draft, business, prospect, opportunity, pack, settings, suppression, events, inbound, tab, position: index >= 0 ? { index: index + 1, total: overview.length } : null, prev, next };
}

/** Sent batches, newest first, with what happened to their emails. */
export async function campaignHistory(limit = 12) {
  const db = await getDb();
  const rows = await db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, sentAt: campaigns.sentAt, draftStatus: outreachDrafts.status, n: sql<number>`count(${outreachDrafts.id})` })
    .from(campaigns)
    .leftJoin(outreachDrafts, eq(outreachDrafts.campaignId, campaigns.id))
    .where(ne(campaigns.status, "open"))
    .groupBy(campaigns.id, outreachDrafts.status)
    .orderBy(desc(campaigns.sentAt))
    .all();
  const map = new Map<string, { id: string; name: string; status: string; sentAt: string | null; counts: Record<string, number> }>();
  for (const r of rows) {
    const c = map.get(r.id) ?? { id: r.id, name: r.name, status: r.status, sentAt: r.sentAt, counts: {} };
    if (r.draftStatus) c.counts[r.draftStatus] = Number(r.n);
    map.set(r.id, c);
  }
  return [...map.values()].slice(0, limit);
}

/** Numbers for the dashboard: the funnel, what is waiting for the operator, and this month's sending. */
/**
 * The funnel for a period: what was found, researched, qualified, contacted and
 * answered between two moments (either may be open). Each step is counted by
 * the date that step happened; meetings and wins by when the business last
 * moved on the board.
 */
export async function funnelForPeriod(range: { fromIso: string | null; toIso: string | null }) {
  const db = await getDb();
  const within = (col: AnyColumn) => and(range.fromIso ? gte(col, range.fromIso) : undefined, range.toIso ? lte(col, range.toIso) : undefined);
  const count = async (q: Promise<{ n: number } | undefined>) => Number((await q)?.n ?? 0);
  const [found, researched, qualified, contacted, replied, meetings, won] = await Promise.all([
    count(db.select({ n: sql<number>`count(*)` }).from(businesses).where(within(businesses.createdAt)).get()),
    count(db.select({ n: sql<number>`count(*)` }).from(businesses).where(and(eq(businesses.status, "profiled"), within(businesses.investigatedAt))).get()),
    count(db.select({ n: sql<number>`count(*)` }).from(businesses).where(and(eq(businesses.verdict, "qualified"), within(businesses.investigatedAt))).get()),
    count(db.select({ n: sql<number>`count(distinct ${outreachDrafts.businessId})` }).from(outreachDrafts).where(and(eq(outreachDrafts.step, 0), inArray(outreachDrafts.status, ["sent", "bounced"]), within(outreachDrafts.sentAt))).get()),
    count(db.select({ n: sql<number>`count(distinct ${inboundEmails.businessId})` }).from(inboundEmails).where(and(eq(inboundEmails.kind, "reply"), within(inboundEmails.receivedAt))).get()),
    count(db.select({ n: sql<number>`count(*)` }).from(prospects).where(and(inArray(prospects.stage, ["meeting_scheduled", "proposal_sent", "won"]), within(prospects.updatedAt))).get()),
    count(db.select({ n: sql<number>`count(*)` }).from(prospects).where(and(eq(prospects.stage, "won"), within(prospects.updatedAt))).get()),
  ]);
  return { found, researched, qualified, contacted, replied, meetings, won };
}

export async function dashboardData() {
  const db = await getDb();
  const n = async (table: "businesses" | "drafts" | "inbound", where: ReturnType<typeof sql>) => {
    const from = table === "businesses" ? db.select({ n: sql<number>`count(*)` }).from(businesses).leftJoin(prospects, eq(prospects.businessId, businesses.id)) : table === "drafts" ? db.select({ n: sql<number>`count(*)` }).from(outreachDrafts) : db.select({ n: sql<number>`count(*)` }).from(inboundEmails);
    return Number((await from.where(where).get())?.n ?? 0);
  };
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const stageRows = await db.select({ stage: prospects.stage, n: sql<number>`count(*)` }).from(prospects).groupBy(prospects.stage).all();
  const stage = Object.fromEntries(stageRows.map((r) => [r.stage, Number(r.n)])) as Record<string, number>;
  const total = stageRows.reduce((s, r) => s + Number(r.n), 0);
  const contactedEver = await n("drafts", sql`${outreachDrafts.step} = 0 and ${outreachDrafts.status} in ('sent', 'bounced')`);
  const repliedBusinesses = Number((await db.select({ n: sql<number>`count(distinct ${inboundEmails.businessId})` }).from(inboundEmails).where(eq(inboundEmails.kind, "reply")).get())?.n ?? 0);
  const overview = await outreachOverview();
  const openReplies = await db
    .select({ inbound: inboundEmails, business: { id: businesses.id, name: businesses.name } })
    .from(inboundEmails)
    .innerJoin(businesses, eq(businesses.id, inboundEmails.businessId))
    .where(and(eq(inboundEmails.kind, "reply"), isNull(inboundEmails.handledAt)))
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(8)
    .all();
  const dueActions = await db
    .select({ business: { id: businesses.id, name: businesses.name }, nextAction: prospects.nextAction, nextActionAt: prospects.nextActionAt, stage: prospects.stage })
    .from(prospects)
    .innerJoin(businesses, eq(businesses.id, prospects.businessId))
    .where(and(sql`${prospects.nextAction} is not null`, notInArray(prospects.stage, ["won", "lost"])))
    .orderBy(prospects.nextActionAt)
    .limit(8)
    .all();
  return {
    total,
    researched: await n("businesses", sql`${businesses.status} = 'profiled'`),
    notResearched: await n("businesses", sql`${businesses.status} in ('new', 'failed') and ${businesses.kind} != 'chain'`),
    researching: await n("businesses", sql`${businesses.status} in ('queued', 'investigating')`),
    qualified: await n("businesses", sql`${businesses.verdict} = 'qualified'`),
    needsReview: await n("businesses", sql`${businesses.verdict} in ('needs_review', 'insufficient_evidence') and coalesce(${prospects.stage}, 'discovered') in ('discovered', 'researching')`),
    stage,
    outreach: overview.counts,
    sentThisMonth: await n("drafts", sql`${outreachDrafts.status} in ('sent', 'bounced') and ${outreachDrafts.sentAt} >= ${monthStart}`),
    sentEver: await n("drafts", sql`${outreachDrafts.status} in ('sent', 'bounced')`),
    contactedEver,
    repliedBusinesses,
    replyRate: contactedEver ? repliedBusinesses / contactedEver : null,
    meetings: (stage.meeting_scheduled ?? 0) + (stage.proposal_sent ?? 0) + (stage.won ?? 0),
    won: stage.won ?? 0,
    openReplies,
    dueActions,
    repliesThisMonth: Number((await db.select({ n: sql<number>`count(*)` }).from(inboundEmails).where(and(eq(inboundEmails.kind, "reply"), gte(inboundEmails.receivedAt, monthStart))).get())?.n ?? 0),
  };
}
