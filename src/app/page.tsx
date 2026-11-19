/**
 * Dashboard: one screen, every row the full width, nothing left empty.
 *  1. The next step: one sentence and one button; other things waiting as a
 *     row of links under it.
 *  2. Four figures: emails sent today, replies, money spent, research used.
 *  3. The path from found to won as one line of connected steps, for a period.
 *  4. Replies to answer and planned actions, only when there are any.
 *  5. The latest events.
 */
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, Icon, PageHeader, fmtRelative, type Tone } from "@/components/ui";
import type { IconName } from "@/components/icons";
import { monthSpendUsd } from "@/lib/ai/usage";
import { getConfig } from "@/lib/config";
import { usageTotal } from "@/lib/discovery/usage";
import { stripQuoted } from "@/lib/mail/parse";
import { dashboardData, funnelForPeriod } from "@/lib/outreach/queries";
import { describeRange, rangeBounds, rangeParams, resolveRange } from "@/lib/date-range";
import { DateRangePicker } from "@/components/date-range";
import { sentToday } from "@/lib/outreach/send";
import { stageLabel } from "@/lib/pipeline/stages";
import { navStatus, pipelineHistory } from "@/lib/queries";
import { ActivityTimeline } from "@/components/activity-timeline";
import { creditsUsedThisMonth } from "@/lib/research/stored";
import { getSettings, monthlyAiBudgetUsd } from "@/lib/settings";
import { settingsHref } from "@/lib/settings-nav";

