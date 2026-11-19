"use client";
/**
 * Pipeline board: one column per stage. Cards are dragged between columns and
 * reordered inside a column (dnd-kit: pointer, touch and keyboard sensors, a
 * drag overlay, a drop placeholder). Every card also has a "Move to" control
 * for people who cannot drag.
 *
 * State model: `items` is the board exactly as the operator sees it, in board
 * order. A drop updates it at once and is saved in the background; saves run
 * one after another so quick consecutive drops cannot overtake each other.
 * Fresh server data replaces local state only while nothing is being saved,
 * otherwise a refresh triggered by one save would undo the next drop. A failed
 * save puts the board back to the last server state and shows why.
 *
 * Layout: a strip on top names every stage with its count, in the order a
 * conversation moves, so the whole pipeline reads in one line. Below it the
 * six working stages are full columns in two rows of three ("Reaching out",
 * "In conversation"), wide enough for a whole company name, and the two
 * outcomes (won, lost) are drop rows underneath. Every business on the board
 * is shown: a long column scrolls inside itself. On a phone one stage is shown
 * at a time, chosen from the strip; a card moved with its "Move to" menu takes
 * the view along. "Discovered" and "Researching" are handled by the system and
 * shown as counters above the board, not here. Nothing on a card appears or
 * moves on hover.
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCorners, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { moveOnBoardAction } from "@/app/actions";
import { Badge, Icon, ScoreRing, fmtRelative } from "@/components/ui";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipeline/stages";

export interface BoardItem {
  id: string;
  name: string;
  city: string | null;
  domain: string | null;
  priority: number | null;
  highPriority: boolean;
  draftCount: number;
  nextAction: string | null;
  nextActionAt: string | null;
  stage: PipelineStage;
  /** When the business last moved on the board (stage, order or next action). */
  movedAt?: string | null;
  /** Replies from this business that nobody has answered yet. */
  openReplies?: number;
}

/** The working stages in two groups: before the business has answered, and after. */
const GROUPS: { title: string; hint: string; stages: PipelineStage[] }[] = [
  { title: "Reaching out", hint: "Qualified, the email written, the email sent", stages: ["qualified", "ready_to_contact", "contacted"] },
  { title: "In conversation", hint: "They answered: from the first reply to a proposal", stages: ["replied", "meeting_scheduled", "proposal_sent"] },
];
/** Every stage of the board, in the order a conversation moves; the two outcomes come last. */
const BOARD: PipelineStage[] = ["qualified", "ready_to_contact", "contacted", "replied", "meeting_scheduled", "proposal_sent", "won", "lost"];
const CLOSED: PipelineStage[] = ["won", "lost"];
/** The dot in front of a stage name: where the conversation is. */
const DOT: Record<string, string> = { qualified: "bg-ink-faint", ready_to_contact: "bg-ink-faint", contacted: "bg-accent", replied: "bg-ok", meeting_scheduled: "bg-ok", proposal_sent: "bg-ok", won: "bg-ok", lost: "bg-bad" };
/** Stages offered in a card's "Move to" control: the board's own, plus "Discovered" to take a card off the board. */
const MOVE_TARGETS = PIPELINE_STAGES.filter((s) => s.key !== "researching");
const STAGES = new Set<string>(PIPELINE_STAGES.map((s) => s.key));
const label = (k: PipelineStage) => PIPELINE_STAGES.find((s) => s.key === k)?.label ?? k;
/** Droppable id of a column; card ids are business ids (UUIDs), which never collide with these. */
const colId = (stage: PipelineStage) => `column:${stage}`;
/** Set when a drag ends; a click that lands on the card's link right after a drop must not navigate. */
let lastDragEnd = 0;
const stageOf = (id: UniqueIdentifier): PipelineStage | null => (typeof id === "string" && id.startsWith("column:") && STAGES.has(id.slice(7)) ? (id.slice(7) as PipelineStage) : null);

