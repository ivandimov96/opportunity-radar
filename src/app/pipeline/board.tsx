"use client";
/**
 * Pipeline board: one column per stage, cards draggable between columns
 * (native HTML drag and drop; the move is applied optimistically and
 * persisted by a server action, reverted on failure). Every card also has a
 * "Move to" control for touch screens and keyboards, which cannot drag.
 *
 * Layout: the six working stages are columns (all visible side by side on a
 * laptop; they wrap on tablets and stack on phones); the two closed stages
 * (lost, disqualified) are compact drop rows underneath.
 */
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { moveStageAction } from "@/app/actions";
import { Badge, Icon, ScoreRing, fmtRelative } from "@/components/ui";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipeline/stages";

export interface BoardItem {
  id: string;
  name: string;
  city: string | null;
  domain: string | null;
  priority: number | null;
  isDemo: boolean;
  highPriority: boolean;
  draftCount: number;
  nextAction: string | null;
  nextActionAt: string | null;
  stage: PipelineStage;
}

const OPEN: PipelineStage[] = ["lead", "qualified", "contacted", "in_conversation", "validated", "won"];
const CLOSED: PipelineStage[] = ["lost", "disqualified"];
const label = (k: PipelineStage) => PIPELINE_STAGES.find((s) => s.key === k)?.label ?? k;

export function PipelineBoard({ items: initial }: { items: BoardItem[] }) {
  const [items, setItems] = useState(initial);
  const [optimistic, applyMove] = useOptimistic(items, (cur, move: { id: string; stage: PipelineStage }) => cur.map((i) => (i.id === move.id ? { ...i, stage: move.stage } : i)));
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<PipelineStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const move = (id: string, stage: PipelineStage) => {
    const item = items.find((i) => i.id === id);
    if (!item || item.stage === stage) return;
    setError(null);
    startTransition(async () => {
      applyMove({ id, stage });
      const r = await moveStageAction(id, stage);
      if (r.ok) setItems((cur) => cur.map((i) => (i.id === id ? { ...i, stage } : i)));
      else setError(`${item.name}: ${r.error}`);
    });
  };

  const dropProps = (stage: PipelineStage) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== stage) setOver(stage);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o === stage ? null : o));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragging;
      setOver(null);
      setDragging(null);
      if (id) move(id, stage);
    },
  });

  const byStage = (stage: PipelineStage) => optimistic.filter((i) => i.stage === stage);

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-xs text-bad" role="alert">
          Could not move {error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {OPEN.map((stage) => {
          const list = byStage(stage);
          return (
            <section key={stage} className="flex flex-col min-w-0" aria-label={label(stage)} data-stage={stage}>
              <div className="flex items-center justify-between px-1 mb-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted truncate">{label(stage)}</h2>
                <span className="text-[11px] text-ink-faint tabular-nums bg-surface-3 rounded-full px-1.5 shrink-0">{list.length}</span>
              </div>
              <div {...dropProps(stage)} className={`flex-1 rounded-[var(--radius)] border p-1.5 space-y-1.5 min-h-[120px] xl:min-h-[60vh] transition-colors ${over === stage ? "border-accent bg-accent-soft/40" : "border-line bg-surface-3/60"}`}>
                {list.length === 0 && <div className="text-[11px] text-ink-faint text-center py-6">{over === stage ? "Drop here" : "Empty"}</div>}
                {list.map((it) => (
                  <Card key={it.id} it={it} dragging={dragging === it.id} pending={pending} onDragStart={() => setDragging(it.id)} onDragEnd={() => { setDragging(null); setOver(null); }} onMove={(s) => move(it.id, s)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {CLOSED.map((stage) => {
          const list = byStage(stage);
          return (
            <section key={stage} aria-label={label(stage)} data-stage={stage} {...dropProps(stage)} className={`rounded-[var(--radius)] border p-2 transition-colors ${over === stage ? "border-accent bg-accent-soft/40" : "border-line bg-surface-3/40"}`}>
              <div className="flex items-center justify-between px-1 mb-1.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label(stage)}</h2>
                <span className="text-[11px] text-ink-faint tabular-nums bg-surface-3 rounded-full px-1.5">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <div className="text-[11px] text-ink-faint px-1 py-1">{over === stage ? "Drop here" : `Drag a prospect here to mark it ${label(stage).toLowerCase()}.`}</div>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((it) => (
                    <Card key={it.id} it={it} dragging={dragging === it.id} pending={pending} compact onDragStart={() => setDragging(it.id)} onDragEnd={() => { setDragging(null); setOver(null); }} onMove={(s) => move(it.id, s)} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Card({ it, dragging, pending, compact = false, onDragStart, onDragEnd, onMove }: { it: BoardItem; dragging: boolean; pending: boolean; compact?: boolean; onDragStart: () => void; onDragEnd: () => void; onMove: (s: PipelineStage) => void }) {
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", it.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      data-business={it.id}
      className={`group surface p-2.5 cursor-grab active:cursor-grabbing select-none transition-opacity ${dragging ? "opacity-40" : ""} ${pending ? "" : ""}`}
      aria-label={`${it.name}, ${label(it.stage)}`}
    >
      <div className="flex items-start gap-2">
        <Icon name="grip" className="w-3.5 h-3.5 mt-1 text-ink-faint shrink-0 hidden md:block" />
        <div className="min-w-0 flex-1">
          <Link href={`/businesses/${it.id}`} title={it.name} className="block text-[13px] font-medium text-ink truncate hover:underline" draggable={false}>
            {it.name}
          </Link>
          <div className="text-[11px] text-ink-faint truncate">{[it.city, it.domain].filter(Boolean).join(" · ") || "no city or website"}</div>
        </div>
        {it.priority != null && !compact && <ScoreRing value={it.priority} size={28} />}
      </div>
      {(it.isDemo || it.highPriority || it.draftCount > 0) && (
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          {it.isDemo && <Badge tone="demo">demo</Badge>}
          {it.highPriority && <Badge tone="warn">high</Badge>}
          {it.draftCount > 0 && (
            <Badge tone="accent" title={`${it.draftCount} outreach draft(s)`}>
              <Icon name="mail" className="w-3 h-3" /> {it.draftCount}
            </Badge>
          )}
        </div>
      )}
      {it.nextAction && !compact && (
        <div className="text-[11px] text-ink-muted mt-1.5 flex items-start gap-1 min-w-0">
          <Icon name="arrowRight" className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="truncate">
            {it.nextAction}
            {it.nextActionAt ? ` · ${fmtRelative(it.nextActionAt)}` : ""}
          </span>
        </div>
      )}
      {/* Touch screens and keyboards cannot drag: always shown below md, on hover/focus above it (no reserved space). */}
      <label className="mt-2 block md:hidden md:group-hover:block md:group-focus-within:block">
        <span className="sr-only">Move to</span>
        <select className="select h-7 py-0 pl-2 pr-7 text-[11px] w-full" value={it.stage} onChange={(e) => onMove(e.target.value as PipelineStage)} aria-label={`Move ${it.name} to stage`} onMouseDown={(e) => e.stopPropagation()} title="Move to stage">
          {PIPELINE_STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}
