import Link from "next/link";
import { patternSummary } from "@/lib/queries";
import { Badge, Callout, Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { OPPORTUNITY_CATEGORIES, getPlaybook, type OpportunityCategory } from "@/lib/industries";

export default function PatternsPage() {
  const groups = patternSummary();
  const max = Math.max(1, ...groups.map((g) => g.businesses));
  return (
    <>
      <PageHeader title="Recurring patterns" subtitle="Opportunity hypotheses grouped by category and industry. A pattern becomes a product candidate only when real conversations confirm it." />
      <div className="mb-5">
        <Callout tone="neutral" icon="info">
          <strong>Hypotheses are not demand.</strong> The left side of each card counts what the analysis proposed; the right side counts what businesses actually told you.
        </Callout>
      </div>
      {groups.length === 0 ? (
        <Card>
          <EmptyState icon="layers" title="No opportunities analyzed yet" description="Patterns appear once several businesses have been analyzed." action={<Link href="/businesses?quick=needs_analysis" className="btn">Businesses needing analysis</Link>} />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {groups.map((g) => {
            const confirmed = g.signals.filter((s) => s.type === "confirmed_problem" || s.type === "pilot" || s.type === "paying").reduce((a, s) => a + s.n, 0);
            const rejected = g.signals.filter((s) => s.type === "rejected").reduce((a, s) => a + s.n, 0);
            return (
              <Card
                key={`${g.category}-${g.industry}`}
                title={
                  <span className="flex items-center gap-2 flex-wrap">
                    {OPPORTUNITY_CATEGORIES[g.category as OpportunityCategory] ?? g.category}
                    <Badge>{getPlaybook(g.industry).label}</Badge>
                    {g.demoCount > 0 && <Badge tone="demo">{g.demoCount} demo</Badge>}
                  </span>
                }
                actions={
                  <Link href={`/businesses?quick=has_opps&industry=${g.industry}`} className="btn btn-sm btn-ghost">
                    Businesses
                  </Link>
                }
              >
                <div className="grid grid-cols-[1fr_auto] gap-4 items-center mb-4">
                  <div>
                    <div className="flex justify-between text-xs text-ink-muted mb-1">
                      <span>
                        <strong className="text-ink text-base">{g.businesses}</strong> business{g.businesses === 1 ? "" : "es"} with this hypothesis
                      </span>
                      <span>
                        avg attr. {g.avgAttr} · conf. {g.avgConf}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
                      <div className="h-full bg-accent rounded-full" style={{ width: `${Math.max(4, (g.businesses / max) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="text-center px-3 border-l border-line">
                    <div className={`text-xl font-semibold tabular-nums ${confirmed ? "text-ok" : "text-ink-faint"}`}>{confirmed}</div>
                    <div className="text-[10px] uppercase tracking-wide text-ink-faint">confirmed</div>
                    {rejected > 0 && <div className="text-[10px] text-bad">{rejected} rejected</div>}
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="label">Shared verified evidence</div>
                    {g.sharedEvidence.length ? (
                      <ul className="space-y-1 text-xs">
                        {g.sharedEvidence.map(([s, n]) => (
                          <li key={s} className="flex gap-1.5">
                            <Icon name="check" className="w-3.5 h-3.5 text-ok mt-0.5 shrink-0" />
                            <span>
                              {s} <span className="text-ink-faint">×{n}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-warn">No verified observations cited across this group.</p>
                    )}
                    <div className="label mt-3">Common assumptions</div>
                    <ul className="space-y-1 text-xs text-ink-muted">
                      {g.commonAssumptions.map(([s, n]) => (
                        <li key={s}>
                          {s} <span className="text-ink-faint">×{n}</span>
                        </li>
                      ))}
                      {!g.commonAssumptions.length && <li className="text-ink-faint">none</li>}
                    </ul>
                  </div>
                  <div>
                    <div className="label">Examples</div>
                    <ul className="space-y-1.5 text-xs">
                      {g.titles.map((t) => (
                        <li key={t.businessId}>
                          <Link href={`/businesses/${t.businessId}?tab=opportunities`} className="font-medium">
                            {t.businessName}
                          </Link>
                          <div className="text-ink-muted">
                            {t.title} · priority {t.priority}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="label mt-3">Effort mix</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {Object.entries(g.efforts).map(([k, v]) => (
                        <Badge key={k} tone="info">
                          {k} ×{v}
                        </Badge>
                      ))}
                    </div>
                    <div className="label mt-3">Validation signals</div>
                    {g.signals.length ? (
                      <div className="flex gap-1.5 flex-wrap">
                        {g.signals.map((s) => (
                          <Badge key={s.type} tone={s.type === "rejected" ? "bad" : s.type === "paying" || s.type === "pilot" || s.type === "confirmed_problem" ? "ok" : "accent"}>
                            {s.type.replace(/_/g, " ")} ×{s.n}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-faint">No conversations recorded yet.</p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