/** Prefer whatever is under the pointer (a card, else its column); fall back to the nearest corners for keyboard moves. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length) {
    const card = within.find((c) => !stageOf(c.id));
    return card ? [card] : within;
  }
  return closestCorners(args);
};

/**
 * `hidden` says how many more businesses each stage holds beyond the cards given
 * (a column shows its first cards only); `moreQuery` is the query string that
 * opens the full list for a stage on the Businesses page.
 */
export function PipelineBoard({ items: initial, hidden = {}, moreQuery = "" }: { items: BoardItem[]; hidden?: Record<string, number>; moreQuery?: string }) {
  const more = (stage: PipelineStage) => hidden[stage] ?? 0;
  const moreLink = (stage: PipelineStage) =>
    more(stage) > 0 ? (
      <Link href={`/businesses?stage=${stage}${moreQuery ? `&${moreQuery}` : ""}`} className="block text-center text-sm text-accent-text py-2 rounded-[var(--radius-sm)] hover:bg-surface hover:no-underline">
        {more(stage)} more in the list
      </Link>
    ) : null;
  const [items, setItems] = useState(initial);
  /** The one stage shown on a phone: to start with, the first that holds cards. */
  const [shown, setShown] = useState<PipelineStage>(() => BOARD.find((st) => initial.some((i) => i.stage === st)) ?? "qualified");
  const [active, setActive] = useState<BoardItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const serverRef = useRef(initial);
  serverRef.current = initial;
  const chain = useRef(Promise.resolve());
  const inFlight = useRef(0);
  /** The board as it was when the current drag started: what "nothing changed" is measured against. */
  const dragStart = useRef<BoardItem[] | null>(null);
  const dndId = useId();

  // Server refreshes (after a save, or on navigation) win only while nothing is being saved.
  useEffect(() => {
    if (inFlight.current === 0) setItems(initial);
  }, [initial]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byStage = (list: BoardItem[], stage: PipelineStage) => list.filter((i) => i.stage === stage);

  /** Persist one card's column and the order of that column. Saves are serialized. */
  const save = (id: string, stage: PipelineStage, name: string) => {
    const orderedIds = byStage(itemsRef.current, stage).map((i) => i.id);
    inFlight.current++;
    setSaving((n) => n + 1);
    chain.current = chain.current
      .then(async () => {
        let message: string | null = null;
        try {
          const r = await moveOnBoardAction(id, stage, orderedIds);
          if (!r.ok) message = r.error;
        } catch (err) {
          message = err instanceof Error ? err.message : "network error";
        }
        if (message) {
          setError(`Could not move ${name} to ${label(stage)}: ${message}`);
          setItems(serverRef.current);
        }
      })
      .finally(() => {
        inFlight.current--;
        setSaving((n) => n - 1);
      });
  };

  /** Drop the card into `stage` at the end (used by the "Move to" control). */
  const moveTo = (id: string, stage: PipelineStage) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item || item.stage === stage) return;
    setError(null);
    const next = [...itemsRef.current.filter((i) => i.id !== id), { ...item, stage }];
    itemsRef.current = next;
    setItems(next);
    if (BOARD.includes(stage)) setShown(stage); // on a phone, follow the card to where it went
    save(id, stage, item.name);
  };

  const onDragStart = (e: DragStartEvent) => {
    setError(null);
    dragStart.current = itemsRef.current;
    setActive(itemsRef.current.find((i) => i.id === e.active.id) ?? null);
  };

  // Crossing into another column moves the card there right away so the placeholder shows where it lands.
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const cur = itemsRef.current;
    const item = cur.find((i) => i.id === active.id);
    if (!item) return;
    const overStage = stageOf(over.id) ?? cur.find((i) => i.id === over.id)?.stage;
    if (!overStage || overStage === item.stage) return;
    const rest = cur.filter((i) => i.id !== item.id);
    const moved = { ...item, stage: overStage };
    const overIndex = rest.findIndex((i) => i.id === over.id);
    if (overIndex === -1) rest.push(moved); // over the column itself: append
    else {
      // Above the midpoint of the hovered card → before it; otherwise after.
      const translated = active.rect.current.translated;
      const below = Boolean(translated && translated.top > over.rect.top + over.rect.height / 2);
      rest.splice(overIndex + (below ? 1 : 0), 0, moved);
    }
    itemsRef.current = rest;
    setItems(rest);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActive(null);
    lastDragEnd = Date.now();
    const item = itemsRef.current.find((i) => i.id === active.id);
    const before = dragStart.current;
    dragStart.current = null;
    if (!item || !before) return;
    let next = itemsRef.current;
    const startStage = before.find((i) => i.id === item.id)?.stage;
    if (over && over.id !== active.id && !stageOf(over.id) && startStage === item.stage) {
      const overItem = next.find((i) => i.id === over.id);
      if (overItem && overItem.stage === item.stage) {
        // Same column from start to end: reorder. (A card that crossed columns was already placed by onDragOver.)
        const col = byStage(next, item.stage).map((i) => i.id);
        const reordered = arrayMove(col, col.indexOf(item.id), col.indexOf(overItem.id));
        const others = next.filter((i) => i.stage !== item.stage);
        next = [...others, ...reordered.map((id) => next.find((i) => i.id === id)!)];
        itemsRef.current = next;
        setItems(next);
      }
    }
    const beforeOrder = startStage ? byStage(before, startStage).map((i) => i.id) : [];
    const afterOrder = byStage(next, item.stage).map((i) => i.id);
    if (startStage === item.stage && beforeOrder.join() === afterOrder.join()) return; // nothing changed since the drag started
    save(item.id, item.stage, item.name);
  };

  const onDragCancel = () => {
    setActive(null);
    const back = dragStart.current ?? itemsRef.current;
    dragStart.current = null;
    itemsRef.current = back;
    setItems(back);
  };

  const card = (it: BoardItem) => <SortableCard key={it.id} it={it} compact={false} onMove={(s) => moveTo(it.id, s)} />;

  return (
    <DndContext id={dndId} sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className="space-y-4" data-saving={saving > 0 || undefined}>
        {error && (
          <div className="flex items-center gap-2 text-xs text-bad bg-bad/10 border border-bad/30 rounded-[var(--radius)] px-3 py-2" role="alert">
            <span className="flex-1">{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)} aria-label="Dismiss">
              <Icon name="x" />
            </button>
          </div>
        )}
        {/* The whole pipeline in one line. On a phone it also picks the one stage that is shown. */}
        <nav aria-label="Stages" className="-mx-1 px-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar md:flex-wrap md:overflow-visible">
          {BOARD.map((stage, i) => {
            const count = byStage(items, stage).length + more(stage);
            return (
              <span key={stage} className="flex items-center gap-1.5 shrink-0">
                {i > 0 && <Icon name="chevronRight" className={`w-3.5 h-3.5 text-ink-faint hidden md:block ${stage === "won" ? "md:ml-3" : ""} ${CLOSED.includes(stage) ? "md:invisible" : ""}`} />}
                <button type="button" onClick={() => { setShown(stage); document.querySelector(`section[data-stage="${stage}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} aria-pressed={shown === stage} className={`chip gap-2 ${shown === stage ? "max-md:bg-accent-soft max-md:text-accent-text max-md:border-transparent" : ""} ${count ? "text-ink" : ""}`}>
                  <span className={`w-2 h-2 rounded-full ${count ? DOT[stage] : "bg-line-strong"}`} aria-hidden />
                  {label(stage)} <span className={`tabular-nums ${count ? "font-bold" : "opacity-60"}`}>{count}</span>
                </button>
              </span>
            );
          })}
        </nav>
        {GROUPS.map((group) => (
          <div key={group.title} className={group.stages.includes(shown) ? "" : "hidden md:block"}>
            <div className="hidden md:flex flex-wrap items-baseline gap-x-2 px-1 mb-2">
              <h2 className="text-base font-semibold text-ink">{group.title}</h2>
              <span className="text-sm text-ink-faint">{group.hint}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-3 md:items-start">
              {group.stages.map((stage) => {
                const list = byStage(items, stage);
                const count = list.length + more(stage);
                return (
                  <section key={stage} aria-label={label(stage)} data-stage={stage} className={`min-w-0 ${shown === stage ? "" : "hidden md:block"}`}>
                    <Column stage={stage} list={list} active={active} className="p-2">
                      <div className="flex items-center gap-2 px-1 pb-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${count ? DOT[stage] : "bg-line-strong"}`} aria-hidden />
                        <h3 className="text-sm font-semibold text-ink truncate">{label(stage)}</h3>
                        <span className={`ml-auto text-xs tabular-nums rounded-full px-2 py-0.5 ${count ? "bg-surface text-ink border border-line font-semibold" : "text-ink-faint"}`}>{count}</span>
                      </div>
                      {/* Every card is here; a long stage scrolls inside its column. */}
                      <div className="space-y-2 md:max-h-[34rem] md:overflow-y-auto scrollbar-thin md:pr-0.5">
                        {list.map((it) => card(it))}
                        {list.length === 0 && <div className="text-sm text-ink-faint text-center rounded-[var(--radius-sm)] border border-dashed border-line-strong/70 py-5">{active ? "Drop here" : "Nothing in this stage"}</div>}
                        {moreLink(stage)}
                      </div>
                    </Column>
                  </section>
                );
              })}
            </div>
          </div>
        ))}
        <div className={`grid gap-3 md:grid-cols-2 ${CLOSED.includes(shown) ? "" : "hidden md:grid"}`}>
          {CLOSED.map((stage) => {
            const list = byStage(items, stage);
            const count = list.length + more(stage);
            return (
              <section key={stage} aria-label={label(stage)} data-stage={stage} className={`min-w-0 ${shown === stage ? "" : "hidden md:block"}`}>
                <Column stage={stage} list={list} active={active} className="p-2">
                  <div className="flex items-center gap-2 px-1 pb-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${count ? DOT[stage] : "bg-line-strong"}`} aria-hidden />
                    <h2 className="text-sm font-semibold text-ink">{label(stage)}</h2>
                    <span className="ml-auto text-xs text-ink-faint tabular-nums">{count}</span>
                  </div>
                  {list.length === 0 ? (
                    <div className="text-sm text-ink-faint px-1 py-2">{active ? "Drop here" : `Drag a business here to mark it ${label(stage).toLowerCase()}.`}</div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">{list.map((it) => card(it))}</div>
                  )}
                  {moreLink(stage)}
                </Column>
              </section>
            );
          })}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 150 }}>{active ? <CardBody it={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ stage, list, active, className, children }: { stage: PipelineStage; list: BoardItem[]; active: BoardItem | null; className: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: colId(stage) });
  // Highlight the column the dragged card currently belongs to (it moves on hover), or the one hovered when empty.
  const highlight = isOver || (active !== null && list.some((i) => i.id === active.id));
  return (
    <SortableContext items={list.map((i) => i.id)} strategy={rectSortingStrategy}>
      <div ref={setNodeRef} data-column={stage} className={`rounded-[var(--radius)] border transition-colors ${className} ${highlight ? "border-accent bg-accent-soft/50" : "border-line bg-surface-3/50"}`}>
        {children}
      </div>
    </SortableContext>
  );
}

