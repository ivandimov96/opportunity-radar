"use client";
/**
 * Pipeline board.
 *
 * Layout, as on the boards of Jira and Azure Boards: every stage is a column,
 * all columns side by side in one row in the order a conversation moves, the
 * two outcomes last. A column has a header with the stage name and its count
 * and holds its cards one under another. All columns have the same width and
 * the same height, so an empty one is a clear place to drop a card. When the
 * columns do not fit the window the board scrolls sideways, and it scrolls by
 * itself when a card is carried to its edge. On a phone the columns are swiped
 * one at a time. Every business on the board is on the page: a column grows
 * with its cards and nothing scrolls inside it.
 *
 * Moving: drag a card into another column, or onto a card of its own column to
 * change the order. On a phone each card also
 * carries a "Move to" menu, since dragging is awkward on a touch screen.
 * Nothing on a card appears or moves on hover. A business that was already
 * emailed cannot go back to a stage before the email.
 *
 * Exact place: while a card is carried over another stage's cards it steps
 * into that stage at the spot under the pointer, so the gap shows where it
 * will land; dropping it there keeps that spot. Dropped on the empty part of
 * a column it goes to the end of that stage. A drag that is let go outside any stage puts
 * everything back as it was.
 *
 * State: `items` is the board exactly as the operator sees it. A drop is saved
 * in the background; the board shows it at once
 * and is saved in the background; saves run one after another so quick drops
 * cannot overtake each other. Fresh server data replaces local state only
 * while nothing is being saved. A failed save puts the board back to the last
 * server state and says why.
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCorners, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
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

/** Every stage of the board, in the order a conversation moves; the two outcomes come last. */
const BOARD: PipelineStage[] = ["qualified", "ready_to_contact", "contacted", "replied", "meeting_scheduled", "proposal_sent", "won", "lost"];
/** Stages before the first email. A business that was emailed never goes back to these. */
const BEFORE_EMAIL: PipelineStage[] = ["qualified", "ready_to_contact"];
/** What a stage means, in a few words, under its name. */
const MEANING: Record<string, string> = {
  qualified: "Worth writing to",
  ready_to_contact: "Email written, waiting for you",
  contacted: "Email sent, waiting for a reply",
  replied: "They answered",
  meeting_scheduled: "A call or meeting is set",
  proposal_sent: "They have your proposal",
  won: "They said yes",
  lost: "It did not work out",
};
/** What is going on with a business in a stage, as shown on its card. */
const STATUS: Record<string, string> = {
  qualified: "Waiting for its email",
  ready_to_contact: "Email waiting for your review",
  contacted: "Waiting for a reply",
  replied: "They replied",
  meeting_scheduled: "Meeting set",
  proposal_sent: "Waiting for their answer",
  won: "Won",
  lost: "Lost",
};
const DOT: Record<string, string> = { qualified: "bg-ink-faint", ready_to_contact: "bg-warn", contacted: "bg-accent", replied: "bg-ok", meeting_scheduled: "bg-ok", proposal_sent: "bg-ok", won: "bg-ok", lost: "bg-bad" };
/** Stages offered in a card's "Move to" menu: the board's own, plus "Discovered" to take a card off the board. */
const MOVE_TARGETS = PIPELINE_STAGES.filter((s) => s.key !== "researching");
const STAGES = new Set<string>(PIPELINE_STAGES.map((s) => s.key));
const label = (k: PipelineStage) => PIPELINE_STAGES.find((s) => s.key === k)?.label ?? k;
/** Drop targets: a stage's tile ("tile:<stage>") and its section ("zone:<stage>"). Card ids are business ids (UUIDs), which never collide with these. */
const tileId = (stage: PipelineStage) => `tile:${stage}`;
const zoneId = (stage: PipelineStage) => `zone:${stage}`;
const stageOf = (id: UniqueIdentifier): PipelineStage | null => {
  if (typeof id !== "string") return null;
  const m = /^(?:tile|zone):(.+)$/.exec(id);
  return m && STAGES.has(m[1]) ? (m[1] as PipelineStage) : null;
};
/** Set when a drag ends; a click that lands on the card's link right after a drop must not navigate. */
let lastDragEnd = 0;

