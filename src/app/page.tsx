import Link from "next/link";
import { overviewSnapshot } from "@/lib/queries";
import { getConfig } from "@/lib/config";
import { Badge, Card, EmptyState, Icon, PageHeader, ScoreRing, fmtRelative } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { investigateAction, investigateManyAction, seedDemoAction } from "./actions";
import { OPPORTUNITY_CATEGORIES, type OpportunityCategory } from "@/lib/industries";

export default async function Overview() {
  const s = await overviewSnapshot();
  const cfg = getConfig();
  const c = s.counts;
  const running = s.queue.filter((q) => q.status === "queued" || q.status === "running").reduce((a, b) => a + b.n, 0);

  if (c.found === 0) {
    return (
      <>
        <PageHeader eyebrow="Welcome" title="Find businesses that genuinely need software" subtitle="Discover local businesses, investigate each one in a single step, and act on the ones with a real opportunity." />
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { n: 1, icon: "search" as const, title: "Discover businesses", text: "Pick an industry, a state and a city. Overture Maps and OpenStreetMap need no credentials; CSV import brings your own list.", cta: <Link href="/searches/new" className="btn btn-primary">Start a search</Link> },
            { n: 2, icon: "shield" as const, title: "Investigate with evidence", text: "One step per business: the website is fetched, a structured profile is built (every fact with its quote and source), and opportunity hypotheses are scored.", cta: <Link href="/import" className="btn">Import a CSV</Link> },
            { n: 3, icon: "sparkles" as const, title: "See it end to end", text: "Load clearly-labeled synthetic data to walk through a profile, scored opportunities, a draft and the pipeline.", cta: <form action={seedDemoAction}><button className="btn">Load demo data</button></form> },
          ].map((x) => (
            <div key={x.n} className="surface p-5 flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-lg bg-accent-soft text-accent-text grid place-items-center"><Icon name={x.icon} /></span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Step {x.n}</span>
              </div>
              <h2 className="font-semibold">{x.title}</h2>
              <p className="text-sm text-ink-muted mt-1 flex-1">{x.text}</p>
              <div className="mt-4">{x.cta}</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  const investigateIds = s.toInvestigate.map((b) => b.id);
  const todo = s.drafts.length + s.due.length + s.readyToDraft.length;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <strong className="text-ink">{c.found}</strong> found
            </span>
            <Icon name="chevronRight" className="w-3 h-3 text-ink-faint" />
            <span>
              <strong className="text-ink">{c.investigated}</strong> investigated
            </span>
            <Icon name="chevronRight" className="w-3 h-3 text-ink-faint" />
            <span>
              <strong className="text-ink">{c.opportunities}</strong> with opportunity
            </span>
            <Icon name="chevronRight" className="w-3 h-3 text-ink-faint" />
            <span>
              <strong className="text-ink">{c.contacted}</strong> contacted
            </span>
            {!cfg.ai.enabled && (
              <Link href="/settings" className="ml-2 inline-flex items-center gap-1 text-warn text-xs">
                <Icon name="alert" className="w-3.5 h-3.5" /> AI off: {c.aiPending} profile{c.aiPending === 1 ? "" : "s"} waiting for an API key
              </Link>
            )}
          </span>
        }
        actions={
          <>
            <AutoRefresh active={running > 0} label={`${c.investigating} investigating`} />
            <Link href="/searches/new" className="btn btn-primary">
              <Icon name="plus" /> New search
            </Link>
          </>
        }
      />

      {/* ------------------------------------------------ four clear numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile label="To investigate" value={c.toInvestigate} tone="accent" icon="sparkles" href="/businesses?quick=needs_investigation" hint={c.investigating ? `${c.investigating} running now` : c.chains ? `best leads first · ${c.chains} chains set aside` : "best leads first"} />
        <Tile label="Opportunities found" value={c.opportunities} tone="ok" icon="target" href="/businesses?quick=has_opps" hint={`${c.noOpportunity} ruled out`} />
        <Tile label="To review" value={todo} tone="warn" icon="eye" href="#todo" hint={`${s.drafts.length} drafts · ${s.due.length} actions due`} />
        <Tile label="Needs a fix" value={c.failed + c.noWebsite} tone={c.failed + c.noWebsite ? "bad" : "neutral"} icon="alert" href="/businesses?quick=failed" hint={`${c.failed} failed · ${c.noWebsite} no website`} />
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5 min-w-0" id="todo">
          {/* ------------------------------------------------ 1. review */}
          <Card title="Review" description="Drafts waiting for your approval and follow-ups you scheduled." padded={false}>
            {todo === 0 ? (
              <EmptyState compact icon="check" title="Nothing to review" description={c.opportunities ? "Every opportunity has a draft, and no follow-ups are due." : "Reviews appear once investigations find opportunities."} />
            ) : (
              <ul className="divide-y divide-line">
                {s.drafts.map(({ d, b }) => (
                  <Row key={d.id} href={`/businesses/${b.id}?tab=outreach`} icon="mail" tone="accent" title={b.name} demo={b.isDemo} detail={`Draft ready to review${d.warnings.length ? ` · ${d.warnings.length} thing${d.warnings.length === 1 ? "" : "s"} to check` : ""}`} when={d.createdAt} cta="Review draft" />
                ))}
                {s.due.map(({ p, b }) => (
                  <Row key={b.id} href={`/businesses/${b.id}?tab=activity`} icon="clock" tone="warn" title={b.name} demo={b.isDemo} detail={p.nextAction!} when={p.nextActionAt} cta="Open" />
                ))}
                {s.readyToDraft.map(({ b }) => (
                  <Row key={b.id} href={`/businesses/${b.id}?tab=opportunities`} icon="target" tone="ok" title={b.name} demo={b.isDemo} detail={`Opportunity found · priority ${b.priority ?? "—"} · no draft yet`} cta={cfg.ai.enabled ? "Draft outreach" : "See opportunity"} />
                ))}
              </ul>
            )}
          </Card>

          {/* ------------------------------------------------ 2. investigate */}
          <Card
            title="Investigate"
            description="Found businesses that have a website but no profile yet."
            padded={false}
            actions={
              investigateIds.length > 0 && (
                <form action={investigateManyAction}>
                  {s.toInvestigate.map((b) => (
                    <input key={b.id} type="hidden" name="businessId" value={b.id} />
                  ))}
                  <button className="btn btn-primary btn-sm">
                    <Icon name="sparkles" /> Investigate {c.toInvestigate > investigateIds.length ? `${investigateIds.length} of ${c.toInvestigate}` : `all ${investigateIds.length}`}
                  </button>
                </form>
              )
            }
          >
            {s.toInvestigate.length === 0 ? (
              <EmptyState compact icon="check" title={c.investigating ? `${c.investigating} investigating right now` : "Everything is investigated"} description={c.investigating ? "Results appear as each one finishes." : "Run a new search or import a CSV to find more."} />
            ) : (
              <ul className="divide-y divide-line">
                {s.toInvestigate.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-accent-soft text-accent-text">
                      <Icon name="building" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link href={`/businesses/${b.id}`} className="block text-sm font-medium text-ink truncate">
                        {b.name}
                      </Link>
                      <span className="block text-xs text-ink-muted truncate">{[b.city, b.websiteDomain].filter(Boolean).join(" · ")}</span>
                    </span>
                    <form action={investigateAction}>
                      <input type="hidden" name="businessId" value={b.id} />
                      <button className="btn btn-sm">Investigate</button>
                    </form>
                  </li>
                ))}
                {c.toInvestigate > s.toInvestigate.length && (
                  <li className="px-5 py-2 text-xs text-ink-faint">
                    <Link href="/businesses?quick=needs_investigation">+{c.toInvestigate - s.toInvestigate.length} more</Link>
                  </li>
                )}
              </ul>
            )}
          </Card>

          {/* ------------------------------------------------ 3. fix */}
          {s.failed.length > 0 && (
            <Card title="Fix" description="Investigations that could not fetch the website. Retry or correct the URL." padded={false}>
              <ul className="divide-y divide-line">
                {s.failed.map((b) => (
                  <Row key={b.id} href={`/businesses/${b.id}`} icon="alert" tone="bad" title={b.name} demo={b.isDemo} detail={b.statusMessage ?? "Failed"} when={b.updatedAt} cta="Fix" />
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-5 min-w-0">
          <Card title="Best opportunities" padded={false} actions={<Link href="/businesses?quick=has_opps" className="btn btn-sm btn-ghost">All {c.opportunities}</Link>}>
            {s.best.length === 0 ? (
              <EmptyState compact icon="target" title="None yet" description={cfg.ai.enabled ? "Investigate businesses to find opportunities." : "Opportunity analysis needs an Anthropic API key."} />
            ) : (
              <ul className="divide-y divide-line">
                {s.best.map(({ opp, b, drafts }) => (
                  <li key={opp.id}>
                    <Link href={`/businesses/${b.id}?tab=opportunities`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 hover:no-underline">
                      <ScoreRing value={b.priority ?? 0} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-ink truncate">{b.name}</span>
                          {b.isDemo && <Badge tone="demo">demo</Badge>}
                        </span>
                        <span className="block text-xs text-ink-muted truncate">{opp.title}</span>
                        <span className="block text-[11px] text-ink-faint truncate">
                          {OPPORTUNITY_CATEGORIES[opp.category as OpportunityCategory] ?? opp.category}
                          {drafts ? " · draft ready" : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent searches" padded={false} actions={<Link href="/searches" className="btn btn-sm btn-ghost">All</Link>}>
            <ul className="divide-y divide-line">
              {s.recentSearches.map((r) => (
                <li key={r.id}>
                  <Link href={`/searches/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 hover:no-underline">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink truncate">{r.name}</span>
                      <span className="block text-[11px] text-ink-faint">{fmtRelative(r.createdAt)}</span>
                    </span>
                    <span className="text-xs text-ink-muted tabular-nums">{r.stats?.total ?? 0}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-[11px] text-ink-faint px-1">
            AI spend ${s.ai.total.toFixed(2)} of ${cfg.AI_SPEND_LIMIT_USD} · <Link href="/settings">integration status</Link>
          </p>
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, hint, href, icon, tone }: { label: string; value: number; hint?: string; href: string; icon: "sparkles" | "target" | "eye" | "alert"; tone: "accent" | "ok" | "warn" | "bad" | "neutral" }) {
  const cls = { accent: "bg-accent-soft text-accent-text", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", neutral: "bg-surface-3 text-ink-muted" }[tone];
  return (
    <Link href={href} className="surface p-4 flex items-center gap-3 hover:no-underline hover:shadow-md transition-shadow">
      <span className={`w-10 h-10 rounded-lg grid place-items-center shrink-0 ${cls}`}>
        <Icon name={icon} className="w-5 h-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold leading-none tabular-nums text-ink">{value}</span>
        <span className="block text-xs font-medium text-ink mt-1">{label}</span>
        {hint && <span className="block text-[11px] text-ink-faint truncate">{hint}</span>}
      </span>
    </Link>
  );
}

function Row({ href, icon, tone, title, demo, detail, when, cta }: { href: string; icon: "mail" | "clock" | "target" | "alert"; tone: "accent" | "warn" | "ok" | "bad"; title: string; demo?: boolean; detail: string; when?: string | null; cta: string }) {
  const cls = { accent: "bg-accent-soft text-accent-text", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad" }[tone];
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2 hover:no-underline">
        <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${cls}`}>
          <Icon name={icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-ink truncate">{title}</span>
            {demo && <Badge tone="demo">demo</Badge>}
          </span>
          <span className="block text-xs text-ink-muted truncate">{detail}</span>
        </span>
        {when && <span className="hidden md:inline text-[11px] text-ink-faint shrink-0">{fmtRelative(when)}</span>}
        <span className="btn btn-sm shrink-0">{cta}</span>
      </Link>
    </li>
  );
}
