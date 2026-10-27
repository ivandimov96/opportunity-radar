import { getConfig, integrationStatus } from "@/lib/config";
import { usageSummary } from "@/lib/ai/usage";
import { jobCounts } from "@/lib/jobs/queue";
import { workerStatus } from "@/lib/jobs/worker";
import { Badge, Callout, Card, KeyValue, PageHeader, type Tone } from "@/components/ui";
import { ATTRACTIVENESS_WEIGHTS, CONFIDENCE_WEIGHTS } from "@/lib/scoring/score";

export default function SettingsPage() {
  const cfg = getConfig();
  const integ = integrationStatus();
  const usage = usageSummary();
  const jobs = jobCounts();
  const worker = workerStatus();
  const tone = (s: string): Tone => (s === "live" ? "ok" : s === "demo" ? "demo" : s === "missing_credentials" ? "warn" : "neutral");
  const label = (s: string) => ({ live: "Live", demo: "Demo", missing_credentials: "Needs credentials", not_implemented: "Not implemented" })[s] ?? s;
  const pct = Math.min(100, (usage.total / cfg.AI_SPEND_LIMIT_USD) * 100);
  return (
    <>
      <PageHeader title="Settings" subtitle="Configuration comes from environment variables in .env. This page shows what is live, what is demo, and what needs credentials." />
      {!cfg.ai.enabled && (
        <div className="mb-5">
          <Callout tone="warn" title="Enable AI analysis and outreach drafting">
            Add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to <code>.env</code> and restart. Spending is capped by <code>AI_SPEND_LIMIT_USD</code> (currently ${cfg.AI_SPEND_LIMIT_USD}).
          </Callout>
        </div>
      )}
      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        <Card title="Integrations" padded={false}>
          <ul className="divide-y divide-line">
            {Object.values(integ).map((i) => (
              <li key={i.label} className="px-5 py-3.5 flex gap-3">
                <Badge tone={tone(i.status)} dot className="h-5 mt-0.5 shrink-0">
                  {label(i.status)}
                </Badge>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{i.label}</div>
                  <div className="text-xs text-ink-muted mt-0.5">{i.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          <Card title="AI spend guard">
            <div className="flex justify-between text-sm">
              <span>
                <strong className="tabular-nums">${usage.total.toFixed(2)}</strong> <span className="text-ink-muted">estimated</span>
              </span>
              <span className="text-ink-muted">limit ${cfg.AI_SPEND_LIMIT_USD}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-3 mt-2 overflow-hidden">
              <div className={`h-full rounded-full ${pct > 85 ? "bg-bad" : pct > 60 ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            {usage.byStage.length > 0 ? (
              <table className="table text-xs mt-3">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th className="text-right">Calls</th>
                    <th className="text-right">Tokens</th>
                    <th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byStage.map((s) => (
                    <tr key={s.stage}>
                      <td>{s.stage}</td>
                      <td className="text-right tabular-nums">{s.calls}</td>
                      <td className="text-right tabular-nums">{((s.input ?? 0) + (s.output ?? 0)).toLocaleString()}</td>
                      <td className="text-right tabular-nums">${(s.cost ?? 0).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-ink-faint mt-3">No model calls recorded yet.</p>
            )}
          </Card>
          <Card title="Background worker">
            <KeyValue
              rows={[
                { k: "Embedded worker", v: worker.running ? <Badge tone="ok" dot>running · {worker.active} active</Badge> : <Badge tone="warn" dot>not in this process</Badge> },
                { k: "Concurrency", v: cfg.RESEARCH_CONCURRENCY },
                ...jobs.map((j) => ({ k: `${j.type.replace(/_/g, " ")} · ${j.status}`, v: j.n })),
              ]}
            />
            <p className="hint">Set EMBEDDED_WORKER=false and run <code>pnpm worker</code> for a separate process.</p>
          </Card>
          <Card title="Limits & weights">
            <KeyValue
              rows={[
                { k: "Pages per business", v: cfg.RESEARCH_MAX_PAGES },
                { k: "Fetch timeout", v: `${cfg.RESEARCH_FETCH_TIMEOUT_MS} ms` },
                { k: "Page size cap", v: `${Math.round(cfg.RESEARCH_PAGE_BYTES_LIMIT / 1000)} KB` },
                { k: "Database", v: <code>{cfg.DATABASE_PATH}</code> },
              ]}
            />
            <p className="hint">
              Attractiveness weights: {Object.entries(ATTRACTIVENESS_WEIGHTS).map(([k, v]) => `${k} ${v}`).join(", ")}. Confidence weights: {Object.entries(CONFIDENCE_WEIGHTS).map(([k, v]) => `${k} ${v}`).join(", ")}.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
