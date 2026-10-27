import Link from "next/link";
import { pipelineBoard } from "@/lib/queries";
import { Badge, PageHeader } from "@/components/ui";
import { PIPELINE_STAGES } from "@/lib/pipeline/stages";
import { priorityScore } from "@/lib/scoring/score";

export default function PipelinePage() {
  const board = pipelineBoard();
  return (
    <>
      <PageHeader title="Pipeline" subtitle="Prospects by stage. Stages advance automatically through research → qualified → outreach ready; later stages are set by you." />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {PIPELINE_STAGES.map((s) => (
          <div key={s.key} className="card p-2 min-h-[160px]">
            <div className="flex justify-between items-center px-1 pb-2 border-b border-line mb-2">
              <span className="text-xs font-semibold">{s.label}</span>
              <span className="text-xs text-ink-faint">{board[s.key]?.length ?? 0}</span>
            </div>
            <ul className="space-y-1.5">
              {(board[s.key] ?? []).slice(0, 30).map((r) => (
                <li key={r.business.id} className="rounded border border-line px-2 py-1.5 text-xs bg-canvas">
                  <Link href={`/businesses/${r.business.id}?tab=pipeline`} className="font-medium block truncate">
                    {r.business.name}
                  </Link>
                  <div className="flex justify-between text-ink-faint mt-0.5">
                    <span>{r.attractiveness != null ? `P ${priorityScore(r.attractiveness, r.confidence ?? 0)}` : "—"}</span>
                    {r.business.isDemo && <Badge tone="demo">demo</Badge>}
                    {r.prospect.priority === "high" && <Badge tone="warn">high</Badge>}
                  </div>
                  {r.prospect.nextAction && <div className="text-ink-muted truncate mt-0.5">→ {r.prospect.nextAction}</div>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