function SortableCard({ it, compact, onMove }: { it: BoardItem; compact: boolean; onMove: (s: PipelineStage) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: it.id });
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} data-business={it.id} className={isDragging ? "opacity-30" : undefined} aria-label={`${it.name}, ${label(it.stage)}`} {...attributes} {...listeners}>
      <CardBody it={it} compact={compact} onMove={onMove} />
    </article>
  );
}

/**
 * The "Move to" menu, for touch screens only (below the `md` width), where
 * dragging a card is awkward. On a laptop cards are moved by dragging and carry
 * no stage control at all, so nothing shows up when the pointer passes over one.
 */
function MoveMenu({ it, onMove }: { it: BoardItem; onMove: (s: PipelineStage) => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <select
      className="select h-8 py-0 pl-2 pr-6 text-xs w-auto max-w-[9rem] shrink-0 text-ink-muted md:hidden"
      value=""
      onChange={(e) => e.target.value && onMove(e.target.value as PipelineStage)}
      aria-label={`Move ${it.name} to stage`}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onKeyDown={stop}
    >
      <option value="" disabled>
        Move to…
      </option>
      {MOVE_TARGETS.filter((s) => s.key !== it.stage).map((s) => (
        <option key={s.key} value={s.key}>
          {s.key === "discovered" ? "Off the board" : s.label}
        </option>
      ))}
    </select>
  );
}

