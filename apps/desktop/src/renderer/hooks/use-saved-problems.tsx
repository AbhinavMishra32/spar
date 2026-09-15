import { useSyncExternalStore } from "react";
import type { SavedProblem } from "@spar/domain";

/**
 * The shelf, held once for the whole renderer.
 *
 * Same arrangement as the provider inventory next door, and for the same reason:
 * what the learner has put aside is a property of the device rather than of the
 * screen they happen to be on, and the bookmark is drawn in three places that
 * have no other way to reach each other. A challenge saved from the card in the
 * transcript has to appear filled in the library behind it, and a problem
 * unsaved in the library has to empty the bookmark on the card — through props
 * that would mean threading a list and a callback from the bootstrap down
 * through the thread, the panel and every row, which is a lot of plumbing for
 * one boolean that is genuinely global.
 *
 * Writes go through the main process and the answer is the whole shelf, so the
 * two never drift: nothing here maintains a local idea of what is saved beyond
 * the last answer the device gave.
 */
let shelf: SavedProblem[] = [];
let keys: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish(next: SavedProblem[]) {
  shelf = next;
  keys = new Set(next.map((item) => item.key));
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** What the bootstrap read off the device. Called every time it is re-read, so a
 *  shelf changed on another window — or restored from the server — lands here
 *  rather than staying whatever this window last wrote. */
export function seedSavedProblems(next: SavedProblem[]) {
  if (next.length === shelf.length && next.every((item, index) => item.key === shelf[index]?.key)) return;
  publish(next);
}

export function useSavedProblems(): SavedProblem[] {
  return useSyncExternalStore(subscribe, () => shelf);
}

/** One row's own answer. A boolean rather than a slice of the list, so a card
 *  re-renders when its own problem is filed and not when any problem is. */
export function useProblemSaved(key: string | null): boolean {
  return useSyncExternalStore(subscribe, () => (key ? keys.has(key) : false));
}

/**
 * Put a problem on the shelf, or take it off.
 *
 * Painted before the device answers, because a bookmark that waits for a round
 * trip reads as a control that did not take the press — and rolled back if the
 * write fails, because a bookmark that lies is worse than one that is slow. The
 * device's own answer replaces the guess either way.
 */
export async function toggleSavedProblem(key: string, snapshot: SavedProblem["snapshot"] = null): Promise<void> {
  const api = window.spar;
  if (!api || !key) return;
  const saved = !keys.has(key);
  const before = shelf;
  publish(saved
    ? [{ key, savedAt: new Date().toISOString(), snapshot }, ...shelf]
    : shelf.filter((item) => item.key !== key));
  try {
    publish(await api.setProblemSaved({ key, saved, ...(snapshot ? { snapshot } : {}) }));
  } catch {
    publish(before);
  }
}