/** Prefer what is under the pointer: a card first, then a tile, then a section. Keyboard moves fall back to the nearest corners. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length) {
    const tile = within.find((c) => String(c.id).startsWith("tile:"));
    if (tile) return [tile];
    const card = within.find((c) => !stageOf(c.id));
    return card ? [card] : within;
  }
  return closestCorners(args);
};

/**
 * `hidden` says how many more businesses each stage holds beyond the cards given
 * (only a very long stage is cut); `moreQuery` is the query string that opens the
 * full list for a stage on the Businesses page.
 */
export function PipelineBoard({ items: initial, hidden = {}, moreQuery = "" }: { items: BoardItem[]; hidden?: Record<string, number>; moreQuery?: string }) {
  const more = (stage: PipelineStage) => hidden[stage] ?? 0;
  const [items, setItems] = useState(initial);
  const [active, setActive] = useState<BoardItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const serverRef = useRef(initial);
  serverRef.current = initial;
  const chain = useRef(Promise.resolve());
  const inFlight = useRef(0);
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
  const countOf = (stage: PipelineStage) => byStage(items, stage).length + more(stage);

  /** Persist one card's stage and the order of that stage. Saves are serialized. */
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

  /** Put the card into `stage`, at the end. Used by a drop on a tile or section and by the "Move to" menu. */
  const moveTo = (id: string, stage: PipelineStage) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item || item.stage === stage) return;
    if (BEFORE_EMAIL.includes(stage) && !BEFORE_EMAIL.includes(item.stage) && BOARD.includes(item.stage)) {
      setError(`${item.name} was already emailed, so it cannot go back to “${label(stage)}”. It stays in “${label(item.stage)}”.`);
      return;
    }
    setError(null);
    const next = [...itemsRef.current.filter((i) => i.id !== id), { ...item, stage }];
    itemsRef.current = next;
    setItems(next);
    save(id, stage, item.name);
  };

  /** The board as it was when the current drag started: what an abandoned drag goes back to. */
  const dragStart = useRef<BoardItem[] | null>(null);
  const blockedFor = (item: BoardItem, stage: PipelineStage) => BEFORE_EMAIL.includes(stage) && !BEFORE_EMAIL.includes(item.stage) && BOARD.includes(item.stage);

  const onDragStart = (e: DragStartEvent) => {
    setError(null);
    dragStart.current = itemsRef.current;
    setActive(itemsRef.current.find((i) => i.id === e.active.id) ?? null);
  };

  // Carried over another stage's cards: step into that stage at the spot under the pointer, so the gap shows where it lands.
  const onDragOver = (e: DragOverEvent) => {
    const { active: dragged, over } = e;
    if (!over || dragged.id === over.id) return;
    if (String(over.id).startsWith("tile:")) return; // a tile only takes the drop
    const cur = itemsRef.current;
    const item = cur.find((i) => i.id === dragged.id);
    if (!item) return;
    const overCard = stageOf(over.id) ? null : cur.find((i) => i.id === over.id);
    const overStage = stageOf(over.id) ?? overCard?.stage;
    if (!overStage || overStage === item.stage) return;
    const origin = dragStart.current?.find((i) => i.id === item.id) ?? item;
    if (blockedFor(origin, overStage)) return;
    const rest = cur.filter((i) => i.id !== item.id);
    const moved = { ...item, stage: overStage };
    const overIndex = overCard ? rest.findIndex((i) => i.id === overCard.id) : -1;
    if (overIndex === -1) rest.push(moved); // over the stage itself: at the end
    else {
      // Past the middle of the card under the pointer: after it; otherwise before it.
      const t = dragged.rect.current.translated;
      const after = Boolean(t && t.top > over.rect.top + over.rect.height / 2);
      rest.splice(overIndex + (after ? 1 : 0), 0, moved);
    }
    itemsRef.current = rest;
    setItems(rest);
  };

  const restore = () => {
    const back = dragStart.current;
    dragStart.current = null;
    if (back) {
      itemsRef.current = back;
      setItems(back);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active: dragged, over } = e;
    setActive(null);
    lastDragEnd = Date.now();
    const before = dragStart.current;
    if (!before) return;
    const origin = before.find((i) => i.id === dragged.id);
    if (!origin || !over) return restore(); // let go outside every stage: nothing changes
    // On a tile: to the end of that stage, from where the card started.
    if (String(over.id).startsWith("tile:")) {
      const target = stageOf(over.id)!;
      restore();
      if (target !== origin.stage) moveTo(origin.id, target);
      return;
    }
    dragStart.current = null;
    let next = itemsRef.current;
    const item = next.find((i) => i.id === dragged.id);
    if (!item) return;
    const overCard = stageOf(over.id) ? null : next.find((i) => i.id === over.id);
    const overStage = stageOf(over.id) ?? overCard?.stage ?? null;
    if (overStage && overStage !== item.stage && blockedFor(origin, overStage)) {
      itemsRef.current = before;
      setItems(before);
      setError(`${origin.name} was already emailed, so it cannot go back to “${label(overStage)}”. It stays in “${label(origin.stage)}”.`);
      return;
    }
    // Within one stage, dropped on another card: take that card's place.
    if (overCard && overCard.id !== item.id && overCard.stage === item.stage) {
      const col = byStage(next, item.stage).map((i) => i.id);
      const reordered = arrayMove(col, col.indexOf(item.id), col.indexOf(overCard.id));
      next = [...next.filter((i) => i.stage !== item.stage), ...reordered.map((id) => next.find((i) => i.id === id)!)];
      itemsRef.current = next;
      setItems(next);
    }
    const was = byStage(before, origin.stage).map((i) => i.id).join();
    const now = byStage(next, item.stage).map((i) => i.id).join();
    if (origin.stage === item.stage && was === now) return; // nothing changed
    save(item.id, item.stage, item.name);
  };

  const total = BOARD.reduce((n, stage) => n + countOf(stage), 0);

  return (
    <DndContext id={dndId} sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActive(null); restore(); }}>
      <div data-saving={saving > 0 || undefined}>
        {error && (
          <div className="flex items-center gap-2 text-sm text-bad bg-bad/10 border border-bad/30 rounded-[var(--radius)] px-3 py-2 mb-3" role="alert">
            <span className="flex-1">{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)} aria-label="Dismiss">
              <Icon name="x" />
            </button>
          </div>
        )}
        <p className="text-sm text-ink-faint mb-2 px-0.5">
          {total} on the board. <span className="hidden md:inline">Drag a card to another column, or between cards to put it in an exact place.</span>
          <span className="md:hidden">Swipe sideways to see the other stages.</span>
        </p>
        {/* One row of columns. It scrolls sideways when the window is narrower than the board. */}
        <div role="group" aria-label="Stages" data-board className="flex items-stretch gap-2.5 overflow-x-auto pb-3 scrollbar-thin snap-x snap-mandatory md:snap-none -mx-4 px-4 md:mx-0 md:px-0">
          {BOARD.map((stage) => {
            const list = byStage(items, stage);
            const blocked = active !== null && BEFORE_EMAIL.includes(stage) && blockedFor(dragStart.current?.find((i) => i.id === active.id) ?? active, stage);
            return (
              <Zone key={stage} stage={stage} list={list} active={active} blocked={blocked}>
                <div className="flex items-center gap-2 px-1.5 pt-1 pb-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${countOf(stage) ? DOT[stage] : "bg-line-strong"}`} aria-hidden />
                  <h2 className="text-sm font-semibold text-ink truncate" title={MEANING[stage]}>
                    {label(stage)}
                  </h2>
                  <span className={`ml-auto text-xs font-semibold tabular-nums rounded-full px-2 py-0.5 ${countOf(stage) ? "bg-surface text-ink border border-line" : "text-ink-faint"}`}>{countOf(stage)}</span>
                </div>
                <div className="space-y-2">
                  {list.map((it) => (
                    <SortableCard key={it.id} it={it} onMove={(st) => moveTo(it.id, st)} />
                  ))}
                </div>
                {list.length === 0 && <p className="text-xs text-ink-faint text-center px-2 py-6">{active ? (blocked ? "Already emailed" : "Drop here") : MEANING[stage]}</p>}
                {more(stage) > 0 && (
                  <Link href={`/businesses?stage=${stage}${moreQuery ? `&${moreQuery}` : ""}`} className="block text-center text-sm text-accent-text py-2 mt-2 rounded-[var(--radius-sm)] hover:bg-surface hover:no-underline">
                    {more(stage)} more in the list
                  </Link>
                )}
              </Zone>
            );
          })}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 150 }}>{active ? <CardBody it={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

/** One column of the board: a drop target over its whole height, so a card can be dropped anywhere in it. */
function Zone({ stage, list, active, blocked, children }: { stage: PipelineStage; list: BoardItem[]; active: BoardItem | null; blocked: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: zoneId(stage) });
  const here = active !== null && list.some((i) => i.id === active.id);
  const tone = blocked ? (isOver ? "border-bad/60 bg-bad/10" : "border-line bg-surface-3/40 opacity-60") : isOver || here ? "border-accent bg-accent-soft/50" : "border-line bg-surface-3/50";
  return (
    <SortableContext items={list.map((i) => i.id)} strategy={verticalListSortingStrategy}>
      <section ref={setNodeRef} aria-label={label(stage)} data-stage={stage} className={`snap-center shrink-0 w-[84vw] sm:w-[16.5rem] xl:w-auto xl:flex-1 xl:min-w-[13rem] min-h-[26rem] rounded-[var(--radius)] border p-2 transition-colors ${tone}`}>
        {children}
      </section>
    </SortableContext>
  );
}

function SortableCard({ it, onMove }: { it: BoardItem; onMove: (s: PipelineStage) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: it.id });
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} data-business={it.id} className={isDragging ? "opacity-30" : undefined} aria-label={`${it.name}, ${label(it.stage)}`} {...attributes} {...listeners}>
      <CardBody it={it} onMove={onMove} />
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
  const emailed = BOARD.includes(it.stage) && !BEFORE_EMAIL.includes(it.stage);
  return (
    <select
      className="select h-9 py-0 pl-3 pr-7 text-sm w-full text-ink-muted mt-2.5 md:hidden"
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
      {MOVE_TARGETS.filter((s) => s.key !== it.stage && !(emailed && BEFORE_EMAIL.includes(s.key))).map((s) => (
        <option key={s.key} value={s.key}>
          {s.key === "discovered" ? "Off the board" : s.label}
        </option>
      ))}
    </select>
  );
}