/** Card content, shared by the sortable card and the drag overlay (the copy that follows the pointer). */
function CardBody({ it, compact = false, overlay = false, onMove }: { it: BoardItem; compact?: boolean; overlay?: boolean; onMove?: (s: PipelineStage) => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const replies = it.openReplies ?? 0;
  const name = (
    <Link href={`/businesses/${it.id}`} title={it.name} className={`block text-sm font-medium text-ink leading-snug hover:underline ${compact ? "truncate" : "line-clamp-2"}`} draggable={false} onClick={(e) => Date.now() - lastDragEnd < 400 && e.preventDefault()} onKeyDown={stop}>
      {it.name}
    </Link>
  );
  const shell = `surface select-none ${overlay ? "shadow-lg cursor-grabbing rotate-[1.5deg]" : "cursor-grab"}`;

  // Won and lost: one line, the name and where it can still go.
  if (compact)
    return (
      <div className={`${shell} px-3 py-2 flex items-center gap-2`}>
        <div className="min-w-0 flex-1">
          {name}
          <div className="text-xs text-ink-faint truncate">{[it.city, it.domain].filter(Boolean).join(" · ") || "no city or website"}</div>
        </div>
        {onMove && <MoveMenu it={it} onMove={onMove} />}
      </div>
    );

  return (
    <div className={`${shell} p-3`}>
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          {name}
          <div className="text-xs text-ink-faint truncate mt-0.5">{[it.city, it.domain].filter(Boolean).join(" · ") || "no city or website"}</div>
        </div>
        {it.priority != null && <ScoreRing value={it.priority} size={32} />}
      </div>
      {(replies > 0 || it.highPriority || (it.draftCount > 0 && (it.stage === "qualified" || it.stage === "ready_to_contact"))) && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {replies > 0 && (
            <Badge tone="ok" dot title="They wrote back and nobody has answered yet">
              reply to answer
            </Badge>
          )}
          {it.draftCount > 0 && (it.stage === "qualified" || it.stage === "ready_to_contact") && (
            <Badge tone="accent" title="An email is written and waits under Outreach">
              <Icon name="mail" className="w-3 h-3" /> email ready
            </Badge>
          )}
          {it.highPriority && <Badge tone="warn">high priority</Badge>}
        </div>
      )}
      {it.nextAction && (
        <div className="text-xs text-ink-muted mt-2 flex items-start gap-1.5 min-w-0">
          <Icon name="arrowRight" className="w-3 h-3 mt-0.5 shrink-0 text-ink-faint" />
          <span className="line-clamp-2">
            {it.nextAction}
            {it.nextActionAt ? ` · ${fmtRelative(it.nextActionAt)}` : ""}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-line">
        <span className="text-xs text-ink-faint truncate" title={it.movedAt ? new Date(it.movedAt).toLocaleString() : undefined}>
          {it.movedAt ? `moved ${fmtRelative(it.movedAt)}` : "\u00a0"}
        </span>
        {onMove && <MoveMenu it={it} onMove={onMove} />}
      </div>
    </div>
  );
}
