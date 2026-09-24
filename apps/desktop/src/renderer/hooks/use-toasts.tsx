import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

/**
 * What the app says back, held once for the whole renderer.
 *
 * Same store as the shelf next door and for the same reason: the things worth
 * confirming happen inside a bookmark on a card three components deep, and the
 * place they have to be confirmed is a corner of the window that component has
 * no way to reach. Threading a callback down for it would mean every surface
 * that might ever want to say something carrying a prop it mostly does not use.
 *
 * Deliberately small. A toast here is a receipt for something the learner just
 * did — it is never an error dialog, never a question, and never the only place
 * a fact appears. If dismissing it loses information, it was the wrong surface.
 */
export type Toast = {
  id: string;
  /** The thing that happened, in the learner's words. One line. */
  title: string;
  /** What it happened to, and where it went. Truncated to one line. */
  detail?: string | undefined;
  /** A mark for the left tile — the language glyph, a filled bookmark. */
  glyph?: ReactNode;
  /** The one thing worth offering back, usually the way to undo it. */
  action?: { label: string; onClick(): void } | undefined;
  /** Where the thing that happened now lives. Given, the whole receipt becomes
   *  the way there — a receipt that names a place and cannot be pressed is a
   *  receipt that makes the learner go and find it. */
  onClick?: (() => void) | undefined;
  tone?: "neutral" | "success" | "warning" | "danger";
  /** Milliseconds on screen. A receipt with an action is given longer, because
   *  the action is the reason it is there and four seconds is not long enough to
   *  read a line and decide to press something. */
  duration?: number | undefined;
};

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, number>();

/** Any more than this on screen at once and the stack is the notification, not
 *  the thing it is about. The oldest leaves to make room. */
const MAX_VISIBLE = 3;

function publish(next: Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts);
}

export function dismissToast(id: string) {
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
  if (toasts.some((item) => item.id === id)) publish(toasts.filter((item) => item.id !== id));
}

/**
 * Say something, once.
 *
 * `key` is how a control that can be pressed repeatedly stays quiet: saving,
 * unsaving and saving the same problem again replaces one receipt rather than
 * stacking three, and the timer restarts with it. Without it, a learner tidying
 * a list would bury the window in their own clicks.
 */
export function toast(input: Omit<Toast, "id"> & { key?: string }): string {
  const { key, ...rest } = input;
  const id = key ?? `toast-${Math.random().toString(36).slice(2)}`;
  dismissToast(id);
  const entry: Toast = { ...rest, id };
  const next = [...toasts, entry];
  for (const dropped of next.slice(0, Math.max(0, next.length - MAX_VISIBLE))) {
    const timer = timers.get(dropped.id);
    if (timer) window.clearTimeout(timer);
    timers.delete(dropped.id);
  }
  publish(next.slice(-MAX_VISIBLE));
  const duration = entry.duration ?? (entry.action ? 7_000 : 4_000);
  if (duration > 0) timers.set(id, window.setTimeout(() => dismissToast(id), duration));
  return id;
}
