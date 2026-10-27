import { getConfig, integrationStatus } from "@/lib/config";
import { usageSummary } from "@/lib/ai/usage";
import { jobCounts } from "@/lib/jobs/queue";
import { workerStatus } from "@/lib/jobs/worker";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ATTRACTIVENESS_WEIGHTS, CONFIDENCE_WEIGHTS } from "@/lib/scoring/score";

export default function SettingsPage() {
  const cfg = getConfig();
  const integ = integrationStatus();
  const usage = usageSummary();
  const jobs = jobCounts();
  const worker = workerStatus();
  const tone = (s: string) => (s === "live" ? "ok" : s === "demo" ? "demo" : s === "missing_credentials" ? "warn" : "neutral");
  return (
    <>
      <PageHeader title="Settings & integration status" subtitle="Configuration is read from environment variables (.env). This page shows what is live, what is demo, and what needs credentials." />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Integrations">
          <ul className="space-y-3 text-sm">
            {Object.values(integ).map((i) => (
              <li key={i.label}>
                <div className="flex items-center gap-2">
                  <Badge tone={tone(i.status)}>{i.status.replace("_", " ")}</Badge> <span className="font-medium">{i.label}</span>
                </div>
                <div className="text-xs text-ink-muted mt-0.5">{i.detail}</div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          <Card title="AI usage & spend guard">
            <div className="text-sm">
              Estimated spend to date: <strong>${usage.total.toFixed(4)}</strong> of ${cfg.AI_SPEND_LIMIT_USD} limit (AI_SPEND_LIMIT_USD).
            </div>
            <table className="table text-xs mt-2">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Calls</th>
                  <th>Input tok.</th>
                  <th>Output tok.</th>
                  <th>Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.byStage.map((s) => (
                  <tr key={s.stage}>
                    <td>{s.stage}</td>
                    <td>{s.calls}</td>
                    <td>{s.input?.toLocaleString()}</td>
                    <td>{s.output?.toLocaleString()}</td>
                    <td>${(s.cost ?? 0).toFixed(4)}</td>
                  </tr>
                ))}
                {!usage.byStage.length && (
                  <tr>
                    <td colSpan={5} className="text-ink-faint">
                      No model calls recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
          <Card title="Background worker">
            <div className="text-sm">
              Embedded worker: {worker.running ? <Badge tone="ok">running ({worker.active} active)</Badge> : <Badge tone="warn">not running in this process</Badge>}{" "}
              <span className="text-xs text-ink-muted">EMBEDDED_WORKER={String(cfg.EMBEDDED_WORKER)}; alternatively run <code>pnpm worker</code>.</span>
            </div>
            <ul className="text-xs mt-2 text-ink-muted">
              {jobs.map((j) => (
                <li key={`${j.type}-${j.status}`}>
                  {j.type}: {j.status} ×{j.n}
                </li>
              ))}
              {!jobs.length && <li>No jobs yet.</li>}
            </ul>
          </Card>
          <Card title="Limits">
            <ul className="text-xs text-ink-muted space-y-1">
              <li>Research: max {cfg.RESEARCH_MAX_PAGES} pages/business, {cfg.RESEARCH_FETCH_TIMEOUT_MS} ms timeout, {Math.round(cfg.RESEARCH_PAGE_BYTES_LIMIT / 1000)} KB/page, concurrency {cfg.RESEARCH_CONCURRENCY}, robots.txt respected, private networks blocked.</li>
              <li>Scoring weights — attractiveness: {Object.entries(ATTRACTIVENESS_WEIGHTS).map(([k, v]) => `${k} ${v}`).join(", ")}; confidence: {Object.entries(CONFIDENCE_WEIGHTS).map(([k, v]) => `${k} ${v}`).join(", ")}.</li>
              <li>Database: {cfg.DATABASE_PATH}</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
