import Link from "next/link";
import { recentJobs, sourceHealth } from "@/lib/queries";
import { jobCounts } from "@/lib/jobs/queue";
import { workerStatus } from "@/lib/jobs/worker";
import { getConfig, integrationStatus } from "@/lib/config";
import { Badge, Card, PageHeader, StatusPill, fmtRelative } from "@/components/ui";
import { TableEmpty } from "@/components/table";
import { AutoRefresh } from "@/components/auto-refresh";
import { cancelJobAction, retryJobAction } from "@/app/actions";

const PROVIDER_LABEL: Record<string, string> = { overture: "Overture Maps", osm: "OpenStreetMap", google_places: "Google Places", tx_permits: "Texas permits", demo: "Demo" };
const fmtSec = (ms?: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);

export default async function SystemPage() {
  const cfg = getConfig();
  const [jobsRows, counts, health] = await Promise.all([recentJobs(60), jobCounts(), sourceHealth()]);
  const worker = workerStatus();
  const integ = integrationStatus();
  const active = jobsRows.some((j) => j.status === "running" || j.status === "queued");
  const byStatus = (st: string) => counts.filter((c) => c.status === st).reduce((a, c) => a + c.n, 0);
  return (
    <>
      <PageHeader
        title="System"
        subtitle="Background jobs, worker status and how each discovery source has been behaving. Configuration lives under Settings."
        actions={<AutoRefresh active={active} label="Jobs running" />}
      />
      <div className="grid md:grid-cols-4 gap-3 mb-5">
        {[
          { k: "Worker", v: worker.running ? `running · ${worker.active} active` : cfg.serverless ? "serverless (on demand)" : "stopped", tone: worker.running || cfg.serverless ? "ok" : "warn" },
          { k: "Queued", v: String(byStatus("queued")), tone: "neutral" },
          { k: "Running", v: String(byStatus("running")), tone: "accent" },
          { k: "Failed", v: String(byStatus("failed")), tone: byStatus("failed") ? "bad" : "neutral" },
        ].map((x) => (
          <div key={x.k} className="surface p-4">
            <div className="text-xs text-ink-muted">{x.k}</div>
            <div className="text-lg font-semibold mt-1 flex items-center gap-2">
              <Badge tone={x.tone as "ok"} dot>
                {x.v}
              </Badge>
            </div>
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-[1fr_380px] gap-5 items-start">
        <Card title="Recent jobs" description="Newest first. Failed jobs can be retried; queued ones cancelled. A hung job is abandoned after its time limit and shows why." padded={false}>
          {jobsRows.length === 0 ? (
            <TableEmpty icon="bolt" title="No jobs yet" description="Jobs appear when you run a search or investigate a business." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Timing</th>
                    <th>Outcome</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {jobsRows.map((j) => {
                    const dur = j.startedAt ? (new Date(j.finishedAt ?? Date.now()).getTime() - new Date(j.startedAt).getTime()) : null;
                    return (
                      <tr key={j.id}>
                        <td>
                          <div className="text-sm">{j.type.replace(/_/g, " ")}</div>
                          {j.subject ? (
                            <Link href={j.subject.href} className="text-xs text-ink-muted truncate block max-w-[240px]">
                              {j.subject.label}
                            </Link>
                          ) : (
                            <div className="text-xs text-ink-faint">{j.id.slice(0, 8)}</div>
                          )}
                        </td>
                        <td>
                          <StatusPill status={j.status} />
                          {j.status === "running" && j.progress?.message && <div className="text-[11px] text-ink-faint mt-0.5 max-w-[200px] truncate">{j.progress.message}</div>}
                        </td>
                        <td className="text-xs tabular-nums">
                          {j.attempts} / {j.maxAttempts}
                        </td>
                        <td className="text-xs text-ink-muted whitespace-nowrap">
                          <div>{fmtRelative(j.createdAt)}</div>
                          {dur != null && <div className="text-ink-faint">{fmtSec(dur)}</div>}
                        </td>
                        <td className="max-w-[360px]">
                          {j.error ? <div className={`text-xs ${j.status === "failed" ? "text-bad" : "text-ink-muted"} line-clamp-2`} title={j.error}>{j.error}</div> : <span className="text-xs text-ink-faint">{j.status === "done" ? "ok" : ""}</span>}
                        </td>
                        <td className="whitespace-nowrap">
                          {j.status === "failed" && (
                            <form action={retryJobAction}>
                              <input type="hidden" name="jobId" value={j.id} />
                              <button className="btn btn-sm btn-ghost">Retry</button>
                            </form>
                          )}
                          {j.status === "queued" && (
                            <form action={cancelJobAction}>
                              <input type="hidden" name="jobId" value={j.id} />
                              <button className="btn btn-sm btn-ghost">Cancel</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Source health" description="Over the last 40 searches.">
            {health.length === 0 ? (
              <p className="text-xs text-ink-faint">No searches yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {health.map((h) => (
                  <li key={h.key} className="py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{PROVIDER_LABEL[h.key] ?? h.key}</span>
                      <Badge tone={h.failures === 0 ? "ok" : h.failures < h.runs ? "warn" : "bad"} dot>
                        {h.runs - h.failures}/{h.runs} ok
                      </Badge>
                    </div>
                    <div className="text-xs text-ink-muted mt-0.5">
                      {h.found} candidates · avg {fmtSec(h.avgMs)} · last {fmtRelative(h.lastAt)}
                    </div>
                    {h.lastError && <div className="text-[11px] text-bad mt-0.5 line-clamp-2">{h.lastError}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Capabilities">
            <ul className="text-xs space-y-1.5">
              {Object.values(integ)
                .filter((i) => ["Model provider", "Overture", "OpenStreetMap", "Web search", "Off-site footprint"].some((k) => i.label.startsWith(k)))
                .map((i) => (
                  <li key={i.label} className="flex items-start gap-2">
                    <Badge tone={i.status === "live" ? "ok" : i.status === "missing_credentials" ? "warn" : "neutral"} dot className="shrink-0 mt-0.5">
                      {i.status === "live" ? "live" : i.status === "missing_credentials" ? "needs key" : "off"}
                    </Badge>
                    <span className="text-ink-muted">{i.label}</span>
                  </li>
                ))}
            </ul>
            <Link href="/settings" className="text-xs mt-3 inline-block">
              All integrations and limits →
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
