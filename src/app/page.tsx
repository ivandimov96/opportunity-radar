import Link from "next/link";
import { attentionItems, dashboardStats, funnelCounts } from "@/lib/queries";
import { getConfig, integrationStatus } from "@/lib/config";
import { Badge, Callout, Card, EmptyState, Icon, PageHeader, ScoreRing, fmtRelative } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { seedDemoAction } from "./actions";
import { OPPORTUNITY_CATEGORIES, type OpportunityCategory } from "@/lib/industries";
import { priorityScore } from "@/lib/scoring/score";

export default async function Overview() {
  const s = await dashboardStats();
  const funnel = await funnelCounts();
  const inbox = await attentionItems();
  const cfg = getConfig();
  const integ = integrationStatus();
  const active = s.queue.filter((q) => q.status === "queued" || q.status === "running").reduce((a, b) => a + b.n, 0);
  const max = Math.max(1, ...funnel.map((f) => f.n));

  if (s.total === 0) {
    return (
      <>
        <PageHeader eyebrow="Welcome" title="Find businesses that genuinely need software" subtitle="Opportunity Radar discovers local businesses, researches their public operations, and turns verified findings into opportunity hypotheses you can validate in a real conversation." />
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { n: 1, icon: "search" as const, title: "Discover businesses", text: "Pick an industry and city. OpenStreetMap works without any credentials; CSV import brings your own list.", cta: <Link href="/searches/new" className="btn btn-primary">Start a search</Link> },
            { n: 2, icon: "shield" as const, title: "Investigate with evidence", text: "One step per business: the website is fetched, a structured profile is built (every fact with its quote and source), and opportunity hypotheses are scored.", cta: <Link href="/import" className="btn">Import a CSV</Link> },
            { n: 3, icon: "sparkles" as const, title: "See it end to end", text: "Load clearly-labeled synthetic data to walk through findings, scored opportunities, drafts and the pipeline.", cta: <form action={seedDemoAction}><button className="btn">Load demo data</button></form> },
          ].map((c) => (
            <div key={c.n} className="surface p-5 flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-lg bg-accent-soft text-accent-text grid place-items-center"><Icon name={c.icon} /></span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Step {c.n}</span>
              </div>
              <h2 className="font-semibold">{c.title}</h2>
              <p className="text-sm text-ink-muted mt-1 flex-1">{c.text}</p>
              <div className="mt-4">{c.cta}</div>
            </div>
          ))}
        </div>
        {!cfg.ai.enabled && (
          <div className="mt-5">
            <Callout tone="warn" title="AI analysis and outreach drafting are off until an Anthropic API key is set." action={<Link href="/settings" className="btn btn-sm">Settings</Link>}>
              Discovery, website research and deterministic findings work without it.
            </Callout>
          </div>
        )}
      </>
    );
  }

  const kindMeta = {
    failed: { icon: "alert" as const, tone: "bad" as const, label: "Failed" },
    draft: { icon: "mail" as const, tone: "accent" as const, label: "Review draft" },
    due: { icon: "clock" as const, tone: "warn" as const, label: "Next action" },
    ready_draft: { icon: "note" as const, tone: "info" as const, label: "Ready to draft" },
    ready_investigate: { icon: "sparkles" as const, tone: "info" as const, label: "Investigate" },
  };

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Where every business sits in the funnel, and what needs your decision now."
        actions={
          <>
            <AutoRefresh active={active > 0} label={`${active} job${active === 1 ? "" : "s"} running`} />
            <Link href="/searches/new" className="btn btn-primary">
              <Icon name="plus" /> New search
            </Link>
          </>
        }
      />
      {!cfg.ai.enabled && (
        <div className="mb-5">
          <Callout tone="warn" title="AI stages are off: no Anthropic API key configured." action={<Link href="/settings" className="btn btn-sm">How to enable</Link>}>
            Discovery and website research run live. Analysis and outreach drafting need <code>ANTHROPIC_API_KEY</code>.
          </Callout>
        </div>
      )}

      <Card title="Funnel" description="Businesses progress left to right. Click a stage to filter." className="mb-5">
        <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {funnel.map((f, i) => (
            <li key={f.key}>
              <Link href={f.href} className="block hover:no-underline group">
                <div className="text-[11px] text-ink-muted flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-surface-3 text-[10px] grid place-items-center text-ink-faint">{i + 1}</span>
                  {f.label}
                </div>
                <div className="text-2xl font-semibold tabular-nums mt-1 group-hover:text-accent-text">{f.n}</div>
                <div className="h-1.5 rounded-full bg-surface-3 mt-2 overflow-hidden">
                  <div className="h-full bg-accent rounded-full" style={{ width: `${Math.max(3, (f.n / max) * 100)}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5 min-w-0">
          <Card title="Needs your attention" description="Failures, drafts to review, due actions, and businesses ready for the next step." padded={false}>
            {inbox.length === 0 ? (
              <EmptyState compact icon="check" title="Inbox zero" description="Nothing is waiting on you. Start a search or research more businesses." />
            ) : (
              <ul className="divide-y divide-line">
                {inbox.map((it, i) => {
                  const m = kindMeta[it.kind];
                  return (
                    <li key={i}>
                      <Link href={it.href} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2 hover:no-underline">
                        <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${{ bad: "bg-bad-soft text-bad", accent: "bg-accent-soft text-accent-text", warn: "bg-warn-soft text-warn", info: "bg-info-soft text-info" }[m.tone]}`}>
                          <Icon name={m.icon} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink truncate">{it.businessName}</span>
                          <span className="block text-xs text-ink-muted truncate">
                            <span className="sm:hidden">{m.label} · </span>
                            {it.detail}
                          </span>
                        </span>
                        <Badge tone={m.tone} className="hidden sm:inline-flex">{m.label}</Badge>
                        {it.when && <span className="hidden md:inline text-[11px] text-ink-faint w-14 text-right shrink-0">{fmtRelative(it.when)}</span>}
                        <Icon name="chevronRight" className="w-4 h-4 text-ink-faint" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Top opportunities" description="Ranked by priority (60% attractiveness, 40% confidence)." padded={false} actions={<Link href="/businesses?quick=has_opps" className="btn btn-sm btn-ghost">View all</Link>}>
            {s.top.length === 0 ? (
              <EmptyState compact icon="sparkles" title="No analyzed opportunities yet" description={cfg.ai.enabled ? "Investigate a business to get scored hypotheses." : "Opportunity analysis needs an Anthropic API key. Demo data shows what this looks like."} />
            ) : (
              <ul className="divide-y divide-line">
                {s.top.map(({ opp, business }) => (
                  <li key={opp.id}>
                    <Link href={`/businesses/${business.id}?tab=opportunities`} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-2 hover:no-underline">
                      <ScoreRing value={priorityScore(opp.attractivenessScore, opp.confidenceScore)} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink truncate">{business.name}</span>
                          {business.isDemo && <Badge tone="demo">demo</Badge>}
                        </span>
                        <span className="block text-xs text-ink-muted truncate">{opp.title}</span>
                        <span className="block text-[11px] text-ink-faint">{OPPORTUNITY_CATEGORIES[opp.category as OpportunityCategory] ?? opp.category}</span>
                      </span>
                      <span className="hidden sm:flex gap-4 text-[11px] text-ink-muted">
                        <span>
                          Attr. <strong className="text-ink">{opp.attractivenessScore}</strong>
                        </span>
                        <span>
                          Conf. <strong className={opp.confidenceScore < 40 ? "text-warn" : "text-ink"}>{opp.confidenceScore}</strong>
                        </span>
                      </span>
                      <Icon name="chevronRight" className="w-4 h-4 text-ink-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5 min-w-0">
          <Card title="Recent searches" padded={false} actions={<Link href="/searches" className="btn btn-sm btn-ghost">All</Link>}>
            {s.recentSearches.length === 0 ? (
              <EmptyState compact icon="search" title="No searches yet" />
            ) : (
              <ul className="divide-y divide-line">
                {s.recentSearches.map((r) => (
                  <li key={r.id}>
                    <Link href={`/searches/${r.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2 hover:no-underline">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink truncate">{r.name}</span>
                        <span className="block text-[11px] text-ink-faint">{fmtRelative(r.createdAt)}</span>
                      </span>
                      <span className="text-xs text-ink-muted tabular-nums">{r.stats?.total ?? 0}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="System">
            <ul className="space-y-2 text-xs">
              {Object.values(integ).map((i) => (
                <li key={i.label} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${i.status === "live" ? "bg-ok" : i.status === "demo" ? "bg-demo" : i.status === "missing_credentials" ? "bg-warn" : "bg-ink-faint"}`} />
                  <span className="flex-1 text-ink-muted truncate">{i.label.split(" (")[0]}</span>
                  <span className="text-ink-faint">{i.status.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
            <div className="text-xs text-ink-faint mt-3 pt-3 border-t border-line">
              AI spend to date <strong className="text-ink">${s.ai.total.toFixed(2)}</strong> of ${cfg.AI_SPEND_LIMIT_USD} guard
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
