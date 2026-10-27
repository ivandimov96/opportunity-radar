import Link from "next/link";
import { pipelineBoard } from "@/lib/queries";
import { Badge, Icon, PageHeader, ScoreRing, fmtRelative } from "@/components/ui";
import { PIPELINE_STAGES } from "@/lib/pipeline/stages";
import { priorityScore } from "@/lib/scoring/score";

export default async function PipelinePage() {
  const board = await pipelineBoard();
  const total = Object.values(board).reduce((a, b) => a + b.length, 0);
  return (
    <>
      <PageHeader title="Pipeline" subtitle="Prospects by stage. Research and analysis advance businesses automatically up to “outreach ready”; you move them from there based on real conversations." actions={<span className="text-xs text-ink-muted">{total} prospects</span>} />
      <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin -mx-4 px-4 md:-mx-8 md:px-8">
        {PIPELINE_STAGES.map((s) => {
          const items = board[s.key] ?? [];
          return (
            <div key={s.key} className="w-[260px] shrink-0 flex flex-col">
              <div className="flex items-center justify-between px-1 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{s.label}</span>
                <span className="text-[11px] text-ink-faint tabular-nums bg-surface-3 rounded-full px-1.5">{items.length}</span>
              </div>
              <div className="flex-1 rounded-[var(--radius)] bg-surface-3/60 border border-line p-2 space-y-2 min-h-[140px]">
                {items.length === 0 && <div className="text-[11px] text-ink-faint text-center py-6">Empty</div>}
                {items.slice(0, 40).map((r) => (
                  <Link key={r.business.id} href={`/businesses/${r.business.id}`} className="block surface p-3 hover:shadow-md hover:no-underline transition-shadow">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink truncate">{r.business.name}</div>
                        <div className="text-[11px] text-ink-faint truncate">{[r.business.city, r.business.websiteDomain].filter(Boolean).join(" · ")}</div>
                      </div>
                      {r.attractiveness != null && <ScoreRing value={priorityScore(r.attractiveness, r.confidence ?? 0)} size={32} />}
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {r.business.isDemo && <Badge tone="demo">demo</Badge>}
                      {r.prospect.priority === "high" && <Badge tone="warn">high priority</Badge>}
                      {(r.draftCount ?? 0) > 0 && (
                        <Badge tone="accent">
                          <Icon name="mail" className="w-3 h-3" /> {r.draftCount}
                        </Badge>
                      )}
                    </div>
                    {r.prospect.nextAction && (
                      <div className="text-[11px] text-ink-muted mt-2 flex items-start gap-1">
                        <Icon name="arrowRight" className="w-3 h-3 mt-0.5 shrink-0" />
                        <span className="truncate">
                          {r.prospect.nextAction}
                          {r.prospect.nextActionAt ? ` · ${fmtRelative(r.prospect.nextActionAt)}` : ""}
                        </span>
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
