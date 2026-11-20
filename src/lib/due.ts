/**
 * When a planned next action is due, in the words a person would use, counted in
 * whole days: something planned for today is "Today", never "overdue by nine seconds".
 * Used wherever a next action is shown (dashboard, businesses list, business page).
 */
export type DueTone = "bad" | "accent" | "info" | "neutral";
export interface DueTag {
  label: string;
  tone: DueTone;
  /** Whole days from today: negative = overdue, 0 = today. */
  days: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dueTag(iso: string | null | undefined, now = new Date()): DueTag | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (days < 0) return { label: `Overdue ${-days} day${days === -1 ? "" : "s"}`, tone: "bad", days };
  if (days === 0) return { label: "Today", tone: "accent", days };
  if (days === 1) return { label: "Tomorrow", tone: "info", days };
  return { label: `In ${days} days`, tone: "neutral", days };
}

/** Quick choices for "when": days from today. The action is set for 9 in the morning of that day. */
export const DUE_CHOICES: { days: number; label: string }[] = [
  { days: 0, label: "Today" },
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "Next week" },
];

/** The moment a quick choice stands for: today means now, any later day means 9:00 that morning. */
export function dueInDays(days: number, now = new Date()): Date {
  if (days <= 0) return now;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 9, 0, 0, 0);
}
