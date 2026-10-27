import Link from "next/link";
import { dashboardStats } from "@/lib/queries";
import { getConfig, integrationStatus } from "@/lib/config";
import { Badge, Card, Empty, PageHeader, ScoreBar, Stat, fmtDate } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { seedDemoAction } from "./actions";
import { stageLabel } from "@/lib/pipeline/stages";
import { OPPORTUNITY_CATEGORIES, type OpportunityCategory } from "@/lib/industries";

export default function Overview() {
  const s = dashboardStats();
  const cfg = getConfig();
  const integ = integrationStatus();
  const queued = s.queue.filter((q) => q.status === "queued" || q.status === "running").reduce((a, b) => a + b.n, 0);
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Find businesses → understand their operations → identify credible software opportunities → prioritize → start conversations."
        actions={
          <>
            <AutoRefresh active={queued > 0} />
            <Link href="/searches/new" className="btn btn-primary">
              New search
            </Link>
          </>
        }
      />
      {!cfg.ai.enabled && (
        <div className="rounded-md border border-warn/30 bg-warn-soft text-warn text-sm px-3 py-2 mb-4">
          AI stages (extraction, analysis, outreach) are unavailable: <code>ANTHROPIC_API_KEY</code> is not set. Discovery and website research still run live. Use the demo data to explore the full workflow.{" "}
          <Link href="/settings">Integration status</Link>
        </div>
      )}
      {s.total === 0 && (
        <Card title="Get started" className="mb-5">
          <p className="text-sm text-ink-muted mb-3">No businesses yet. Start a live search (OpenStreetMap needs no credentials), import a CSV, or load clearly-labeled synthetic demo data to see the full workflow.</p>
          <div className="flex gap-2">
            <Link href="/searches/new" className="btn btn-primary">
              Start a search
            </Link>
            <Link href="/import" className="btn">
              Import CSV
            </Link>
            <form action={seedDemoAction}>
              <button className="btn">Load demo data (synthetic)</button>
            </form>
          </div>
        </Card>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Businesses" value={s.total} hint={s.demo ? `${s.demo} synthetic demo` : undefined} href="/businesses" />
        <Stat label="Researched" value={s.researched} hint="websites fetched and findings stored" href="/businesses?research=done" />
        <Stat label="With opportunity hypotheses" value={s.withOpps} hint={`${s.insufficient} concluded insufficient evidence`} href="/businesses?minAttr=1" />
        <Stat label="Jobs in progress" value={queued} hint={`AI spend to date $${s.ai.total.toFixed(2)} (estimated)`} href="/settings" />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Top-ranked opportunities" className="lg:col-span-2">
          {s.top.length === 0 ? (
            <Empty>No analyzed opportunities yet.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Opportunity</th>
                  <th>Attractiveness</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {s.top.map(({ opp, business }) => (
                  <tr key={opp.id}>
                    <td>
                      <Link href={`/businesses/${business.id}?tab=opportunities`}>{business.name}</Link>
                      {business.isDemo && (
                        <>
                          {" "}
                          <Badge tone="demo">demo</Badge>
                        </>
                      )}
                      <div className="text-xs text-ink-faint">{[business.city, business.region].filter(Boolean).join(", ")}</div>
                    </td>
                    <td>
                      <div>{opp.title}</div>
                      <div className="text-xs text-ink-faint">{OPPORTUNITY_CATEGORIES[opp.category as OpportunityCategory] ?? opp.category}</div>
                    </td>
                    <td>
                      <ScoreBar value={opp.attractivenessScore} label="" />
                    </td>
                    <td>
                      <ScoreBar value={opp.confidenceScore} label="" tone={opp.confidenceScore < 40 ? "warn" : "ok"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Pipeline">
            {s.stages.length === 0 ? (
              <Empty>No prospects.</Empty>
            ) : (
              <ul className="text-sm space-y-1">
                {s.stages.map((st) => (
                  <li key={st.stage} className="flex justify-between">
                    <Link href={`/businesses?stage=${st.stage}`}>{stageLabel(st.stage)}</Link>
                    <span className="font-medium">{st.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Next actions">
            {s.nextActions.length === 0 ? (
              <Empty>Nothing scheduled.</Empty>
            ) : (
              <ul className="text-sm space-y-2">
                {s.nextActions.map(({ prospect, business }) => (
                  <li key={business.id}>
                    <Link href={`/businesses/${business.id}?tab=pipeline`}>{business.name}</Link>
                    <div className="text-xs text-ink-muted">
                      {prospect.nextAction} · {fmtDate(prospect.nextActionAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent searches">
            {s.recentSearches.length === 0 ? (
              <Empty>None yet.</Empty>
            ) : (
              <ul className="text-sm space-y-1">
                {s.recentSearches.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <Link href={`/searches/${r.id}`} className="truncate">
                      {r.name}
                    </Link>
                    <span className="text-xs text-ink-faint">{r.stats?.total ?? 0}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <div className="mt-5 text-xs text-ink-faint flex flex-wrap gap-x-4 gap-y-1">
        {Object.values(integ).map((i) => (
          <span key={i.label}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${i.status === "live" ? "bg-ok" : i.status === "demo" ? "bg-demo" : i.status === "missing_credentials" ? "bg-warn" : "bg-ink-faint"}`} />
            {i.label.split(" (")[0]}: {i.status.replace("_", " ")}
          </span>
        ))}
      </div>
    </>
  );
}
