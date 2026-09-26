import type { ReviewScheduleEntry } from "@spar/domain";

/*
 * How a spaced-review date is said, everywhere it is said. One set of words for
 * a History row, the review sheet and the challenge's own panel, so "due in 3d"
 * never means one thing in the list and another on the card.
 */

const DAY_MS = 86_400_000;

function startOfDay(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Whole calendar days from today to `iso`; negative when it is past. */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.round((startOfDay(Date.parse(iso)) - startOfDay(now)) / DAY_MS);
}

export type DueTone = "overdue" | "due" | "soon" | "later";

export function dueTone(iso: string, now = Date.now()): DueTone {
  if (Date.parse(iso) <= now) return daysUntil(iso, now) < 0 ? "overdue" : "due";
  return daysUntil(iso, now) <= 2 ? "soon" : "later";
}

/** "Due now", "Overdue 3d", "Tomorrow", "In 5d", "In 3w", "Mar 4". */
export function dueLabel(iso: string, now = Date.now()): string {
  const days = daysUntil(iso, now);
  if (Date.parse(iso) <= now) return days < 0 ? `Overdue ${-days}d` : "Due now";
  if (days <= 0) return "Later today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days}d`;
  if (days < 60) return `In ${Math.round(days / 7)}w`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** An interval on a grade button: "1d", "4d", "3w", "2mo", "1y". */
export function intervalLabel(days: number): string {
  if (days < 14) return `${Math.max(1, Math.round(days))}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(days < 730 ? 0 : 1)}y`;
}

export function percent(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function isDue(entry: Pick<ReviewScheduleEntry, "dueAt" | "suspended"> | undefined, now = Date.now()): boolean {
  return Boolean(entry && !entry.suspended && Date.parse(entry.dueAt) <= now);
}

export const TONE_CLASS: Record<DueTone, string> = {
  overdue: "bg-destructive/12 text-destructive",
  due: "bg-[var(--warning)]/15 text-[var(--warning)]",
  soon: "bg-[var(--color-background-elevated-secondary)] text-foreground/80",
  later: "bg-[var(--color-background-elevated-secondary)] text-muted-foreground",
};

export const RATING_LABEL: Record<1 | 2 | 3 | 4, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
