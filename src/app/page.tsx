/**
 * Dashboard: the one screen that answers "what should I do now?" and "where
 * does everything stand?". Top to bottom: what is waiting for the operator,
 * the funnel in one strip, replies and planned actions, and this month's use.
 */
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, EmptyState, Icon, Meter, PageHeader, fmtRelative, type Tone } from "@/components/ui";
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
import { navStatus } from "@/lib/queries";
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
  const [d, period, nav, settings, aiSpent, aiBudget, crawl, searchCredits, sentNow] = await Promise.all([dashboardData(), funnelForPeriod(rangeBounds(range)), navStatus(), getSettings(), monthSpendUsd(), monthlyAiBudgetUsd(), creditsUsedThisMonth(), usageTotal("serper"), sentToday()]);
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
    { n: d.needsReview, title: `${plural(d.needsReview, "business", "businesses")} to judge yourself`, body: "Research found something, but not enough to write automatically.", href: "/businesses?quick=needs_review&range=all", cta: "Look", icon: "building", tone: "warn" },
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

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="What is waiting for you, and where everything stands."
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

      <section className="surface mb-5" aria-label="Waiting for you">
        <div className="px-5 py-3.5 border-b border-line flex items-center justify-between gap-3">
          <h2 className="text-[0.9rem] font-semibold leading-5">Waiting for you</h2>
          {working.length > 0 && <span className="text-xs text-ink-muted pulse">In the background: {working.join(", ")}</span>}
        </div>
        {waiting.length === 0 ? (
          firstRun ? (
            <EmptyState
              icon="search"
              title="Start by finding businesses"
              description="Pick a type of business and a city. Research, qualification and email writing then run on their own; you review and send."
              action={
                <Link href="/searches/new" className="btn btn-primary btn-sm">
                  Find businesses
                </Link>
              }
            />
          ) : (
            <div className="flex items-center gap-3 px-5 py-4">
              <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-ok-soft text-ok">
                <Icon name="check" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Nothing is waiting for you</div>
                <div className="text-xs text-ink-muted">
                  {busy
                    ? "The system is working in the background. New emails appear here when they are ready."
                    : d.notResearched > 0
                      ? `${plural(d.notResearched, "saved business", "saved businesses")} ${d.notResearched === 1 ? "is" : "are"} not researched yet${cfg.firecrawl.enabled && settings.autoResearch ? "; they are picked up automatically, best leads first." : "."}`
                      : "Find more businesses to keep the pipeline moving."}
                </div>
              </div>
            </div>
          )
        ) : (
          <ul className="divide-y divide-line">
            {waiting.map((t) => (
              <li key={t.title}>
                <Link href={t.href} className="flex items-center gap-3 px-5 py-3 hover:no-underline hover:bg-surface-2">
                  <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${TONE_BG[t.tone]}`}>
                    <Icon name={t.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{t.title}</span>
                    <span className="block text-xs text-ink-muted">{t.body}</span>
                  </span>
                  <span className="btn btn-sm shrink-0">{t.cta}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface mb-5 overflow-hidden" aria-label="From found to won">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-line bg-surface-2">
          <span className="text-xs font-semibold text-ink">Progress, {describeRange(range)}</span>
          <span className="ml-auto">
            <DateRangePicker basePath="/" value={range.key} from={range.from} to={range.to} />
          </span>
        </div>
        <ol className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
          {funnel.map((f) => (
            <li key={f.label} className="relative border-line border-b lg:border-b-0 [&:not(:last-child)]:lg:border-r">
              <Link href={f.href} className="block px-4 py-3.5 h-full hover:no-underline hover:bg-surface-2">
                <span className="block text-xs text-ink-muted">{f.label}</span>
                <span className={`block text-2xl font-semibold leading-tight mt-1 tabular-nums ${f.value ? "text-ink" : "text-ink-faint"}`}>{f.value}</span>
                <span className="block text-[11px] text-ink-faint mt-0.5 truncate min-h-4">{f.hint}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
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

          {d.dueActions.length > 0 && (
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
          )}
        </div>

        <Card
          title="This month"
          description="What has been used against your limits."
          actions={
            <Link href={settingsHref("automation")} className="text-xs">
              Change limits
            </Link>
          }
        >
          <div className="space-y-4">
            <Meter label="Emails sent today" used={sentNow} limit={settings.dailySendCap} unit="a day" />
            <Meter label="AI (research and writing)" used={aiSpent} limit={aiBudget} unit="$" />
            <Meter label="Website research" used={crawl.credits} limit={cfg.FIRECRAWL_MONTHLY_CREDIT_BUDGET} unit="credits" />
            <Meter label="Business search" used={searchCredits} limit={cfg.SERPER_CREDIT_BUDGET} unit="credits" hint="These credits do not renew." />
          </div>
        </Card>
      </div>
    </>
  );
}