/** Card content, shared by the card on the board and the copy that follows the pointer while dragging. */
function CardBody({ it, overlay = false, onMove }: { it: BoardItem; overlay?: boolean; onMove?: (s: PipelineStage) => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const replies = it.openReplies ?? 0;
  const emailReady = it.draftCount > 0 && BEFORE_EMAIL.includes(it.stage);
  return (
    <div className={`surface select-none p-3 flex flex-col ${overlay ? "shadow-lg cursor-grabbing rotate-[1.5deg] w-[15rem]" : "cursor-grab"}`}>
      {/* The name gets the whole width, as on a Jira card; the details sit in one row under it. */}
      <Link href={`/businesses/${it.id}`} title={it.name} className="block text-[0.92rem] font-semibold text-ink leading-snug hover:underline line-clamp-3" draggable={false} onClick={(e) => Date.now() - lastDragEnd < 400 && e.preventDefault()} onKeyDown={stop}>
        {it.name}
      </Link>
      <div className="text-xs text-ink-faint truncate mt-0.5">{it.city ?? it.domain ?? "no city or website"}</div>
      {(replies > 0 || it.highPriority || emailReady) && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {replies > 0 && (
            <Badge tone="ok" dot title="They wrote back and nobody has answered yet">
              reply to answer
            </Badge>
          )}
          {emailReady && (
            <Badge tone="accent" title="An email is written and waits under Outreach">
              <Icon name="mail" className="w-3 h-3" /> email ready
            </Badge>
          )}
          {it.highPriority && <Badge tone="warn">high priority</Badge>}
        </div>
      )}
      {/* What is going on with this business right now, and for how long; its score on the right. */}
      <div className="flex items-end justify-between gap-2 mt-2.5">
        <span className="min-w-0 text-xs text-ink-muted leading-snug" title={it.movedAt ? new Date(it.movedAt).toLocaleString() : undefined}>
          <span className="block">{it.nextAction ?? STATUS[it.stage] ?? label(it.stage)}</span>
          <span className="block text-ink-faint">{it.nextActionAt ? fmtRelative(it.nextActionAt) : it.movedAt ? `for ${fmtRelative(it.movedAt).replace(/ ago$/, "")}` : ""}</span>
        </span>
        {it.priority != null && <ScoreRing value={it.priority} size={30} />}
      </div>
      {onMove && <MoveMenu it={it} onMove={onMove} />}
    </div>
  );
}
