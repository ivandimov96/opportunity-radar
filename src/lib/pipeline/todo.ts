/**
 * The to-do list: every planned next action of the workspace's businesses that
 * are still in play, soonest first, sorted into the groups a person thinks in
 * (overdue, today, tomorrow, this week, later, no date).
 */
import { and, eq, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, prospects } from "@/db/schema";
import { dueTag, type DueTag } from "@/lib/due";
import { workspaceId } from "@/lib/workspace";

export interface TodoItem {
  businessId: string;
  businessName: string;
  city: string | null;
  stage: string;
  priority: string;
  action: string;
  at: string | null;
  due: DueTag | null;
  /** What kind of work it is, and where a click should lead. */
  kind: TodoKind;
  href: string;
}

/** The kinds of work, most pressing first: this is also the order inside one day. */
export const TODO_KINDS = [
  { key: "reply", label: "Replies" },
  { key: "own", label: "My own" },
  { key: "email", label: "Emails" },
  { key: "decision", label: "Decisions" },
  { key: "followup", label: "Follow-ups" },
  { key: "waiting", label: "Waiting" },
] as const;
export type TodoKind = (typeof TODO_KINDS)[number]["key"];

/** The kind of an action from the rule that planned it (no rule = the operator's own). */
export function todoKindOf(key: string | null): TodoKind {
  if (!key) return "own";
  const rule = key.split(":")[0];
  if (rule === "reply") return "reply";
  if (["review", "fix", "send", "send_failed", "bounced"].includes(rule)) return "email";
  if (rule === "wait") return "waiting";
  if (rule === "stage" || rule === "closeout") return "followup";
  return "decision";
}

/** Where the work is done: an email action opens that email, everything else the business. */
export function todoHref(businessId: string, key: string | null): string {
  const [rule, id] = (key ?? "").split(":");
  return ["review", "fix", "send", "send_failed"].includes(rule) && id ? `/outreach/${id}` : `/businesses/${businessId}`;
}

export const TODO_GROUPS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
  { key: "undated", label: "No date" },
] as const;
export type TodoGroup = (typeof TODO_GROUPS)[number]["key"];

/** Which group an action belongs to, from its due tag. */
export function todoGroupOf(due: DueTag | null): TodoGroup {
  if (!due) return "undated";
  if (due.days < 0) return "overdue";
  if (due.days === 0) return "today";
  if (due.days === 1) return "tomorrow";
  return due.days <= 7 ? "week" : "later";
}

/** Every open next action, soonest first (undated last); within a moment, high priority first. */
export async function listTodo(now = new Date()): Promise<TodoItem[]> {
  const db = await getDb();
  const rows = await db
    .select({ businessId: businesses.id, businessName: businesses.name, city: businesses.city, stage: prospects.stage, priority: prospects.priority, action: prospects.nextAction, at: prospects.nextActionAt, key: prospects.nextActionKey })
    .from(prospects)
    .innerJoin(businesses, eq(businesses.id, prospects.businessId))
    .where(and(eq(businesses.workspaceId, await workspaceId()), sql`${prospects.nextAction} is not null`, notInArray(prospects.stage, ["won", "lost"])))
    .orderBy(sql`${prospects.nextActionAt} is null`, prospects.nextActionAt, sql`case ${prospects.priority} when 'high' then 0 when 'normal' then 1 else 2 end`, businesses.name)
    .limit(1000)
    .all();
  return rows.map(({ key, ...r }) => ({ ...r, action: r.action!, due: dueTag(r.at, now), kind: todoKindOf(key), href: todoHref(r.businessId, key) }));
}

/** The list sorted into its groups, in order; empty groups are left out. */
export function groupTodo(items: TodoItem[]): { key: TodoGroup; label: string; items: TodoItem[] }[] {
  const rank = (i: TodoItem) => TODO_KINDS.findIndex((k) => k.key === i.kind) * 10 + (i.priority === "high" ? 0 : 1);
  // Inside a day the kind of work decides the order (a reply before a routine review); across days the date does.
  return TODO_GROUPS.map((g) => ({ ...g, items: items.filter((i) => todoGroupOf(i.due) === g.key) }))
    .map((g) => (g.key === "today" || g.key === "undated" ? { ...g, items: [...g.items].sort((a, b) => rank(a) - rank(b)) } : g))
    .filter((g) => g.items.length > 0);
}