const REPLY_LABEL: Record<string, { label: string; tone: Tone }> = {
  wants_meeting: { label: "Wants a meeting", tone: "ok" },
  interested: { label: "Interested", tone: "ok" },
  wants_info: { label: "Asks for more", tone: "info" },
  not_now: { label: "Not now", tone: "neutral" },
  declined: { label: "Declined", tone: "bad" },
  unsubscribe: { label: "Asked not to be contacted", tone: "bad" },
  wrong_person: { label: "Points to someone else", tone: "info" },
  other: { label: "Other", tone: "neutral" },
};
const TONE_BG: Record<Tone, string> = { accent: "bg-accent-soft text-accent-text", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", neutral: "bg-surface-3 text-ink-muted", info: "bg-info-soft text-info", bad: "bg-bad-soft text-bad" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : null);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const cfg = getConfig();
  // The period: the last 7 days unless the URL says otherwise (see src/lib/date-range.ts).
  const range = resolveRange(await searchParams);
  const ranged = range.key !== "all";
  const [d, period, nav, settings, aiSpent, aiBudget, crawl, searchCredits, sentNow, recent, allTime] = await Promise.all([dashboardData(), funnelForPeriod(rangeBounds(range)), navStatus(), getSettings(), monthSpendUsd(), monthlyAiBudgetUsd(), creditsUsedThisMonth(), usageTotal("serper"), sentToday(), pipelineHistory({ kind: "all", page: 1, pageSize: 6 }), funnelForPeriod({ fromIso: null, toIso: null })]);
  const hour = new Date().getHours();
  const firstName = settings.senderName.trim().split(/\s+/)[0] || "";
  const greeting = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}${firstName ? `, ${firstName}` : ""}`;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const replyRate = allTime.contacted > 0 ? Math.round((allTime.replied / allTime.contacted) * 100) : null;
  /** The same period on the Businesses list, by the date that fits the step. */
  const listHref = (extra: Record<string, string>, dateField?: string) => {
    // "All time" is said explicitly: the list's own default is the last 7 days.
    const p = new URLSearchParams({ ...extra, ...(range.key === "all" ? { range: "all" } : rangeParams(range)) });
    if (ranged && dateField && dateField !== "createdAt") p.set("dateField", dateField);
    const q = p.toString();
    return `/businesses${q ? `?${q}` : ""}`;
  };
  const o = d.outreach;
  const attention = o.review + o.failed;

  const all: { n: number; title: string; body: string; href: string; cta: string; icon: IconName; tone: Tone }[] = [
    { n: d.openReplies.length, title: `${plural(d.openReplies.length, "reply", "replies")} to answer`, body: "Someone wrote back. Read it and answer from your mailbox.", href: "#replies", cta: "Read", icon: "mail", tone: "ok" },
    { n: o.approved, title: `${plural(o.approved, "approved email")} ready to send`, body: "Reviewed and approved. One button sends the batch.", href: "/outreach/send", cta: "Send", icon: "play", tone: "accent" },
    { n: o.ready, title: `${plural(o.ready, "email")} to review`, body: "Written from verified research and checked. Read, edit, approve.", href: "/outreach?tab=ready", cta: "Review", icon: "eye", tone: "accent" },
    { n: attention, title: `${plural(attention, "email")} ${attention === 1 ? "needs" : "need"} a closer look`, body: "A check failed or sending did not work.", href: o.failed ? "/outreach?tab=sent" : "/outreach?tab=review", cta: "Open", icon: "alert", tone: "warn" },
    { n: d.needsReview, title: `${plural(d.needsReview, "business", "businesses")} to judge yourself`, body: "Research found something, but not enough to write automatically.", href: "/businesses?quick=needs_review&range=all", cta: "Look", icon: "building", tone: "warn" },    // Found but not researched: waiting for the operator unless background research will pick them up.
    { n: cfg.firecrawl.enabled && settings.autoResearch ? 0 : d.notResearched, title: `${plural(d.notResearched, "business", "businesses")} to research`, body: "Found and saved, but not researched yet. Research reads each website and writes an email for the ones that qualify.", href: "/businesses?quick=needs_investigation&range=all", cta: "Research them", icon: "search", tone: "accent" },
  ];
  const waiting = all.filter((t) => t.n > 0);

  const busy = d.researching > 0 || o.inFlight > 0 || o.pendingWrite > 0;
  const working = [d.researching ? `researching ${plural(d.researching, "business", "businesses")}` : null, o.pendingWrite ? `writing ${plural(o.pendingWrite, "email")}` : null, o.inFlight ? `sending ${plural(o.inFlight, "email")}` : null].filter(Boolean) as string[];
  const firstRun = d.total === 0;

  // Hints describe the present, so they are shown only when no period is chosen.
  const hint = (text: string | null) => (ranged ? null : text);
  const funnel: { label: string; value: number; href: string; hint: string | null }[] = [
    { label: "Found", value: period.found, href: listHref({}, "createdAt"), hint: hint(d.notResearched ? `${d.notResearched} not researched yet` : null) },
    { label: "Researched", value: period.researched, href: listHref({ status: "profiled" }, "investigatedAt"), hint: hint(d.researching ? `${d.researching} in progress` : null) },
    { label: "Qualified", value: period.qualified, href: listHref({ quick: "qualified" }, "investigatedAt"), hint: share(period.qualified, period.researched) ? `${share(period.qualified, period.researched)} of researched` : null },
    { label: "Contacted", value: period.contacted, href: "/outreach?tab=sent", hint: hint(d.sentThisMonth ? `${plural(d.sentThisMonth, "email")} this month` : null) },
    { label: "Replied", value: period.replied, href: "/pipeline", hint: share(period.replied, period.contacted) ? `${share(period.replied, period.contacted)} of contacted` : null },
    { label: "Meetings", value: period.meetings, href: "/pipeline", hint: null },
    { label: "Won", value: period.won, href: "/pipeline", hint: null },
  ];

  const top = waiting[0] ?? null;
  return (
    <>
      <PageHeader
        title={greeting}
        subtitle={today}
        actions={
          <>
            <AutoRefresh active={busy} intervalMs={5000} label={d.researching ? `Researching ${d.researching}` : o.inFlight ? `Sending ${o.inFlight}` : "Writing emails"} />
            <Link href="/searches/new" className="btn btn-primary">
              <Icon name="search" /> Find businesses
            </Link>
          </>
        }
      />

      {nav.setup.length > 0 && (
        <section className="surface mb-5 border-warn/40" aria-label="Finish setting up">
          <div className="px-5 py-3.5 border-b border-line">
            <h2 className="text-[0.9rem] font-semibold leading-5">Finish setting up</h2>
            <p className="text-xs text-ink-muted mt-0.5">{plural(nav.setup.length, "thing")} left before the whole flow can run on its own.</p>
          </div>
          <ul className="divide-y divide-line">
            {nav.setup.map((g) => (
              <li key={g.label}>
                <Link href={g.href} className="flex items-center gap-3 px-5 py-2.5 hover:no-underline hover:bg-surface-2">
                  <span className="w-5 h-5 rounded-full border-2 border-warn/60 shrink-0" aria-hidden />
                  <span className="text-sm text-ink flex-1 min-w-0">{g.label}</span>
                  <span className="text-xs text-accent-text shrink-0 inline-flex items-center gap-1">
                    Set up <Icon name="arrowRight" className="w-3 h-3" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 1. The next step: one line of text and one button, the full width. */}
      <section className="surface overflow-hidden mb-5" aria-label="Waiting for you">
        <div className="airmail" aria-hidden />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5">
          <div className="min-w-0 flex-1 basis-80">
            <div className={`text-sm font-semibold ${top ? "text-accent-text" : "text-ok"}`}>{top ? "Your next step" : firstRun ? "Welcome" : "All caught up"}</div>
            <h2 className="font-serif text-[1.5rem] leading-snug font-semibold mt-0.5">{top ? top.title : firstRun ? "Start by finding businesses" : "Nothing is waiting for you"}</h2>
            <p className="text-[0.95rem] text-ink-muted mt-1">
              {top
                ? top.body
                : firstRun
                  ? "Pick a type of business and a city. Research and email writing then run on their own; you review and send."
                  : busy
                    ? `In the background: ${working.join(", ")}. New emails appear here when they are ready.`
                    : d.notResearched > 0
                      ? `${plural(d.notResearched, "saved business", "saved businesses")} ${d.notResearched === 1 ? "is" : "are"} not researched yet${cfg.firecrawl.enabled && settings.autoResearch ? "; they are picked up automatically, best leads first." : "."}`
                      : "Find more businesses to keep the pipeline moving."}
            </p>
          </div>
          {top ? (
            <Link href={top.href} className="btn btn-primary btn-lg shrink-0">
              {top.cta} <Icon name="arrowRight" />
            </Link>
          ) : (
            <Link href={!firstRun && d.notResearched > 0 ? "/businesses?quick=needs_investigation&range=all" : "/searches/new"} className="btn btn-lg shrink-0">
              {!firstRun && d.notResearched > 0 ? "See them" : "Find businesses"} <Icon name="arrowRight" />
            </Link>
          )}
        </div>
        {waiting.length > 1 && (
          <ul className="border-t border-line grid sm:grid-cols-2 lg:grid-cols-4">
            {waiting.slice(1).map((t) => (
              <li key={t.title} className="border-line border-b sm:border-b-0 sm:border-r last:border-0">
                <Link href={t.href} className="flex items-center gap-3 px-6 py-3 h-full hover:no-underline hover:bg-surface-2">
                  <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${TONE_BG[t.tone]}`}>
                    <Icon name={t.icon} className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{t.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. Four figures in one row: today, replies, money, research. */}
      <div className="grid gap-5 mb-5 grid-cols-2 lg:grid-cols-4" aria-label="Today and this month">
        {[
          { label: "Emails sent today", value: String(sentNow), of: `of ${settings.dailySendCap}`, pct: (sentNow / Math.max(1, settings.dailySendCap)) * 100, href: "/outreach?tab=sent", note: "" },
          { label: "Replies so far", value: String(allTime.replied), of: `of ${allTime.contacted} contacted${replyRate != null ? ` (${replyRate}%)` : ""}`, pct: replyRate ?? 0, href: "/pipeline", note: "" },
          { label: "Spent on AI this month", value: `$${aiSpent.toFixed(2)}`, of: `of $${aiBudget}`, pct: (aiSpent / Math.max(0.01, aiBudget)) * 100, href: settingsHref("automation"), note: "" },
          { label: "Website research this month", value: String(crawl.credits), of: `of ${cfg.FIRECRAWL_MONTHLY_CREDIT_BUDGET.toLocaleString()} credits`, pct: (crawl.credits / Math.max(1, cfg.FIRECRAWL_MONTHLY_CREDIT_BUDGET)) * 100, href: settingsHref("automation"), note: `Business search: ${searchCredits} of ${cfg.SERPER_CREDIT_BUDGET.toLocaleString()} credits` },
        ].map((t) => (
          <Link key={t.label} href={t.href} className="surface px-5 py-4 min-w-0 hover:no-underline hover:bg-surface-2">
            <span className="block text-sm text-ink-muted">{t.label}</span>
            <span className="block mt-1">
              <span className="text-3xl font-semibold tabular-nums text-ink">{t.value}</span> <span className="text-sm text-ink-faint">{t.of}</span>
            </span>
            <span className="block h-1.5 rounded-full bg-surface-3 mt-3 overflow-hidden" aria-hidden>
              <span className={`block h-full rounded-full ${t.pct >= 90 ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.min(100, Math.max(0, t.pct))}%` }} />
            </span>
            {t.note && <span className="block text-xs text-ink-faint mt-1.5 truncate">{t.note}</span>}
          </Link>
        ))}
      </div>

      {/* 3. From found to won, as one line of connected steps. */}
      <section className="surface mb-5 overflow-hidden" aria-label="From found to won">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 border-b border-line">
          <h2 className="text-base font-semibold leading-6">Progress, {describeRange(range)}</h2>
          <span className="ml-auto">
            <DateRangePicker basePath="/" value={range.key} from={range.from} to={range.to} />
          </span>
        </div>
        {/* One step per cell: its name, how many reached it, and how many of the step before that is. The short bar in a cell is its share of everything found; each bar ends inside its own cell. */}
        <ol className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
          {funnel.map((f, i) => {
            const prev = i > 0 ? funnel[i - 1] : null;
            const kept = prev ? share(f.value, prev.value) : null;
            const ofFound = period.found > 0 ? Math.min(100, Math.round((f.value / period.found) * 100)) : 0;
            return (
              <li key={f.label} className="relative min-w-0 border-line border-b lg:border-b-0 lg:[&:not(:first-child)]:border-l">
                {i > 0 && (
                  <span className="hidden lg:grid absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full place-items-center bg-surface border border-line text-ink-faint" aria-hidden>
                    <Icon name="chevronRight" className="w-3.5 h-3.5" />
                  </span>
                )}
                <Link href={f.href} className="block h-full px-5 pt-4 pb-5 hover:no-underline hover:bg-surface-2">
                  <span className="block text-sm font-semibold text-ink-muted">{f.label}</span>
                  <span className={`block text-4xl font-semibold leading-none mt-2 tabular-nums ${f.value ? "text-ink" : "text-ink-faint"}`}>{f.value}</span>
                  <span className="block h-1.5 rounded-full bg-surface-3 mt-3 overflow-hidden" aria-hidden>
                    <span className={`block h-full rounded-full ${i >= 4 ? "bg-ok" : "bg-accent"}`} style={{ width: `${ofFound}%` }} />
                  </span>
                  <span className="block text-[0.8rem] leading-snug mt-2 min-h-9">
                    {prev ? (
                      kept ? (
                        <>
                          <span className={`font-semibold ${f.value ? "text-ok" : "text-ink-faint"}`}>{kept}</span> <span className="text-ink-faint">of {prev.label.toLowerCase()}</span>
                        </>
                      ) : (
                        <span className="text-ink-faint">none yet</span>
                      )
                    ) : (
                      <span className="text-ink-faint">{f.hint ?? "where it starts"}</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      {/* 4. Replies and planned actions appear only when there are any. */}
      {d.openReplies.length > 0 && (
        <div className="mb-5">
          <Card id="replies" className="scroll-mt-4" title="Replies to answer" description="Picked up from your inbox. Answer from your own mailbox, then tick them off on the business page." padded={false}>
            {d.openReplies.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-faint">{d.sentEver ? "No open replies. New ones show up here." : "Replies appear here once emails are out."}</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.openReplies.map(({ inbound: m, business: b }) => (
                  <li key={m.id}>
                    <Link href={`/businesses/${b.id}?tab=outreach`} className="block px-5 py-3 hover:no-underline hover:bg-surface-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-ink">{b.name}</span>
                        {m.classification && <Badge tone={REPLY_LABEL[m.classification]?.tone ?? "neutral"}>{REPLY_LABEL[m.classification]?.label ?? m.classification}</Badge>}
                        <span className="text-xs text-ink-faint ml-auto">{fmtRelative(m.receivedAt)}</span>
                      </div>
                      <p className="text-xs text-ink-muted mt-1 line-clamp-2">{m.classificationSummary ?? stripQuoted(m.bodyText).slice(0, 220)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <div className={d.dueActions.length > 0 ? "mb-5" : ""}>{d.dueActions.length > 0 && (
            <Card title="Planned next actions" description="What you planned, or what a reply calls for." padded={false}>
              <ul className="divide-y divide-line">
                {d.dueActions.map((a) => (
                  <li key={a.business.id}>
                    <Link href={`/businesses/${a.business.id}`} className="flex items-center gap-3 px-5 py-3 hover:no-underline hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink truncate">{a.nextAction}</span>
                        <span className="block text-xs text-ink-faint">
                          {a.business.name} · {stageLabel(a.stage)}
                        </span>
                      </span>
                      {a.nextActionAt && <span className={`text-xs shrink-0 ${new Date(a.nextActionAt).getTime() < Date.now() ? "text-warn" : "text-ink-faint"}`}>{fmtRelative(a.nextActionAt)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}</div>

      {/* 5. What just happened, the full width. */}
      <Card
        title="Latest activity"
        padded={false}
        actions={
          <Link href="/pipeline?view=history" className="text-sm">
            Full history
          </Link>
        }
      >
        {recent.items.length === 0 ? <p className="px-5 py-4 text-sm text-ink-faint">Nothing has happened yet. Events appear here as businesses are found, researched and emailed.</p> : <ActivityTimeline activities={recent.items} />}
      </Card>
    </>
  );
}
