import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "spar.intellisense";

/**
 * Whether the editor offers completions, hints and hovers.
 *
 * Off unless asked for: this is practice, and a popup finishing the line is the
 * thing being practised. Persisted, and shared between every editor on screen —
 * turning it on in one should not leave the other quietly off.
 */
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

let current = read();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIntellisense(): [boolean, () => void] {
  const on = useSyncExternalStore(subscribe, () => current);
  const toggle = useCallback(() => {
    current = !current;
    try {
      localStorage.setItem(STORAGE_KEY, current ? "on" : "off");
    } catch {
      /* A preference that does not persist is still a preference for this run. */
    }
    for (const listener of listeners) listener();
  }, []);
  return [on, toggle];
}
