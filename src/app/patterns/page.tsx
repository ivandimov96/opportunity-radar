import Link from "next/link";
import { patternSummary } from "@/lib/queries";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { OPPORTUNITY_CATEGORIES, getPlaybook, type OpportunityCategory } from "@/lib/industries";

export default function PatternsPage() {
  const groups = patternSummary();
  return (
    <>
      <PageHeader title="Recurring opportunity patterns" subtitle="Opportunity hypotheses grouped by category and industry across all analyzed businesses. Repeated hypotheses are not demand; validation signals from real conversations are tracked separately." />
      {groups.length === 0 ? (
        <Card>
          <Empty>No opportunities analyzed yet.</Empty>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card
              key={`${g.category}-${g.industry}`}
              title={
                <>
                  {OPPORTUNITY_CATEGORIES[g.category as OpportunityCategory] ?? g.category} <Badge>{getPlaybook(g.industry).label}</Badge> {g.demoCount > 0 && <Badge tone="demo">{g.demoCount} demo</Badge>}
                </>
              }
              actions={
                <span className="text-xs text-ink-muted">
                  {g.businesses} business{g.businesses === 1 ? "" : "es"} · avg attractiveness {g.avgAttr} · avg confidence {g.avgConf}
                </span>
              }
            >
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="label">Shared verified evidence</div>
                  {g.sharedEvidence.length ? (
                    <ul className="list-disc pl-4">
                      {g.sharedEvidence.map(([s, n]) => (
                        <li key={s}>
                          {s} <span className="text-ink-faint text-xs">×{n}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-warn text-xs">No verified observations cited across this group.</p>
                  )}
                  <div className="label mt-3">Common assumptions</div>
                  <ul className="list-disc pl-4 text-ink-muted">
                    {g.commonAssumptions.map(([s, n]) => (
                      <li key={s}>
                        {s} <span className="text-ink-faint text-xs">×{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="label">Example hypotheses</div>
                  <ul className="space-y-1">
                    {g.titles.map((t) => (
                      <li key={t.businessId}>
                        <Link href={`/businesses/${t.businessId}?tab=opportunities`}>{t.businessName}</Link>
                        <div className="text-xs text-ink-muted">
                          {t.title} · priority {t.priority}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="label mt-3">Estimated effort mix</div>
                  <div className="text-xs text-ink-muted">
                    {Object.entries(g.efforts)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                  </div>
                </div>
                <div>
                  <div className="label">Commercial validation (real signals)</div>
                  {g.signals.length ? (
                    <ul className="space-y-1">
                      {g.signals.map((s) => (
                        <li key={s.type}>
                          <Badge tone={s.type === "rejected" ? "bad" : s.type === "paying" || s.type === "pilot" ? "ok" : "accent"}>{s.type.replace("_", " ")}</Badge> ×{s.n}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-muted">No conversations recorded yet. Hypotheses only.</p>
                  )}
                  <p className="text-xs text-ink-faint mt-3">A reusable product is worth considering only once several businesses confirm the problem.</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
